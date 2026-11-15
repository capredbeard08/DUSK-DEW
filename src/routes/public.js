/** Public storefront, waitlist, checkout, order lookup and sandbox payment routes. */
import { all, audit, nowIso, one, run, uid } from '../lib/db.js';
import {
  clientIp,
  rateLimit,
  verifyCsrf,
  verifyGuestCsrf,
  verifyPublicCsrf,
  validEmail,
  cleanText,
  isSameOrigin,
} from '../lib/security.js';
import { catalogue, contentMap, html, publicContext, readForm, redirect, intOr } from '../lib/http.js';
import {
  availableFor,
  productWithStock,
  reserveOrderStock,
  releaseOrderReservations,
  stockBadge,
  syncProductAvailability,
} from '../lib/inventory.js';
import { createPaymentSession, enabledProviders, verifyReturn, completeOfflinePayment } from '../lib/payments.js';
import { queueEmail } from '../lib/email.js';
import {
  homePage,
  shopPage,
  productPage,
  storyPage,
  ingredientsPage,
  ingredientPage,
  policyPage,
  preorderPage,
  contactPage,
  bagPage,
  checkoutPage,
  waitlistThanks,
  orderPage,
  offlinePayPage,
  notFoundPage,
} from '../views/public.js';

const PER_PAGE = 9;

async function addWaitlistEntry(db, { name, email, country, productId, source }) {
  const existing = productId
    ? await one(db, 'SELECT * FROM waitlist WHERE email = ? AND product_id = ?', email, productId)
    : await one(db, 'SELECT * FROM waitlist WHERE email = ? AND product_id IS NULL', email);
  if (existing) {
    await run(db, 'UPDATE waitlist SET name = ?, country = ?, source = ? WHERE id = ?', name, country || null, source, existing.id);
    return { id: existing.id, existing: true };
  }
  const id = uid('wl_');
  await run(
    db,
    `INSERT INTO waitlist (id, email, name, country, product_id, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)`,
    id,
    email,
    name,
    country || null,
    productId || null,
    source,
    nowIso(),
  );
  return { id, existing: false };
}

async function preorderAllocation(db, productId, qty) {
  return one(
    db,
    `SELECT bi.id AS batch_item_id, (bi.allocated_qty - bi.preorder_qty - bi.preorder_holds) AS remaining,
            pb.reference, pb.estimated_completion
     FROM batch_items bi JOIN production_batches pb ON pb.id = bi.batch_id
     WHERE bi.product_id = ? AND pb.status NOT IN ('cancelled','received')
       AND (bi.allocated_qty - bi.preorder_qty - bi.preorder_holds) >= ?
     ORDER BY (pb.estimated_completion IS NULL), pb.estimated_completion ASC LIMIT 1`,
    productId,
    qty,
  );
}

async function nextOrderReference(db, offset = 0) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const row = await one(db, 'SELECT COUNT(*) AS c FROM orders');
    const ref = `DD-${String(Number(row.c) + 1 + offset + attempt).padStart(4, '0')}`;
    const clash = await one(db, 'SELECT id FROM orders WHERE reference = ?', ref);
    if (!clash) return ref;
  }
  return `DD-${Date.now().toString(36).toUpperCase()}`;
}

