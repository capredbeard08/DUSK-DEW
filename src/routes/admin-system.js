/** Founder Console: analytics, content, notifications, payments, shipping, users, audit, settings, exports. */
import { all, audit, nowIso, one, run, settingsMap, setSetting, uid } from '../lib/db.js';
import { cleanText, clientIp, isSameOrigin, verifyCsrf, can, hashPassword } from '../lib/security.js';
import { csvResponse, parseDollars, readForm, redirect, html, intOr } from '../lib/http.js';
import { dashboardData, analyticsData, inventorySummary } from '../lib/reports.js';
import { providerConfigured, offlinePaymentsEnabled, enabledProviders } from '../lib/payments.js';
import { deliverQueuedEmails } from '../lib/email.js';
import {
  analyticsPage,
  contentPage,
  notificationsPage,
  paymentsPage,
  shippingPage,
  usersPage,
  auditPage,
  settingsPage,
} from '../views/console.js';

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

function envChecks(env) {
  return [
    { label: 'Paystack secret key', ok: Boolean(env.PAYSTACK_SECRET_KEY), detail: env.PAYSTACK_SECRET_KEY ? 'Present in the server environment.' : 'Not set — Paystack cannot be offered at checkout.' },
    { label: 'PayPal client credentials', ok: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), detail: env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? 'Present in the server environment.' : 'Not set — PayPal Checkout is unavailable.' },
    { label: 'PayPal webhook ID', ok: Boolean(env.PAYPAL_WEBHOOK_ID), detail: env.PAYPAL_WEBHOOK_ID ? 'Signature verification can be performed.' : 'Not set — PayPal webhooks will be refused.' },
    { label: 'Email provider + sending address', ok: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM), detail: env.RESEND_API_KEY && env.EMAIL_FROM ? 'Customer notifications can be delivered.' : 'Not set — notifications are recorded but not sent.' },
    { label: 'Sandbox payment mode off', ok: !offlinePaymentsEnabled(env), detail: offlinePaymentsEnabled(env) ? 'PAYMENTS_OFFLINE=1 — test capture page is reachable. Never enable in production.' : 'Production behaviour: only signed webhooks can mark orders paid.' },
  ];
}

function dateRange(url) {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86400000);
  const from = cleanText(url.searchParams.get('from'), 10) || defaultFrom.toISOString().slice(0, 10);
  const to = cleanText(url.searchParams.get('to'), 10) || today.toISOString().slice(0, 10);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return { from: iso.test(from) ? from : defaultFrom.toISOString().slice(0, 10), to: iso.test(to) ? to : today.toISOString().slice(0, 10) };
}

