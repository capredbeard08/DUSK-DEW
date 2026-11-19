/** Founder Console: categories and ingredients (the INCI lists customers rely on). */
import { all, audit, nowIso, one, run, settingsMap, uid } from '../lib/db.js';
import { cleanText, clientIp, isSameOrigin, verifyCsrf, can } from '../lib/security.js';
import { readForm, redirect, html, intOr } from '../lib/http.js';
import { categoriesPage, ingredientsPage, ingredientFormPage } from '../views/console-catalogue.js';

const consoleBase = (auth, settings, request) => ({
  settings,
  user: auth.user,
  csrf: auth.csrfToken,
  searchParams: new URL(request.url).searchParams,
});

async function postForm(request, auth) {
  const form = await readForm(request);
  const ok = Boolean(form && isSameOrigin(request) && verifyCsrf(form, auth, request));
  return { form, ok };
}

const forbidden = () => html('<h1>Not authorised</h1><p>Your role does not permit this action.</p>', 403);
const go = (path, kind, message) => redirect(`${path}?${kind}=${encodeURIComponent(message)}`);

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Make a slug that does not collide with another row of the same table. */
async function uniqueSlug(db, table, base, ignoreId = null) {
  const root = slugify(base) || 'item';
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    const clash = await one(db, `SELECT id FROM ${table} WHERE slug = ?${ignoreId ? ' AND id != ?' : ''}`, ...(ignoreId ? [candidate, ignoreId] : [candidate]));
    if (!clash) return candidate;
  }
  return `${root}-${uid('').slice(0, 6)}`;
}