function productJson(items) {
  let parsed;
  try {
    parsed = JSON.parse(items || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 30) return null;
  const map = new Map();
  for (const entry of parsed) {
    const id = String(entry.id || '');
    const qty = Number(entry.qty || 0);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    map.set(id, (map.get(id) || 0) + qty);
  }
  return [...map.entries()].map(([id, qty]) => ({ id, qty }));
}

export async function handlePublic({ db, request, env, url, path, method }) {
  const isPost = method === 'POST';

  if (path === '/') {
    const ctx = await publicContext(db, request);
    const products = await catalogue(db, ctx.settings);
    const ingredients = await all(db, 'SELECT * FROM ingredients ORDER BY inci_name LIMIT 20');
    return html(homePage({ ...ctx, products, ingredients }), 200, ctx.cookies);
  }

  if (path === '/shop') {
    const ctx = await publicContext(db, request);
    const categories = await all(db, 'SELECT * FROM categories ORDER BY sort_order');
    const q = cleanText(url.searchParams.get('q'), 80).toLowerCase();
    const category = cleanText(url.searchParams.get('category'), 80);
    const availability = cleanText(url.searchParams.get('availability'), 20);
    const sort = cleanText(url.searchParams.get('sort'), 20) || 'featured';
    let list = await catalogue(db, ctx.settings);
    const totalCatalog = list.length;
    if (q) {
      list = list.filter(
        ({ product }) =>
          product.name.toLowerCase().includes(q) ||
          String(product.subtitle || '').toLowerCase().includes(q) ||
          String(product.description || '').toLowerCase().includes(q) ||
          product.sku.toLowerCase().includes(q),
      );
    }
    if (category) list = list.filter(({ product }) => product.category_slug === category);
    if (availability === 'in_stock') list = list.filter(({ stock }) => stock.purchasable && !stock.preorder);
    if (availability === 'preorder') list = list.filter(({ stock }) => stock.preorder);
    if (availability === 'waitlist') list = list.filter(({ stock }) => stock.waitlist);
    if (sort === 'price-asc') list.sort((a, b) => a.product.price_cents - b.product.price_cents);
    else if (sort === 'price-desc') list.sort((a, b) => b.product.price_cents - a.product.price_cents);
    else if (sort === 'name') list.sort((a, b) => a.product.name.localeCompare(b.product.name));

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = Math.min(pages, Math.max(1, intOr(url.searchParams.get('page'), 1)));
    list = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return html(
      shopPage({
        ...ctx,
        settings: ctx.settings,
        products: list,
        categories,
        filters: { q, category, availability, sort },
        total: totalCatalog,
        page,
        pages,
      }),
      200,
      ctx.cookies,
    );
  }

  if (path.startsWith('/shop/')) {
    const slug = decodeURIComponent(path.split('/')[2] || '');
    const ctx = await publicContext(db, request);
    const product = await productWithStock(db, slug);
    if (!product || ['draft', 'discontinued'].includes(product.status)) {
      return html(notFoundPage(ctx), 404, ctx.cookies);
    }
    const stock = stockBadge(product, product, ctx.settings);
    const ingredients = await all(
      db,
      `SELECT i.* FROM ingredients i JOIN product_ingredients pi ON pi.ingredient_id = i.id
       WHERE pi.product_id = ? ORDER BY pi.position`,
      product.id,
    );
    const related = (await catalogue(db, ctx.settings))
      .filter(({ product: p }) => p.id !== product.id && p.category_id === product.category_id)
      .slice(0, 3);
    return html(productPage({ ...ctx, product, stock, ingredients, related, categories: [] }), 200, ctx.cookies);
  }

  if (path === '/our-story') {
    const ctx = await publicContext(db, request);
    return html(storyPage(ctx), 200, ctx.cookies);
  }

  if (path === '/ingredients') {
    const ctx = await publicContext(db, request);
    const q = cleanText(url.searchParams.get('q'), 80).toLowerCase();
    let ingredients = await all(db, 'SELECT * FROM ingredients ORDER BY inci_name');
    if (q) {
      ingredients = ingredients.filter(
        (i) => i.inci_name.toLowerCase().includes(q) || String(i.common_name || '').toLowerCase().includes(q),
      );
    }
    return html(ingredientsPage({ ...ctx, ingredients, query: q }), 200, ctx.cookies);
  }

  if (path.startsWith('/ingredients/')) {
    const slug = decodeURIComponent(path.split('/')[2] || '');
    const ctx = await publicContext(db, request);
    const ingredient = await one(db, 'SELECT * FROM ingredients WHERE slug = ?', slug);
    if (!ingredient) return html(notFoundPage(ctx), 404, ctx.cookies);
    const products = (await catalogue(db, ctx.settings)).filter(({ product }) =>
      product.inci_text?.toLowerCase().includes(ingredient.inci_name.toLowerCase()),
    );
    return html(ingredientPage({ ...ctx, ingredient, products }), 200, ctx.cookies);
  }

  if (path === '/contact') {
    const ctx = await publicContext(db, request);
    if (!isPost) return html(contactPage(ctx), 200, ctx.cookies);
    const form = await readForm(request);
    if (!form || !verifyPublicCsrf(request, form, ctx.auth)) {
      return html(contactPage(ctx), 403, ctx.cookies);
    }
    if (String(form.get('company') || '').trim()) return redirect('/contact?notice=Thank%20you');
    const limit = await rateLimit(db, `contact:${clientIp(request)}`, 5, 900);
    if (!limit.allowed) return html(contactPage(ctx), 429, ctx.cookies);
    const name = cleanText(form.get('name'), 120);
    const email = cleanText(form.get('email'), 254).toLowerCase();
    const message = cleanText(form.get('message'), 4000);
    if (!name || !validEmail(email) || message.length < 5) return redirect('/contact?error=Please%20complete%20the%20form');
    await run(
      db,
      'INSERT INTO contact_messages (id, name, email, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid('msg_'),
      name,
      email,
      cleanText(form.get('subject'), 120) || null,
      message,
      nowIso(),
    );
    return redirect('/contact?notice=Thank%20you%20%E2%80%94%20your%20message%20has%20been%20received');
  }

  if (path === '/shipping-and-returns') {
    const ctx = await publicContext(db, request);
    return html(policyPage(ctx, 'shipping_policy', 'Shipping'), 200, ctx.cookies);
  }

  if (path === '/preorder-information') {
    const ctx = await publicContext(db, request);
    const preorderProducts = await all(
      db,
      `SELECT bi.*, pb.reference, pb.manufacturer, pb.estimated_completion, pb.status, p.name AS product_name
       FROM batch_items bi JOIN production_batches pb ON pb.id = bi.batch_id
       JOIN products p ON p.id = bi.product_id
       WHERE pb.status <> 'cancelled' ORDER BY pb.created_at DESC`,
    );
    return html(preorderPage({ ...ctx, preorderProducts }), 200, ctx.cookies);
  }

  if (path === '/bag') {
    const ctx = await publicContext(db, request);
    return html(bagPage(ctx), 200, ctx.cookies);
  }

  if (path === '/waitlist/thanks') {
    const ctx = await publicContext(db, request);
    const productId = url.searchParams.get('product');
    const product = productId ? await one(db, 'SELECT name FROM products WHERE id = ?', productId) : null;
    return html(waitlistThanks({ ...ctx, productName: product ? product.name : '' }), 200, ctx.cookies);
  }

  if (path === '/waitlist') {
    if (!isPost) return redirect('/#waitlist');
    const ctx = await publicContext(db, request);
    const form = await readForm(request);
    if (!form || !verifyPublicCsrf(request, form, ctx.auth)) return html(notFoundPage(ctx), 403, ctx.cookies);
    if (String(form.get('company') || '').trim()) return redirect('/waitlist/thanks');
    const limit = await rateLimit(db, `waitlist:${clientIp(request)}`, 8, 600);
    if (!limit.allowed) return redirect('/?error=Too%20many%20requests%20%E2%80%94%20please%20try%20again%20shortly#waitlist');
    const name = cleanText(form.get('name'), 120);
    const email = cleanText(form.get('email'), 254).toLowerCase();
    const country = cleanText(form.get('country'), 60);
    const productId = cleanText(form.get('product_id'), 40);
    if (!name || !validEmail(email)) return redirect('/?error=Please%20enter%20a%20name%20and%20valid%20email#waitlist');
    const product = productId ? await one(db, 'SELECT * FROM products WHERE id = ?', productId) : null;
    await addWaitlistEntry(db, { name, email, country, productId: product ? product.id : null, source: 'waitlist' });
    await queueEmail(db, {
      to: email,
      templateKey: 'waitlist_confirmation',
      data: { name, product: product ? product.name : 'the DUSK & DEW collection' },
    });
    await audit(db, { action: 'waitlist.registered', entityType: 'waitlist', entityId: email, details: { product: product ? product.name : 'any', country }, ip: clientIp(request) });
    return redirect(`/waitlist/thanks${product ? `?product=${encodeURIComponent(product.id)}` : ''}`);
  }

  if (path === '/newsletter') {
    if (!isPost) return redirect('/');
    const ctx = await publicContext(db, request);
    const form = await readForm(request);
    if (!form || !verifyPublicCsrf(request, form, ctx.auth)) return html(notFoundPage(ctx), 403, ctx.cookies);
    const limit = await rateLimit(db, `newsletter:${clientIp(request)}`, 8, 600);
    const email = cleanText(form.get('email'), 254).toLowerCase();
    if (!limit.allowed) return redirect('/?error=Too%20many%20requests#newsletter');
    if (!validEmail(email)) return redirect('/?error=Enter%20a%20valid%20email%20address#newsletter');
    await run(
      db,
      `INSERT INTO newsletter (id, email, status, created_at) VALUES (?, ?, 'subscribed', ?)
       ON CONFLICT(email) DO UPDATE SET status = 'subscribed'`,
      uid('nws_'),
      email,
      nowIso(),
    );
    return redirect('/?notice=You%20are%20subscribed#newsletter');
  }

  if (path === '/checkout') {
    const ctx = await publicContext(db, request);
    if (!isPost) {
      const paymentsOn = ctx.settings.payments_enabled === '1';
      const countries = paymentsOn
        ? await all(db, 'SELECT * FROM supported_countries WHERE enabled = 1 AND shipping_cents IS NOT NULL ORDER BY sort_order, name')
        : await all(db, 'SELECT * FROM supported_countries ORDER BY sort_order, name');
      const providers = await enabledProviders(db, env, ctx.settings);
      return html(checkoutPage({ ...ctx, countries, providers }), 200, ctx.cookies);
    }
    return handleCheckout({ db, request, env, url, ctx });
  }

  if (path.startsWith('/order/') && !path.endsWith('/lookup')) {
    const reference = decodeURIComponent(path.split('/')[2] || '');
    const ctx = await publicContext(db, request);
    let order = await one(db, 'SELECT * FROM orders WHERE reference = ?', reference);
    if (!order) return html(notFoundPage(ctx), 404, ctx.cookies);

    let authorized = false;
    if (ctx.auth) {
      if (['founder', 'admin', 'staff'].includes(ctx.auth.user.role)) authorized = true;
      else if (ctx.auth.user.email.toLowerCase() === order.email.toLowerCase()) authorized = true;
    }
    const emailParam = (url.searchParams.get('email') || '').toLowerCase();
    if (!authorized && emailParam && emailParam === order.email.toLowerCase()) authorized = true;

    if (!authorized) {
      return html(orderPage({ ...ctx, order, items: [], payments: [], refunds: [], authorized: false, lookupError: '' }), 200, ctx.cookies);
    }

    if (order.payment_status === 'pending' && (url.searchParams.has('reference') || url.searchParams.has('trxref') || url.searchParams.has('token'))) {
      try {
        await verifyReturn(db, env, order);
      } catch (err) {
        await audit(db, { action: 'payment.return_verification_failed', entityType: 'order', entityId: order.id, details: { error: String(err).slice(0, 200) } });
      }
      order = await one(db, 'SELECT * FROM orders WHERE id = ?', order.id);
    }
    const items = await all(db, 'SELECT * FROM order_items WHERE order_id = ?', order.id);
    const payments = await all(db, 'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at', order.id);
    const refunds = await all(db, 'SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at', order.id);
    return html(orderPage({ ...ctx, order, items, payments, refunds, authorized: true, lookupError: '' }), 200, ctx.cookies);
  }

  if (path.startsWith('/order/') && path.endsWith('/lookup')) {
    if (!isPost) return redirect('/');
    const ctx = await publicContext(db, request);
    const form = await readForm(request);
    if (!form || !verifyPublicCsrf(request, form, ctx.auth)) return html(notFoundPage(ctx), 403, ctx.cookies);
    const limit = await rateLimit(db, `orderlookup:${clientIp(request)}`, 10, 600);
    if (!limit.allowed) return html('<h1>Too many attempts</h1>', 429);
    const reference = cleanText(form.get('reference'), 40);
    const email = cleanText(form.get('email'), 254).toLowerCase();
    const order = await one(db, 'SELECT * FROM orders WHERE reference = ?', reference);
    if (!order) return html(notFoundPage(ctx), 404, ctx.cookies);
    if (order.email.toLowerCase() !== email) {
      const items = [];
      return html(
        orderPage({ ...ctx, order, items, payments: [], refunds: [], authorized: false, lookupError: 'That email does not match this order.' }),
        401,
        ctx.cookies,
      );
    }
    return redirect(`/order/${encodeURIComponent(order.reference)}?email=${encodeURIComponent(email)}`);
  }

  if (path.startsWith('/pay/')) {
    if (env.PAYMENTS_OFFLINE !== '1') return html(notFoundPage(await publicContext(db, request)), 404);
    const reference = decodeURIComponent(path.split('/')[2] || '');
    const ctx = await publicContext(db, request);
    const payment = await one(db, 'SELECT * FROM payments WHERE reference = ?', reference);
    if (!payment) return html(notFoundPage(ctx), 404, ctx.cookies);
    const order = await one(db, 'SELECT * FROM orders WHERE id = ?', payment.order_id);
    if (!isPost) return html(offlinePayPage({ ...ctx, order, reference }), 200, ctx.cookies);
    const form = await readForm(request);
    if (!form || !verifyPublicCsrf(request, form, ctx.auth)) return html(offlinePayPage({ ...ctx, order, reference }), 403, ctx.cookies);
    const result = await completeOfflinePayment(db, env, reference);
    await audit(db, { action: 'payment.sandbox_capture', entityType: 'order', entityId: order.id, details: { reference, result }, ip: clientIp(request) });
    if (!result.ok) return redirect(`/checkout?error=${encodeURIComponent('Sandbox payment could not be completed.')}`);
    return redirect(`/order/${encodeURIComponent(order.reference)}?email=${encodeURIComponent(order.email)}`);
  }

  return null;
}

async function handleCheckout({ db, request, env, url, ctx }) {
  const form = await readForm(request);
  if (!form || !verifyPublicCsrf(request, form, ctx.auth)) return redirect('/checkout?error=Your%20session%20expired.%20Please%20try%20again.');
  if (!isSameOrigin(request)) return html('<h1>Invalid origin</h1>', 403);
  const limit = await rateLimit(db, `checkout:${clientIp(request)}`, 15, 600);
  if (!limit.allowed) return redirect('/checkout?error=Too%20many%20checkout%20attempts.%20Please%20wait%20a%20few%20minutes.');

  const items = productJson(form.get('items'));
  if (!items) return redirect('/checkout?error=Your%20bag%20is%20empty%20or%20invalid.');
  const name = cleanText(form.get('name'), 120);
  const email = cleanText(form.get('email'), 254).toLowerCase();
  const countryCode = cleanText(form.get('country'), 4).toUpperCase();
  if (!name || !validEmail(email)) return redirect('/checkout?error=Please%20enter%20your%20name%20and%20a%20valid%20email.');
  if (!form.get('terms')) return redirect('/checkout?error=Please%20accept%20the%20shipping%20and%20returns%20policy.');
  if (String(form.get('company') || '').trim()) return redirect('/waitlist/thanks');

  const lines = [];
  for (const item of items) {
    const product = await productWithStock(db, item.id);
    if (!product) return redirect('/checkout?error=A%20product%20in%20your%20bag%20is%20no%20longer%20available.');
    const stock = stockBadge(product, product, ctx.settings);
    if (!stock.purchasable) return redirect(`/checkout?error=${encodeURIComponent(`${product.name} is not available to purchase right now.`)}`);
    if (product.currency !== (ctx.settings.default_currency || 'USD')) {
      return redirect('/checkout?error=This%20product%20is%20priced%20in%20another%20currency%20and%20cannot%20be%20combined%20in%20one%20order.');
    }
    lines.push({ product, stock, qty: item.qty, lineTotal: product.price_cents * item.qty });
  }

  const paymentsOn = ctx.settings.payments_enabled === '1';
  if (!paymentsOn) {
    // Waitlist mode: register interest, never reserve stock or charge.
    for (const line of lines) {
      await addWaitlistEntry(db, {
        name,
        email,
        country: countryCode,
        productId: line.product.id,
        source: 'checkout_interest',
      });
      await queueEmail(db, {
        to: email,
        templateKey: 'waitlist_confirmation',
        data: { name, product: line.product.name },
      });
    }
    await audit(db, { action: 'checkout.waitlist_interest', entityType: 'waitlist', entityId: email, details: { items: lines.map((l) => ({ sku: l.product.sku, qty: l.qty })), country: countryCode }, ip: clientIp(request) });
    return redirect(`/waitlist/thanks${lines.length === 1 ? `?product=${encodeURIComponent(lines[0].product.id)}` : ''}`);
  }

  const country = await one(db, 'SELECT * FROM supported_countries WHERE code = ? AND enabled = 1', countryCode);
  if (!country) return redirect('/checkout?error=We%20do%20not%20ship%20to%20that%20destination%20yet.');
  if (country.shipping_cents === null) return redirect('/checkout?error=Shipping%20to%20that%20destination%20is%20not%20priced%20yet.');
  const providers = await enabledProviders(db, env, ctx.settings);
  if (!providers.length) return redirect('/checkout?error=No%20verified%20payment%20provider%20is%20configured.');

  for (const line of lines) {
    if (line.product.fulfilment_model === 'preorder') {
      const allocation = await preorderAllocation(db, line.product.id, line.qty);
      if (!allocation) return redirect('/checkout?error=Preorder%20capacity%20has%20been%20reached%20for%20one%20of%20your%20items.');
      line.batchItemId = allocation.batch_item_id;
    }
  }

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping = Number(country.shipping_cents);
  const total = subtotal + shipping;
  const currency = ctx.settings.default_currency || 'USD';

  let customer = await one(db, 'SELECT * FROM customers WHERE email = ?', email);
  if (customer) {
    await run(db, 'UPDATE customers SET name = ?, country = ? WHERE id = ?', name, country.code, customer.id);
  } else {
    const customerId = uid('cus_');
    await run(
      db,
      'INSERT INTO customers (id, email, name, country, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      customerId,
      email,
      name,
      country.code,
      ctx.auth ? ctx.auth.user.id : null,
      nowIso(),
    );
    customer = await one(db, 'SELECT * FROM customers WHERE id = ?', customerId);
  }

  const orderId = uid('ord_');
  let reference = await nextOrderReference(db);
  const now = nowIso();
  const orderItems = lines.map((line) => ({ ...line, id: uid('oit_') }));
  let inserted = false;
  for (let attempt = 0; attempt < 12 && !inserted; attempt += 1) {
    reference = await nextOrderReference(db, attempt);
    try {
      await db.batch([
      db
        .prepare(
          `INSERT INTO orders
            (id, reference, customer_id, user_id, email, name, country, currency, subtotal_cents, shipping_cents, total_cents,
             payment_status, fulfilment_status, shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_region,
             shipping_postcode, shipping_phone, placed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          orderId, reference, customer.id, ctx.auth ? ctx.auth.user.id : null, email, name, country.code, currency,
          subtotal, shipping, total, name, cleanText(form.get('line1'), 200), cleanText(form.get('line2'), 200) || null,
          cleanText(form.get('city'), 120), cleanText(form.get('region'), 120) || null, cleanText(form.get('postcode'), 40),
          cleanText(form.get('phone'), 40) || null, now, now,
        ),
      ...orderItems.map((line) =>
        db
          .prepare(
            `INSERT INTO order_items (id, order_id, product_id, name, sku, qty, unit_price_cents, line_total_cents, fulfilment_model, batch_item_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(line.id, orderId, line.product.id, line.product.name, line.product.sku, line.qty, line.product.price_cents, line.lineTotal, line.product.fulfilment_model, line.batchItemId || null),
        ),
      ]);
      inserted = true;
    } catch (err) {
      // Concurrent checkouts can race on the human-readable reference; retry with
      // the next available reference. Any other failure aborts cleanly.
      if (!/UNIQUE|constraint/i.test(String(err))) {
        return redirect(`/checkout?error=${encodeURIComponent('Your order could not be created. Please try again.')}`);
      }
    }
  }
  if (!inserted) {
    return redirect(`/checkout?error=${encodeURIComponent('Your order could not be created. Please try again.')}`);
  }

  const reservation = await reserveOrderStock(db, {
    orderId,
    userId: ctx.auth ? ctx.auth.user.id : null,
    items: orderItems.map((line) => ({
      orderItemId: line.id,
      productId: line.product.id,
      qty: line.qty,
      fulfilmentModel: line.product.fulfilment_model,
      batchItemId: line.batchItemId,
    })),
  });
  if (!reservation.ok) {
    await run(db, `UPDATE orders SET payment_status = 'failed', fulfilment_status = 'cancelled', updated_at = ? WHERE id = ?`, nowIso(), orderId);
    await audit(db, { action: 'checkout.stock_rejected', entityType: 'order', entityId: orderId, details: { reason: reservation.error }, ip: clientIp(request) });
    return redirect('/checkout?error=That%20quantity%20is%20no%20longer%20available.%20Please%20adjust%20your%20bag.');
  }

  const order = await one(db, 'SELECT * FROM orders WHERE id = ?', orderId);
  const session = await createPaymentSession(db, env, ctx.settings, { ...order, origin: url.origin });
  if (!session.ok) {
    await releaseOrderReservations(db, orderId, 'Payment session failed');
    await run(db, `UPDATE orders SET payment_status = 'failed', fulfilment_status = 'cancelled', updated_at = ? WHERE id = ?`, nowIso(), orderId);
    return redirect(`/checkout?error=${encodeURIComponent(session.error || 'Payment could not be started.')}`);
  }
  await audit(db, { action: 'order.created', entityType: 'order', entityId: orderId, details: { reference, total, provider: session.reference ? 'session' : null }, ip: clientIp(request) });
  return redirect(session.redirectUrl || `/order/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`);
}