export async function handleAdminSystem({ db, request, env, url, path, method, auth }) {
  const settings = await settingsMap(db);
  const base = consoleBase(auth, settings, request);

  if (path === '/admin/analytics' && method === 'GET') {
    if (!can(auth.user, 'analytics.read')) return forbidden();
    const range = dateRange(url);
    const data = await analyticsData(db, range.from, range.to);
    return html(analyticsPage({ ...base, report: data.report, products: data.products, countries: data.countries, range }), 200);
  }

  if (path === '/admin/analytics/export.csv') {
    if (!can(auth.user, 'analytics.read')) return forbidden();
    const range = dateRange(url);
    const data = await analyticsData(db, range.from, range.to);
    const rows = [
      ['Metric', 'Value'],
      ['Period from', range.from],
      ['Period to', range.to],
      ['Gross revenue (cents)', data.report.gross],
      ['Refunds (cents)', data.report.refunds],
      ['Net revenue (cents)', data.report.net],
      ['Orders', data.report.orderCount],
      ['Paid orders', data.report.paidOrderCount],
      ['Average order value (cents)', data.report.aov],
      ['Pending value (cents)', data.report.pending],
      ['Units sold', data.report.unitsSold],
      ['Preorder units', data.report.preorderUnits],
      ['Waitlist conversion %', data.report.waitlistConversion],
      ['Preorder conversion %', data.report.preorderConversion],
      [],
      ['Product', 'Units', 'Revenue (cents)', 'Cost (cents)', 'Margin (cents)'],
      ...data.products.map((p) => [p.name, p.units, p.revenue, p.cost, p.revenue - p.cost]),
      [],
      ['Country', 'Orders', 'Revenue (cents)'],
      ...data.countries.map((c) => [c.country, c.orders, c.revenue]),
    ];
    return csvResponse(`dusk-dew-analytics-${range.from}-to-${range.to}.csv`, rows);
  }

  if (path === '/admin/content') {
    if (!can(auth.user, 'content.manage')) return forbidden();
    const rows = await all(db, 'SELECT * FROM site_content ORDER BY key');
    return html(contentPage({ ...base, content: Object.fromEntries(rows.map((r) => [r.key, r])) }), 200);
  }

  if (path.startsWith('/admin/content/') && method === 'POST') {
    if (!can(auth.user, 'content.manage')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const key = path.split('/')[3];
    const existing = await one(db, 'SELECT * FROM site_content WHERE key = ?', key);
    if (!existing) return redirect('/admin/content?error=Unknown%20content%20section');
    const title = cleanText(form.get('title'), 200);
    const body = cleanText(form.get('body'), 20000);
    if (!title || !body) return redirect(`/admin/content?error=Title%20and%20body%20are%20required.`);
    await run(db, 'UPDATE site_content SET title = ?, body = ?, updated_at = ?, updated_by = ? WHERE key = ?', title, body, nowIso(), auth.user.email, key);
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'content.updated', entityType: 'site_content', entityId: key, ip: clientIp(request) });
    return redirect('/admin/content?notice=Content%20saved');
  }

  if (path === '/admin/notifications') {
    const templates = await all(db, 'SELECT * FROM email_templates ORDER BY name');
    const outbox = await all(db, 'SELECT * FROM email_notifications ORDER BY created_at DESC LIMIT 40');
    const counts = { queued: 0, sent: 0, skipped: 0, failed: 0 };
    for (const row of await all(db, 'SELECT status, COUNT(*) AS c FROM email_notifications GROUP BY status')) {
      if (row.status in counts) counts[row.status] = Number(row.c);
    }
    return html(notificationsPage({ ...base, templates, outbox, counts, emailConfigured: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM) }), 200);
  }

  if (path === '/admin/notifications/deliver' && method === 'POST') {
    if (!can(auth.user, 'content.manage')) return forbidden();
    const { ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const result = await deliverQueuedEmails(db, env);
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'notifications.delivered', details: result, ip: clientIp(request) });
    return redirect(`/admin/notifications?notice=${encodeURIComponent(result.skipped ? 'No email provider configured — messages marked skipped.' : `Delivered ${result.sent} message(s).`)}`);
  }

  if (path.startsWith('/admin/notifications/templates/') && method === 'POST') {
    if (!can(auth.user, 'content.manage')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const key = path.split('/')[4];
    const template = await one(db, 'SELECT * FROM email_templates WHERE key = ?', key);
    if (!template) return redirect('/admin/notifications?error=Template%20not%20found');
    await run(
      db,
      'UPDATE email_templates SET subject = ?, body = ?, enabled = ?, updated_at = ? WHERE key = ?',
      cleanText(form.get('subject'), 200) || template.subject,
      cleanText(form.get('body'), 12000) || template.body,
      form.get('enabled') === '1' ? 1 : 0,
      nowIso(),
      key,
    );
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'email_template.updated', entityType: 'email_template', entityId: key, ip: clientIp(request) });
    return redirect('/admin/notifications?notice=Template%20saved');
  }

  if (path === '/admin/payments') {
    if (!can(auth.user, 'payments.manage')) return forbidden();
    if (method === 'POST') {
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      const enabling = form.get('payments_enabled') === '1';
      const provider = form.get('payment_provider') === 'paypal' ? 'paypal' : 'paystack';
      if (enabling && !providerConfigured(env, provider) && !offlinePaymentsEnabled(env)) {
        return redirect(`/admin/payments?error=${encodeURIComponent('No verified credentials are configured for that provider. Add the environment secrets before enabling payments.')}`);
      }
      await setSetting(db, 'payments_enabled', enabling ? '1' : '0');
      await setSetting(db, 'payment_provider', provider);
      await setSetting(db, 'payment_providers', 'paystack,paypal');
      if (['waitlist', 'live'].includes(form.get('store_mode'))) await setSetting(db, 'store_mode', form.get('store_mode'));
      await audit(db, {
        userId: auth.user.id,
        actorEmail: auth.user.email,
        action: enabling ? 'payments.enabled' : 'payments.disabled',
        entityType: 'settings',
        entityId: 'payments_enabled',
        details: { provider, storeMode: form.get('store_mode') },
        ip: clientIp(request),
      });
      return redirect('/admin/payments?notice=Payment%20settings%20saved');
    }
    const providers = (await enabledProviders(db, env, settings)).map((p) => p.provider);
    return html(
      paymentsPage({
        ...base,
        providers,
        envChecks: envChecks(env),
        webhookBase: env.APP_ORIGIN || url.origin,
        offline: offlinePaymentsEnabled(env),
      }),
      200,
    );
  }

  if (path === '/admin/shipping') {
    if (!can(auth.user, 'settings.manage')) return forbidden();
    if (method === 'POST') {
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      const code = cleanText(form.get('code'), 2).toUpperCase();
      const name = cleanText(form.get('name'), 80);
      if (!/^[A-Z]{2}$/.test(code) || !name) return redirect('/admin/shipping?error=Enter%20a%20two-letter%20country%20code%20and%20name.');
      if (await one(db, 'SELECT code FROM supported_countries WHERE code = ?', code)) return redirect('/admin/shipping?error=That%20destination%20already%20exists.');
      await run(
        db,
        'INSERT INTO supported_countries (code, name, enabled, shipping_cents, delivery_estimate, customs_note, sort_order) VALUES (?, ?, 0, NULL, NULL, NULL, ?)',
        code,
        name,
        intOr(form.get('sort_order'), 99),
      );
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'shipping.destination_added', entityType: 'country', entityId: code, ip: clientIp(request) });
      return redirect('/admin/shipping?notice=Destination%20added%20(disabled%20until%20you%20enable%20it)');
    }
    const countries = await all(db, 'SELECT * FROM supported_countries ORDER BY sort_order, name');
    return html(shippingPage({ ...base, countries, currency: settings.default_currency || 'USD' }), 200);
  }

  if (path.startsWith('/admin/shipping/') && method === 'POST') {
    if (!can(auth.user, 'settings.manage')) return forbidden();
    const { form, ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const code = path.split('/')[3].toUpperCase();
    const country = await one(db, 'SELECT * FROM supported_countries WHERE code = ?', code);
    if (!country) return redirect('/admin/shipping?error=Destination%20not%20found');
    const shipping = form.get('shipping') === '' ? null : parseDollars(form.get('shipping'));
    await run(
      db,
      'UPDATE supported_countries SET enabled = ?, shipping_cents = ?, delivery_estimate = ?, customs_note = ? WHERE code = ?',
      form.get('enabled') === '1' ? 1 : 0,
      shipping,
      cleanText(form.get('delivery_estimate'), 300) || null,
      cleanText(form.get('customs_note'), 1000) || null,
      code,
    );
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'shipping.destination_updated', entityType: 'country', entityId: code, details: { enabled: form.get('enabled'), shipping }, ip: clientIp(request) });
    return redirect('/admin/shipping?notice=Destination%20saved');
  }

  if (path === '/admin/users') {
    if (!can(auth.user, 'users.manage')) return forbidden();
    if (method === 'POST') {
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      const name = cleanText(form.get('name'), 120);
      const email = cleanText(form.get('email'), 254).toLowerCase();
      const password = String(form.get('password') || '');
      const role = ['founder', 'admin', 'staff'].includes(form.get('role')) ? form.get('role') : 'staff';
      if (!name || !email || password.length < 10) return redirect('/admin/users?error=Name%2C%20email%20and%20a%20password%20of%20at%20least%2010%20characters%20are%20required.');
      if (await one(db, 'SELECT id FROM users WHERE email = ?', email)) return redirect('/admin/users?error=That%20email%20already%20has%20an%20account.');
      const id = uid('usr_');
      await run(
        db,
        'INSERT INTO users (id, email, name, password_hash, role, is_active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)',
        id,
        email,
        name,
        await hashPassword(password),
        role,
        nowIso(),
      );
      await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: 'user.created', entityType: 'user', entityId: id, details: { email, role }, ip: clientIp(request) });
      return redirect('/admin/users?notice=User%20created%20with%20a%20temporary%20password');
    }
    const users = await all(db, `SELECT * FROM users WHERE role IN ('founder','admin','staff') ORDER BY created_at`);
    return html(usersPage({ ...base, users }), 200);
  }

  if (path.startsWith('/admin/users/') && path.endsWith('/toggle') && method === 'POST') {
    if (!can(auth.user, 'users.manage')) return forbidden();
    const { ok } = await postForm(request, auth);
    if (!ok) return forbidden();
    const id = path.split('/')[3];
    const user = await one(db, 'SELECT * FROM users WHERE id = ?', id);
    if (!user) return redirect('/admin/users?error=User%20not%20found');
    if (user.id === auth.user.id) return redirect('/admin/users?error=You%20cannot%20disable%20your%20own%20account.');
    if (user.role === 'founder' && user.is_active) {
      const founders = await one(db, `SELECT COUNT(*) AS c FROM users WHERE role = 'founder' AND is_active = 1`);
      if (Number(founders.c) <= 1) return redirect('/admin/users?error=At%20least%20one%20active%20founder%20is%20required.');
    }
    await run(db, 'UPDATE users SET is_active = ? WHERE id = ?', user.is_active ? 0 : 1, id);
    await run(db, 'DELETE FROM sessions WHERE user_id = ?', id);
    await audit(db, { userId: auth.user.id, actorEmail: auth.user.email, action: user.is_active ? 'user.disabled' : 'user.enabled', entityType: 'user', entityId: id, details: { email: user.email }, ip: clientIp(request) });
    return redirect('/admin/users?notice=User%20status%20updated');
  }

  if (path === '/admin/audit') {
    if (!can(auth.user, 'audit.read')) return forbidden();
    const q = cleanText(url.searchParams.get('q'), 100);
    const logs = q
      ? await all(db, 'SELECT * FROM audit_logs WHERE action LIKE ? OR actor_email LIKE ? OR entity_type LIKE ? ORDER BY created_at DESC LIMIT 300', `%${q}%`, `%${q}%`, `%${q}%`)
      : await all(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300');
    return html(auditPage({ ...base, logs, filters: { q } }), 200);
  }

  if (path === '/admin/audit/export.csv') {
    if (!can(auth.user, 'audit.read')) return forbidden();
    const logs = await all(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5000');
    return csvResponse('dusk-dew-audit-log.csv', [
      ['Created', 'Actor', 'Action', 'Entity type', 'Entity id', 'Details', 'IP'],
      ...logs.map((l) => [l.created_at, l.actor_email || 'system', l.action, l.entity_type || '', l.entity_id || '', l.details || '', l.ip || '']),
    ]);
  }

  if (path === '/admin/settings') {
    if (!can(auth.user, 'settings.manage')) return forbidden();
    if (method === 'POST') {
      const { form, ok } = await postForm(request, auth);
      if (!ok) return forbidden();
      const current = await settingsMap(db);
      const allowedCurrency = ['USD', 'GBP', 'EUR'];
      await setSetting(db, 'store_name', cleanText(form.get('store_name'), 80) || current.store_name || 'DUSK & DEW');
      await setSetting(db, 'store_tagline', cleanText(form.get('store_tagline'), 160) || current.store_tagline || '');
      await setSetting(db, 'support_email', cleanText(form.get('support_email'), 254) || '');
      if (allowedCurrency.includes(form.get('default_currency'))) await setSetting(db, 'default_currency', form.get('default_currency'));
      await setSetting(db, 'supported_currencies', cleanText(form.get('supported_currencies'), 60) || 'USD');
      await setSetting(db, 'preorders_enabled', form.get('preorders_enabled') === '1' ? '1' : '0');
      await setSetting(db, 'social_instagram', cleanText(form.get('social_instagram'), 300));
      await setSetting(db, 'social_tiktok', cleanText(form.get('social_tiktok'), 300));
      await setSetting(db, 'social_x', cleanText(form.get('social_x'), 300));
      await audit(db, {
        userId: auth.user.id,
        actorEmail: auth.user.email,
        action: 'settings.updated',
        entityType: 'settings',
        details: { preorders: form.get('preorders_enabled'), currency: form.get('default_currency') },
        ip: clientIp(request),
      });
      return redirect('/admin/settings?notice=Settings%20saved');
    }
    return html(settingsPage({ ...base, envChecks: envChecks(env), schemaVersion: settings.schema_version || 'unknown' }), 200);
  }

  if (path === '/admin/orders/export.csv') {
    if (!can(auth.user, 'orders.read')) return forbidden();
    const orders = await all(db, 'SELECT * FROM orders ORDER BY placed_at DESC LIMIT 10000');
    return csvResponse('dusk-dew-orders.csv', [
      ['Reference', 'Placed', 'Email', 'Name', 'Country', 'Currency', 'Subtotal cents', 'Shipping cents', 'Total cents', 'Payment', 'Fulfilment', 'Provider', 'Payment reference', 'Tracking', 'Carrier', 'Paid at'],
      ...orders.map((o) => [o.reference, o.placed_at, o.email, o.name, o.country, o.currency, o.subtotal_cents, o.shipping_cents, o.total_cents, o.payment_status, o.fulfilment_status, o.payment_provider || '', o.payment_reference || '', o.tracking_number || '', o.shipping_provider || '', o.paid_at || '']),
    ]);
  }

  if (path === '/admin/inventory/export.csv') {
    if (!can(auth.user, 'inventory.read')) return forbidden();
    const rows = await all(
      db,
      `SELECT p.name, p.sku, i.physical_stock, i.reserved_stock, i.units_sold, p.low_stock_threshold, p.status, i.last_restock_at, p.cost_cents
       FROM products p JOIN inventory i ON i.product_id = p.id ORDER BY p.name`,
    );
    return csvResponse('dusk-dew-inventory.csv', [
      ['Product', 'SKU', 'Physical', 'Reserved', 'Available', 'Units sold', 'Low stock threshold', 'Status', 'Last restock', 'Unit cost cents', 'Stock value cents'],
      ...rows.map((r) => [r.name, r.sku, r.physical_stock, r.reserved_stock, r.physical_stock - r.reserved_stock, r.units_sold, r.low_stock_threshold, r.status, r.last_restock_at || '', r.cost_cents ?? '', (r.cost_cents || 0) * r.physical_stock]),
    ]);
  }

  return null;
}
