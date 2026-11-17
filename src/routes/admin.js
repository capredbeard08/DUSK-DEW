/** Founder Console: authentication, overview, products, inventory and restocking. */
import { all, audit, nowIso, one, run, settingsMap, uid } from '../lib/db.js';
import {
  cleanText,
  clientIp,
  createSession,
  destroySession,
  getAuth,
  isSameOrigin,
  rateLimit,
  verifyCsrf,
  verifyGuestCsrf,
  verifyPassword,
  canAccessConsole,
  can,
} from '../lib/security.js';
import { parseDollars, publicContext, readForm, redirect, html, intOr, booleanish } from '../lib/http.js';
import { adjustStock, inventoryRow, releaseOrderReservations, restockProduct, expireReservations } from '../lib/inventory.js';
import { dashboardData, inventorySummary } from '../lib/reports.js';
import { CURRENCIES, savePrices, deleteProductIfUnused } from '../lib/pricing.js';
import { consoleLoginPage, overviewPage, productsPage, productFormPage, inventoryPage, inventoryDetailPage, restocksPage } from '../views/console.js';

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

function forbidden() {
  return html('<h1>Not authorised</h1><p>Your role does not permit this action.</p>', 403);
}

export async function handleAdminLogin({ db, request, env, path, method }) {
  const ctx = await publicContext(db, request);
  if (method !== 'POST') {
    if (ctx.auth && canAccessConsole(ctx.auth.user)) return redirect('/admin');
    return html(consoleLoginPage({ csrf: ctx.csrf }), 200, ctx.cookies);
  }
  const form = await readForm(request);
  if (!form || (!ctx.auth && !verifyGuestCsrf(request, form)) || (ctx.auth && !verifyCsrf(form, ctx.auth, request))) {
    return html(consoleLoginPage({ error: 'Your session expired. Please try again.', csrf: ctx.csrf }), 403, ctx.cookies);
  }
  const ip = clientIp(request);
  const limit = await rateLimit(db, `adminlogin:${ip}`, 8, 900);
  if (!limit.allowed) {
    await audit(db, { action: 'auth.console_rate_limited', ip });
    return html(consoleLoginPage({ error: 'Too many attempts. Try again in 15 minutes.', csrf: ctx.csrf }), 429, ctx.cookies);
  }
  const email = cleanText(form.get('email'), 254).toLowerCase();
  // Per-account throttle so a botnet cannot guess one account from many addresses.
  const accountLimit = await rateLimit(db, `adminlogin_acct:${email}`, 12, 900);
  if (!accountLimit.allowed) {
    await audit(db, { action: 'auth.console_account_rate_limited', entityType: 'user', entityId: email, ip });
    return html(consoleLoginPage({ error: 'Too many attempts. Try again in 15 minutes.', csrf: ctx.csrf }), 429, ctx.cookies);
  }
  const password = String(form.get('password') || '');
  const user = await one(db, 'SELECT * FROM users WHERE email = ?', email);
  const valid = user && user.is_active && (await verifyPassword(password, user.password_hash));
  if (!valid || !canAccessConsole(user)) {
    await audit(db, { action: 'auth.console_login_failed', entityType: 'user', entityId: email, ip });
    return html(consoleLoginPage({ error: 'Those details do not match an authorised account.', email, csrf: ctx.csrf }), 401, ctx.cookies);
  }
  await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  const session = await createSession(db, user.id, request);
  await audit(db, { userId: user.id, actorEmail: user.email, action: 'auth.console_login', entityType: 'user', entityId: user.id, ip });
  return redirect(user.must_change_password ? '/account/password' : '/admin', 303, [session.setCookie]);
}

