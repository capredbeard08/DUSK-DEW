/** Customer account routes: sign-in, registration, order history, profile. */
import { all, audit, nowIso, one, run, uid } from '../lib/db.js';
import {
  createSession,
  destroySession,
  getAuth,
  hashPassword,
  verifyPassword,
  verifyCsrf,
  verifyGuestCsrf,
  rateLimit,
  clientIp,
  validEmail,
  cleanText,
} from '../lib/security.js';
import { html, redirect, publicContext, readForm } from '../lib/http.js';
import { loginPage, accountPage, passwordPage } from '../views/account.js';
import { notFoundPage } from '../views/public.js';
import { queueEmail } from '../lib/email.js';

export async function handleAccount({ db, request, env, url, path, method }) {
  const isPost = method === 'POST';

  if (path === '/account/login' || path === '/account/register') {
    const mode = path.endsWith('register') ? 'register' : 'login';
    const ctx = await publicContext(db, request);
    if (!isPost) {
      if (ctx.auth) return redirect('/account');
      return html(loginPage(ctx, { mode }), 200, ctx.cookies);
    }
    const form = await readForm(request);
    if (!ctx.auth && !verifyGuestCsrf(request, form || new FormData())) {
      return html(loginPage(ctx, { mode, error: 'Your session expired. Please try again.' }), 403, ctx.cookies);
    }
    const ip = clientIp(request);
    const limit = await rateLimit(db, `login:${ip}`, 10, 900);
    if (!limit.allowed) {
      return html(loginPage(ctx, { mode, error: 'Too many attempts. Please wait 15 minutes and try again.' }), 429, ctx.cookies);
    }
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');

    if (mode === 'register') {
      const name = cleanText(form.get('name'), 120);
      if (!name || !validEmail(email) || password.length < 10) {
        return html(
          loginPage(ctx, { mode, error: 'Enter a name, a valid email and a password of at least 10 characters.' }),
          422,
          ctx.cookies,
        );
      }
      const existing = await one(db, 'SELECT id FROM users WHERE email = ?', email);
      if (existing) {
        return html(loginPage(ctx, { mode, error: 'An account with that email already exists. Try signing in.' }), 409, ctx.cookies);
      }
      const userId = uid('usr_');
      await run(
        db,
        `INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 'customer', 1, ?)`,
        userId,
        email,
        name,
        await hashPassword(password),
        nowIso(),
      );
      await run(
        db,
        `INSERT INTO customers (id, email, name, country, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, name = excluded.name`,
        uid('cus_'),
        email,
        name,
        cleanText(form.get('country'), 2) || null,
        userId,
        nowIso(),
      );
      const session = await createSession(db, userId, request);
      await audit(db, { userId, actorEmail: email, action: 'account.created', entityType: 'user', entityId: userId, ip });
      await queueEmail(db, { to: email, templateKey: 'account_registration', data: { name } });
      return redirect('/account', 303, [session.setCookie]);
    }

    const user = await one(db, 'SELECT * FROM users WHERE email = ?', email);
    const ok = user && user.is_active && (await verifyPassword(password, user.password_hash));
    if (!ok) {
      await audit(db, { action: 'auth.login_failed', entityType: 'user', entityId: email, ip });
      return html(loginPage(ctx, { mode, error: 'Those details do not match an active account.', email }), 401, ctx.cookies);
    }
    await run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
    const session = await createSession(db, user.id, request);
    await audit(db, { userId: user.id, actorEmail: user.email, action: 'auth.login', entityType: 'user', entityId: user.id, ip });
    const target = user.must_change_password ? '/account/password' : ['founder', 'admin', 'staff'].includes(user.role) ? '/admin' : '/account';
    return redirect(target, 303, [session.setCookie]);
  }

  if (path === '/account/logout') {
    if (!isPost) return redirect('/account');
    const ctx = await publicContext(db, request);
    const form = await readForm(request);
    if (ctx.auth && !verifyCsrf(form, ctx.auth, request)) return html('<h1>Invalid request</h1>', 403);
    await destroySession(db, request);
    return redirect('/', 303, []);
  }

  if (path === '/account') {
    const ctx = await publicContext(db, request);
    if (!ctx.auth) return redirect('/account/login');
    const customer =
      (await one(db, 'SELECT * FROM customers WHERE user_id = ? OR email = ?', ctx.auth.user.id, ctx.auth.user.email)) || null;
    if (!customer) return redirect('/account/login');
    const orders = await all(db, 'SELECT * FROM orders WHERE email = ? ORDER BY placed_at DESC LIMIT 25', customer.email);
    const addresses = await all(db, 'SELECT * FROM addresses WHERE customer_id = ? ORDER BY created_at DESC', customer.id);
    const waitlist = await all(
      db,
      `SELECT w.*, p.name AS product_name FROM waitlist w LEFT JOIN products p ON p.id = w.product_id
       WHERE w.email = ? ORDER BY w.created_at DESC`,
      customer.email,
    );
    const page = {
      ...ctx,
      customer,
      orders,
      addresses,
      waitlist,
      mustChangePassword: ctx.auth.user.mustChangePassword,
    };
    return html(accountPage(page), 200, ctx.cookies);
  }

  if (path === '/account/profile' || path === '/account/address') {
    if (!isPost) return redirect('/account');
    const ctx = await publicContext(db, request);
    if (!ctx.auth) return redirect('/account/login');
    const form = await readForm(request);
    if (!verifyCsrf(form, ctx.auth, request)) return html('<h1>Invalid request</h1>', 403);
    const customer = await one(db, 'SELECT * FROM customers WHERE user_id = ? OR email = ?', ctx.auth.user.id, ctx.auth.user.email);
    if (!customer) return redirect('/account/login');

    if (path === '/account/profile') {
      const name = cleanText(form.get('name'), 120) || customer.name;
      const country = cleanText(form.get('country'), 60) || customer.country;
      const marketing = form.get('marketing') ? 1 : 0;
      await run(db, 'UPDATE customers SET name = ?, country = ?, accepts_marketing = ? WHERE id = ?', name, country, marketing, customer.id);
      await run(db, 'UPDATE users SET name = ? WHERE id = ?', name, ctx.auth.user.id);
      await audit(db, { userId: ctx.auth.user.id, actorEmail: ctx.auth.user.email, action: 'account.profile_updated', entityType: 'customer', entityId: customer.id, ip: clientIp(request) });
      return redirect('/account?notice=Details%20saved');
    }

    const required = ['line1', 'city', 'postcode', 'country'];
    const missing = required.filter((f) => !cleanText(form.get(f), 200));
    if (missing.length) return redirect('/account?error=Address%20is%20incomplete');
    await run(
      db,
      `INSERT INTO addresses (id, customer_id, line1, line2, city, region, postcode, country, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid('adr_'),
      customer.id,
      cleanText(form.get('line1'), 200),
      cleanText(form.get('line2'), 200) || null,
      cleanText(form.get('city'), 120),
      cleanText(form.get('region'), 120) || null,
      cleanText(form.get('postcode'), 40),
      cleanText(form.get('country'), 60),
      cleanText(form.get('phone'), 40) || null,
      nowIso(),
    );
    return redirect('/account?notice=Address%20saved');
  }

  if (path === '/account/password') {
    const ctx = await publicContext(db, request);
    if (!ctx.auth) return redirect('/account/login');
    if (!isPost) return html(passwordPage({ ...ctx, auth: ctx.auth, mustChangePassword: ctx.auth.user.mustChangePassword }), 200, ctx.cookies);
    const form = await readForm(request);
    if (!verifyCsrf(form, ctx.auth, request)) return html('<h1>Invalid request</h1>', 403);
    const user = await one(db, 'SELECT * FROM users WHERE id = ?', ctx.auth.user.id);
    const current = String(form.get('current') || '');
    const next = String(form.get('password') || '');
    const confirm = String(form.get('confirm') || '');
    if (!(await verifyPassword(current, user.password_hash))) {
      return html(passwordPage({ ...ctx }, { error: 'Your current password is incorrect.' }), 401, ctx.cookies);
    }
    if (next.length < 10 || next !== confirm) {
      return html(passwordPage({ ...ctx }, { error: 'New passwords must match and be at least 10 characters.' }), 422, ctx.cookies);
    }
    await run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(next), user.id);
    await run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, ctx.auth.sessionId);
    await audit(db, { userId: user.id, actorEmail: user.email, action: 'account.password_changed', entityType: 'user', entityId: user.id, ip: clientIp(request) });
    return html(passwordPage({ ...ctx, mustChangePassword: false }, { notice: 'Password updated. Other sessions have been signed out.' }), 200, ctx.cookies);
  }

  return null;
}
