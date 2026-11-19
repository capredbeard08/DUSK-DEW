/** Founder Console: categories, ingredients, and ingredient lists on products. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceEnv, loginFounder, sessionCsrf, request } from './helpers.mjs';

test('Console catalogue', async (t) => {
  const env = await commerceEnv();
  const login = await loginFounder(env);
  const post = async (path, form, from = path) => {
    const page = await sessionCsrf(env, from, login.jar);
    return request(env, path, { method: 'POST', jar: login.jar, form: { _csrf: page.csrf, ...form } });
  };
  const first = async (sql, ...args) => env.DB.prepare(sql).bind(...args).first();

  await t.test('categories can be created, edited and deleted', async () => {
    assert.equal((await post('/admin/categories', { name: 'Body Oils', sort_order: '9', description: 'Oils' }, '/admin/categories')).status, 303);
    const cat = await first("SELECT * FROM categories WHERE name = 'Body Oils'");
    assert.equal(cat.slug, 'body-oils');
    assert.equal(cat.sort_order, 9);
    await post('/admin/categories', { name: 'Body Oils' }, '/admin/categories');
    assert.equal((await first("SELECT COUNT(*) AS n FROM categories WHERE name = 'Body Oils'")).n, 2);
    assert.notEqual((await env.DB.prepare("SELECT slug FROM categories WHERE name = 'Body Oils' ORDER BY slug").all()).results[0].slug, (await env.DB.prepare("SELECT slug FROM categories WHERE name = 'Body Oils' ORDER BY slug").all()).results[1].slug);
    await post(`/admin/categories/${cat.id}`, { name: 'Oils', sort_order: '1', description: '' }, '/admin/categories');
    assert.equal((await first('SELECT name FROM categories WHERE id = ?', cat.id)).name, 'Oils');
    const page = await request(env, '/admin/categories', { jar: login.jar });
    assert.match(page.text, /Oils/);
    await post(`/admin/categories/${cat.id}`, { action: 'delete' }, '/admin/categories');
    assert.equal(await first('SELECT id FROM categories WHERE id = ?', cat.id), null);
  });

  await t.test('deleting a category leaves its products uncategorised', async () => {
    const product = await first('SELECT id, category_id FROM products WHERE category_id IS NOT NULL LIMIT 1');
    assert.ok(product);
    await post(`/admin/categories/${product.category_id}`, { action: 'delete' }, '/admin/categories');
    assert.equal((await first('SELECT category_id FROM products WHERE id = ?', product.id)).category_id, null);
  });

  let ingredientA;
  await t.test('ingredients can be created, searched, edited', async () => {
    await post('/admin/ingredients', { inci_name: 'Aqua', common_name: 'Water', fn: 'Solvent' }, '/admin/ingredients');
    await post('/admin/ingredients', { inci_name: 'Glycerin', common_name: 'Glycerol' }, '/admin/ingredients');
    ingredientA = await first("SELECT * FROM ingredients WHERE inci_name = 'Aqua'");
    assert.ok(ingredientA);
    const search = await request(env, '/admin/ingredients?q=glycer', { jar: login.jar });
    assert.match(search.text, /Glycerin/);
    assert.doesNotMatch(search.text, />Aqua</);
    await post(`/admin/ingredients/${ingredientA.id}`, { inci_name: 'Aqua (Water)', common_name: 'Water' }, `/admin/ingredients/${ingredientA.id}`);
    assert.equal((await first('SELECT inci_name FROM ingredients WHERE id = ?', ingredientA.id)).inci_name, 'Aqua (Water)');
    const missing = await post('/admin/ingredients', { inci_name: '' }, '/admin/ingredients');
    assert.match(missing.headers.get('location') || '', /error=/);
  });

  await t.test('a product keeps its ingredients in the order set, and saves without the list leave them alone', async () => {
    const product = await first('SELECT * FROM products LIMIT 1');
    const glycerin = await first("SELECT id FROM ingredients WHERE inci_name = 'Glycerin'");
    const body = (extra) => ({ name: product.name, sku: product.sku, price: (product.price_cents / 100).toFixed(2), currency: product.currency, status: product.status, fulfilment_model: product.fulfilment_model, preorder_enabled: '0', manual_unavailable: '0', low_stock_threshold: '5', verification_status: product.verification_status, featured: '0', image_tone: product.image_tone || 'deep', ...extra });
    await post(`/admin/products/${product.id}`, body({ ingredients_present: '1', [`ing_${glycerin.id}`]: '1', [`ingpos_${glycerin.id}`]: '1', [`ing_${ingredientA.id}`]: '1', [`ingpos_${ingredientA.id}`]: '2' }), `/admin/products/${product.id}`);
    const ordered = (await env.DB.prepare('SELECT ingredient_id FROM product_ingredients WHERE product_id = ? ORDER BY position').bind(product.id).all()).results.map((r) => r.ingredient_id);
    assert.deepEqual(ordered, [glycerin.id, ingredientA.id]);
    const editor = await request(env, `/admin/products/${product.id}`, { jar: login.jar });
    assert.match(editor.text, /name="ingredients_present"/);
    await post(`/admin/products/${product.id}`, body({}), `/admin/products/${product.id}`);
    assert.equal((await first('SELECT COUNT(*) AS n FROM product_ingredients WHERE product_id = ?', product.id)).n, 2);
    await post(`/admin/products/${product.id}`, body({ ingredients_present: '1' }), `/admin/products/${product.id}`);
    assert.equal((await first('SELECT COUNT(*) AS n FROM product_ingredients WHERE product_id = ?', product.id)).n, 0);
  });

  await t.test('deleting an ingredient removes it from products', async () => {
    const product = await first('SELECT id FROM products LIMIT 1');
    await env.DB.prepare('INSERT INTO product_ingredients (product_id, ingredient_id, position) VALUES (?, ?, 1)').bind(product.id, ingredientA.id).run();
    await post(`/admin/ingredients/${ingredientA.id}`, { action: 'delete' }, `/admin/ingredients/${ingredientA.id}`);
    assert.equal(await first('SELECT id FROM ingredients WHERE id = ?', ingredientA.id), null);
    assert.equal(await first('SELECT 1 FROM product_ingredients WHERE ingredient_id = ?', ingredientA.id), null);
  });
});