export async function handleAdmin({ db, request, env, url, path, method, auth }) {
  if (path === '/admin/logout') {
    if (method !== 'POST') return redirect('/admin');
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    await destroySession(db, request);
    return redirect('/admin/login');
  }

  const settings = await settingsMap(db);
  const base = consoleBase(auth, settings, request);

  if (path === '/admin') {
    const data = await dashboardData(db);
    const alerts = [];
    const stockIssues = await one(db, `SELECT COUNT(*) AS c FROM orders WHERE stock_issue = 1`);
    if (Number(stockIssues.c)) {
      alerts.push({ level: 'danger', title: `${stockIssues.c} paid order(s) could not be fulfilled from stock.`, text: 'Review the order, restock and fulfil, or refund.', href: '/admin/orders?fulfilment=needs_attention' });
    }
    const unverified = await one(db, `SELECT COUNT(*) AS c FROM products WHERE verification_status = 'pending' AND status <> 'draft'`);
    if (Number(unverified.c)) {
      alerts.push({ level: 'warn', title: `${unverified.c} published product(s) await ingredient verification.`, text: 'Confirm INCI and claims in the product editor before launch.', href: '/admin/products' });
    }
    if (Number(data.summary.pendingOrders)) {
      alerts.push({ level: 'info', title: `${data.summary.pendingOrders} order(s) awaiting payment.`, text: 'Unpaid orders hold reservations for 30 minutes, then release automatically.', href: '/admin/orders?payment=pending' });
    }
    if (Number(data.summary.lowStockCount)) {
      alerts.push({ level: 'warn', title: `${data.summary.lowStockCount} product(s) at or below the low-stock threshold.`, text: 'Restock before availability is affected.', href: '/admin/inventory' });
    }
    return html(overviewPage({ ...base, ...data, alerts }), 200);
  }

  if (path === '/admin/products' && method === 'GET') {
    const q = cleanText(url.searchParams.get('q'), 80);
    const status = cleanText(url.searchParams.get('status'), 40);
    let rows = await all(
      db,
      `SELECT p.*, c.name AS category_name, COALESCE(i.physical_stock,0) AS physical_stock, COALESCE(i.reserved_stock,0) AS reserved_stock
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN inventory i ON i.product_id = p.id
       ORDER BY p.updated_at DESC`,
    );
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()));
    if (status) rows = rows.filter((p) => p.status === status);
    const counts = {
      total: rows.length,
      active: rows.filter((p) => p.status === 'active').length,
      draft: rows.filter((p) => p.status === 'draft').length,
      out: rows.filter((p) => p.status === 'out_of_stock').length,
    };
    const verificationCount = rows.filter((p) => p.verification_status === 'pending' && p.status !== 'draft').length;
    return html(productsPage({ ...base, products: rows, filters: { q, status }, counts, verificationCount }), 200);
  }

  if (path === '/admin/products/new' && method === 'GET') {
    const categories = await all(db, 'SELECT * FROM categories ORDER BY sort_order');
    return html(productFormPage({ ...base, product: null, categories, isNew: true }), 200);
  }

  if (path === '/admin/products' && method === 'POST') {
    if (!can(auth.user, 'products.write')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const name = cleanText(form.get('name'), 160);
    const sku = cleanText(form.get('sku'), 60).toUpperCase();
    const price = parseDollars(form.get('price'));
    if (!name || !sku || price === null) {
      return redirect('/admin/products/new?error=Name%2C%20SKU%20and%20a%20valid%20price%20are%20required.');
    }
    const clash = await one(db, 'SELECT id FROM products WHERE sku = ?', sku);
    if (clash) return redirect('/admin/products/new?error=That%20SKU%20is%20already%20in%20use.');
    let slug = cleanText(form.get('slug'), 90) || name;
    slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let n = 1;
    while (await one(db, 'SELECT id FROM products WHERE slug = ?', slug)) {
      n += 1;
      slug = `${slug.replace(/-\d+$/, '')}-${n}`;
    }
    const id = uid('prd_');
    const now = nowIso();
    const status = ['draft', 'active', 'out_of_stock', 'temporarily_unavailable', 'discontinued'].includes(form.get('status'))
      ? form.get('status')
      : 'draft';
    const cost = parseDollars(form.get('cost'));
    await run(
      db,
      `INSERT INTO products
        (id, slug, sku, name, subtitle, description, net_contents, inci_text, directions, warnings, claims, shipping_info,
         price_cents, currency, cost_cents, category_id, status, fulfilment_model, preorder_enabled, manual_unavailable,
         low_stock_threshold, image_url, image_tone, verification_status, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      sku,
      name,
      cleanText(form.get('subtitle'), 200) || null,
      cleanText(form.get('description'), 12000) || null,
      cleanText(form.get('net_contents'), 80) || null,
      cleanText(form.get('inci_text'), 4000) || null,
      cleanText(form.get('directions'), 4000) || null,
      cleanText(form.get('warnings'), 4000) || null,
      cleanText(form.get('claims'), 2000) || null,
      cleanText(form.get('shipping_info'), 4000) || null,
      price,
      CURRENCIES.includes(form.get('currency')) ? form.get('currency') : 'USD',
      cost,
      cleanText(form.get('category_id'), 40) || null,
      status,
      form.get('fulfilment_model') === 'preorder' ? 'preorder' : 'inventory',
      booleanish(form.get('preorder_enabled')),
      booleanish(form.get('manual_unavailable')),
      Math.max(0, intOr(form.get('low_stock_threshold'), 10)),
      cleanText(form.get('image_url'), 500) || null,
      ['amber', 'deep', 'soft', 'green'].includes(form.get('image_tone')) ? form.get('image_tone') : 'amber',
      form.get('verification_status') === 'verified' ? 'verified' : 'pending',
      booleanish(form.get('featured')),
      now,
      now,
    );
    await run(db, 'INSERT INTO inventory (product_id, physical_stock, reserved_stock, units_sold, updated_at) VALUES (?, 0, 0, 0, ?)', id, now);
    await savePrices(db, id, form, CURRENCIES.includes(form.get('currency')) ? form.get('currency') : 'USD', price, now);
    const opening = Math.max(0, intOr(form.get('opening_stock'), 0));
    if (opening > 0) {
      await restockProduct(db, {
        productId: id,
        qty: opening,
        supplier: null,
        batchRef: 'Opening stock',
        unitCostCents: cost,
        restockDate: now.slice(0, 10),
        notes: 'Opening stock recorded when the product was created.',
        userId: auth.user.id,
      });
    }
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'product.created', entityType: 'product', entityId: id, details: { name, sku, price, opening }, ip: clientIp(request) });
    return redirect(`/admin/products/${id}?notice=Product%20created`);
  }

  if (path.startsWith('/admin/products/') && method === 'POST') {
    if (!can(auth.user, 'products.write')) return forbidden();
    const id = path.split('/')[3];
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const product = await one(db, 'SELECT * FROM products WHERE id = ?', id);
    if (!product) return redirect('/admin/products?error=Product%20not%20found');
    if (form.get('action') === 'archive') {
      await run(db, `UPDATE products SET status = 'discontinued', manual_unavailable = 1, updated_at = ? WHERE id = ?`, nowIso(), id);
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'product.archived', entityType: 'product', entityId: id, details: { name: product.name, sku: product.sku }, ip: clientIp(request) });
      return redirect('/admin/products?notice=Product%20archived.%20Order%20history%20is%20preserved.');
    }
    if (form.get('action') === 'delete') {
      const result = await deleteProductIfUnused(db, id);
      if (!result.ok) return redirect(`/admin/products/${id}?error=${encodeURIComponent(result.error)}`);
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'product.deleted', entityType: 'product', entityId: id, details: { name: product.name, sku: product.sku }, ip: clientIp(request) });
      return redirect('/admin/products?notice=Product%20deleted');
    }
    const name = cleanText(form.get('name'), 160);
    const sku = cleanText(form.get('sku'), 60).toUpperCase();
    const price = parseDollars(form.get('price'));
    if (!name || !sku || price === null) return redirect(`/admin/products/${id}?error=Name%2C%20SKU%20and%20price%20are%20required.`);
    const clash = await one(db, 'SELECT id FROM products WHERE sku = ? AND id <> ?', sku, id);
    if (clash) return redirect(`/admin/products/${id}?error=That%20SKU%20belongs%20to%20another%20product.`);
    const status = ['draft', 'active', 'out_of_stock', 'temporarily_unavailable', 'discontinued'].includes(form.get('status'))
      ? form.get('status')
      : product.status;
    await run(
      db,
      `UPDATE products SET name = ?, sku = ?, subtitle = ?, description = ?, net_contents = ?, inci_text = ?, directions = ?,
        warnings = ?, claims = ?, shipping_info = ?, price_cents = ?, currency = ?, cost_cents = ?, category_id = ?,
        status = ?, fulfilment_model = ?, preorder_enabled = ?, manual_unavailable = ?, low_stock_threshold = ?,
        image_url = ?, image_tone = ?, verification_status = ?, featured = ?, updated_at = ?
       WHERE id = ?`,
      name,
      sku,
      cleanText(form.get('subtitle'), 200) || null,
      cleanText(form.get('description'), 12000) || null,
      cleanText(form.get('net_contents'), 80) || null,
      cleanText(form.get('inci_text'), 4000) || null,
      cleanText(form.get('directions'), 4000) || null,
      cleanText(form.get('warnings'), 4000) || null,
      cleanText(form.get('claims'), 2000) || null,
      cleanText(form.get('shipping_info'), 4000) || null,
      price,
      CURRENCIES.includes(form.get('currency')) ? form.get('currency') : 'USD',
      parseDollars(form.get('cost')),
      cleanText(form.get('category_id'), 40) || null,
      status,
      form.get('fulfilment_model') === 'preorder' ? 'preorder' : 'inventory',
      booleanish(form.get('preorder_enabled')),
      booleanish(form.get('manual_unavailable')),
      Math.max(0, intOr(form.get('low_stock_threshold'), 10)),
      cleanText(form.get('image_url'), 500) || null,
      ['amber', 'deep', 'soft', 'green'].includes(form.get('image_tone')) ? form.get('image_tone') : 'amber',
      form.get('verification_status') === 'verified' ? 'verified' : 'pending',
      booleanish(form.get('featured')),
      nowIso(),
      id,
    );
    await run(db, 'INSERT OR IGNORE INTO inventory (product_id, physical_stock, reserved_stock, units_sold, updated_at) VALUES (?, 0, 0, 0, ?)', id, nowIso());
    await savePrices(db, id, form, CURRENCIES.includes(form.get('currency')) ? form.get('currency') : 'USD', price, nowIso());
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'product.updated', entityType: 'product', entityId: id, details: { name, price, status }, ip: clientIp(request) });
    return redirect(`/admin/products/${id}?notice=Changes%20saved`);
  }

  if (path.startsWith('/admin/products/') && method === 'GET') {
    const id = path.split('/')[3];
    const product = await one(db, 'SELECT * FROM products WHERE id = ?', id);
    if (!product) return redirect('/admin/products?error=Product%20not%20found');
    const categories = await all(db, 'SELECT * FROM categories ORDER BY sort_order');
    const priceRows = await all(db, 'SELECT currency, price_cents FROM product_prices WHERE product_id = ?', id);
    const prices = Object.fromEntries(priceRows.map((r) => [r.currency, r.price_cents]));
    return html(productFormPage({ ...base, product, categories, prices, isNew: false }), 200);
  }

  if (path === '/admin/inventory') {
    await expireReservations(db);
    const rows = await all(
      db,
      `SELECT p.id AS product_id, p.name, p.sku, p.status, p.low_stock_threshold,
              i.physical_stock, i.reserved_stock, i.units_sold, i.last_restock_at
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.status <> 'discontinued' ORDER BY p.name`,
    );
    const summary = await inventorySummary(db);
    return html(inventoryPage({ ...base, rows: rows.map((r) => ({ ...r, physical_stock: Number(r.physical_stock || 0), reserved_stock: Number(r.reserved_stock || 0), units_sold: Number(r.units_sold || 0) })), summary }), 200);
  }

  if (path.startsWith('/admin/inventory/') && path.endsWith('/restock') && method === 'POST') {
    if (!can(auth.user, 'inventory.write')) return forbidden();
    const id = path.split('/')[3];
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const qty = intOr(form.get('qty'), 0);
    try {
      await restockProduct(db, {
        productId: id,
        qty,
        supplier: cleanText(form.get('supplier'), 160) || null,
        batchRef: cleanText(form.get('batch_ref'), 80) || null,
        unitCostCents: parseDollars(form.get('unit_cost')),
        restockDate: cleanText(form.get('restock_date'), 20) || nowIso().slice(0, 10),
        notes: cleanText(form.get('notes'), 1000) || null,
        userId: auth.user.id,
      });
    } catch (err) {
      return redirect(`/admin/inventory/${id}?error=${encodeURIComponent(err.message)}`);
    }
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'inventory.restocked', entityType: 'product', entityId: id, details: { qty }, ip: clientIp(request) });
    return redirect(`/admin/inventory/${id}?notice=Restock%20recorded`);
  }

  if (path.startsWith('/admin/inventory/') && path.endsWith('/adjust') && method === 'POST') {
    if (!can(auth.user, 'inventory.write')) return forbidden();
    const id = path.split('/')[3];
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    try {
      await adjustStock(db, {
        productId: id,
        qtyDelta: intOr(form.get('qty_delta'), 0),
        category: cleanText(form.get('category'), 20) || 'correction',
        reason: cleanText(form.get('reason'), 300),
        notes: cleanText(form.get('notes'), 1000) || null,
        userId: auth.user.id,
      });
    } catch (err) {
      return redirect(`/admin/inventory/${id}?error=${encodeURIComponent(err.message)}`);
    }
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'inventory.adjusted', entityType: 'product', entityId: id, details: { delta: intOr(form.get('qty_delta'), 0), reason: cleanText(form.get('reason'), 300) }, ip: clientIp(request) });
    return redirect(`/admin/inventory/${id}?notice=Adjustment%20recorded`);
  }

  if (path.startsWith('/admin/inventory/') && method === 'GET' && !path.endsWith('.csv')) {
    const id = path.split('/')[3];
    const row = await one(
      db,
      `SELECT p.id AS product_id, p.name, p.sku, COALESCE(i.physical_stock,0) AS physical_stock,
              COALESCE(i.reserved_stock,0) AS reserved_stock, COALESCE(i.units_sold,0) AS units_sold, i.last_restock_at
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?`,
      id,
    );
    if (!row) return redirect('/admin/inventory?error=Product%20not%20found');
    const movements = await all(db, 'SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 100', id);
    const reservations = await all(
      db,
      `SELECT r.*, o.reference AS order_reference FROM inventory_reservations r
       LEFT JOIN orders o ON o.id = r.order_id WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      id,
    );
    return html(inventoryDetailPage({ ...base, row, movements, reservations }), 200);
  }

  if (path === '/admin/restocks') {
    const products = await all(db, `SELECT id, name, sku FROM products WHERE status <> 'discontinued' ORDER BY name`);
    if (method === 'POST') {
      if (!can(auth.user, 'inventory.write')) return forbidden();
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      try {
        await restockProduct(db, {
          productId: cleanText(form.get('product_id'), 40),
          qty: intOr(form.get('qty'), 0),
          supplier: cleanText(form.get('supplier'), 160) || null,
          batchRef: cleanText(form.get('batch_ref'), 80) || null,
          unitCostCents: parseDollars(form.get('unit_cost')),
          restockDate: cleanText(form.get('restock_date'), 20) || nowIso().slice(0, 10),
          notes: cleanText(form.get('notes'), 1000) || null,
          userId: auth.user.id,
        });
      } catch (err) {
        return redirect(`/admin/restocks?error=${encodeURIComponent(err.message)}`);
      }
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'inventory.restocked', entityType: 'product', entityId: cleanText(form.get('product_id'), 40), details: { qty: intOr(form.get('qty'), 0) }, ip: clientIp(request) });
      return redirect('/admin/restocks?notice=Restock%20recorded');
    }
    const restocks = await all(
      db,
      `SELECT r.*, p.name AS product_name, u.email AS actor_email FROM restocks r
       JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC LIMIT 200`,
    );
    const totalCost = restocks.reduce((sum, r) => sum + (r.unit_cost_cents || 0) * r.qty, 0);
    return html(restocksPage({ ...base, products, restocks, totalCost }), 200);
  }

  return null;
}