export async function handleAdminCatalogue({ db, request, path, method, auth }) {
  if (!path.startsWith('/admin/categories') && !path.startsWith('/admin/ingredients')) return null;
  if (!can(auth.user, 'products.write')) return forbidden();
  const settings = await settingsMap(db);
  const base = consoleBase(auth, settings, request);
  const ip = clientIp(request);
  const log = (action, entityType, entityId, details = {}) =>
    audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action, entityType, entityId, details, ip });

  /* ---------------- Categories ---------------- */
  if (path === '/admin/categories' && method === 'GET') {
    const categories = await all(
      db,
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.sort_order, c.name`,
    );
    return html(categoriesPage({ ...base, categories }), 200);
  }

  if (path.startsWith('/admin/categories') && method === 'POST') {
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[3] || null;
    if (id && form.get('action') === 'delete') {
      const cat = await one(db, 'SELECT * FROM categories WHERE id = ?', id);
      if (!cat) return go('/admin/categories', 'error', 'Category not found');
      await run(db, 'DELETE FROM categories WHERE id = ?', id); // products keep existing, uncategorised
      await log('category.deleted', 'category', id, { name: cat.name });
      return go('/admin/categories', 'notice', 'Category deleted. Its products are now uncategorised.');
    }
    const name = cleanText(form.get('name'), 80);
    if (!name) return go('/admin/categories', 'error', 'A category needs a name.');
    const description = cleanText(form.get('description'), 400) || null;
    const sort = intOr(form.get('sort_order'), 0);
    if (id) {
      const cat = await one(db, 'SELECT * FROM categories WHERE id = ?', id);
      if (!cat) return go('/admin/categories', 'error', 'Category not found');
      await run(db, 'UPDATE categories SET name = ?, description = ?, sort_order = ? WHERE id = ?', name, description, sort, id);
      await log('category.updated', 'category', id, { name });
      return go('/admin/categories', 'notice', 'Category saved');
    }
    const newId = uid('cat_');
    await run(db, 'INSERT INTO categories (id, slug, name, description, sort_order) VALUES (?, ?, ?, ?, ?)', newId, await uniqueSlug(db, 'categories', name), name, description, sort);
    await log('category.created', 'category', newId, { name });
    return go('/admin/categories', 'notice', 'Category created');
  }

  /* ---------------- Ingredients ---------------- */
  if (path === '/admin/ingredients' && method === 'GET') {
    const q = cleanText(request.url && new URL(request.url).searchParams.get('q'), 80);
    const like = `%${q}%`;
    const ingredients = await all(
      db,
      `SELECT i.*, (SELECT COUNT(*) FROM product_ingredients pi WHERE pi.ingredient_id = i.id) AS product_count
       FROM ingredients i ${q ? 'WHERE i.inci_name LIKE ? OR i.common_name LIKE ?' : ''} ORDER BY i.inci_name`,
      ...(q ? [like, like] : []),
    );
    return html(ingredientsPage({ ...base, ingredients, q }), 200);
  }

  const edit = path.match(/^\/admin\/ingredients\/([^/]+)$/);
  if (edit && edit[1] !== 'new' && method === 'GET') {
    const ingredient = await one(db, 'SELECT * FROM ingredients WHERE id = ?', edit[1]);
    if (!ingredient) return go('/admin/ingredients', 'error', 'Ingredient not found');
    const products = await all(
      db,
      `SELECT p.id, p.name FROM products p JOIN product_ingredients pi ON pi.product_id = p.id WHERE pi.ingredient_id = ? ORDER BY p.name`,
      ingredient.id,
    );
    return html(ingredientFormPage({ ...base, ingredient, products }), 200);
  }

  if (path.startsWith('/admin/ingredients') && method === 'POST') {
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = edit ? edit[1] : null;
    if (id && form.get('action') === 'delete') {
      const ing = await one(db, 'SELECT * FROM ingredients WHERE id = ?', id);
      if (!ing) return go('/admin/ingredients', 'error', 'Ingredient not found');
      await run(db, 'DELETE FROM ingredients WHERE id = ?', id); // product links cascade
      await log('ingredient.deleted', 'ingredient', id, { inci: ing.inci_name });
      return go('/admin/ingredients', 'notice', 'Ingredient deleted and removed from every product.');
    }
    const inci = cleanText(form.get('inci_name'), 160);
    if (!inci) return go(id ? `/admin/ingredients/${id}` : '/admin/ingredients', 'error', 'The INCI name is required.');
    const values = [inci, cleanText(form.get('common_name'), 160) || null, cleanText(form.get('fn'), 200) || null, cleanText(form.get('categories'), 200) || null, cleanText(form.get('notes'), 2000) || null, cleanText(form.get('references_text'), 2000) || null];
    if (id) {
      if (!(await one(db, 'SELECT id FROM ingredients WHERE id = ?', id))) return go('/admin/ingredients', 'error', 'Ingredient not found');
      await run(db, 'UPDATE ingredients SET inci_name = ?, common_name = ?, fn = ?, categories = ?, notes = ?, references_text = ? WHERE id = ?', ...values, id);
      await log('ingredient.updated', 'ingredient', id, { inci });
      return go(`/admin/ingredients/${id}`, 'notice', 'Ingredient saved');
    }
    const newId = uid('ing_');
    await run(db, 'INSERT INTO ingredients (id, slug, inci_name, common_name, fn, categories, notes, references_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', newId, await uniqueSlug(db, 'ingredients', inci), ...values);
    await log('ingredient.created', 'ingredient', newId, { inci });
    return go('/admin/ingredients', 'notice', 'Ingredient added');
  }

  return null;
}

/** Replace a product's ingredient list from the product form. Only runs when the form carried the list. */
export async function saveProductIngredients(db, productId, form) {
  if (form.get('ingredients_present') !== '1') return;
  const picked = [];
  for (const [key, value] of form.entries()) {
    const match = key.match(/^ing_(.+)$/);
    if (match && value === '1') picked.push({ id: match[1], position: intOr(form.get(`ingpos_${match[1]}`), 999) });
  }
  picked.sort((a, b) => a.position - b.position);
  const valid = [];
  for (const item of picked) {
    if (await one(db, 'SELECT id FROM ingredients WHERE id = ?', item.id)) valid.push(item.id);
  }
  await db.batch([
    db.prepare('DELETE FROM product_ingredients WHERE product_id = ?').bind(productId),
    ...valid.map((ingredientId, index) => db.prepare('INSERT INTO product_ingredients (product_id, ingredient_id, position) VALUES (?, ?, ?)').bind(productId, ingredientId, index + 1)),
  ]);
}
