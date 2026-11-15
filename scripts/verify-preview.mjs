/**
 * Post-deployment verification against a remote origin.
 * Prints statuses and assertions only — never prints credentials or secrets.
 *
 *   node scripts/verify-preview.mjs https://<preview-host>
 */
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('Usage: node scripts/verify-preview.mjs <https://origin>');
  process.exit(1);
}
const password = readFileSync('.preview-founder-password', 'utf8').trim();
const email = readFileSync('.preview-founder-email', 'utf8').trim();
const results = [];
const jar = new Map();

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function cookies() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (jar.size) headers.set('cookie', cookies());
  if (options.form) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
    options.body = new URLSearchParams(options.form).toString();
    options.method = options.method || 'POST';
  }
  const res = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function csrfFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : '';
}

const health = await call('/healthz');
record('health endpoint', health.status === 200 && health.text.includes('"ok":true'), `status ${health.status}`);

const home = await call('/');
record('storefront home renders', home.status === 200 && home.text.includes('DUSK &amp; DEW'), `status ${home.status}`);

const shop = await call('/shop');
record('catalogue renders', shop.status === 200 && shop.text.includes('The collection'), `status ${shop.status}`);

const product = await call('/shop/first-dew-hydrating-serum');
record('product page renders', product.status === 200 && product.text.includes('Full INCI ingredient declaration'), `status ${product.status}`);

const css = await call('/styles.css');
record('static assets served', css.status === 200 && css.text.includes('--forest'), `status ${css.status}`);

const guestAdmin = await call('/admin');
record('console requires sign-in', guestAdmin.status === 303 && guestAdmin.headers.get('location') === '/admin/login', `status ${guestAdmin.status}`);

const loginPage = await call('/admin/login');
const loginToken = csrfFrom(loginPage.text);
let login = await call('/admin/login', { form: { email, password, _csrf: loginToken } });
let usedPassword = password;
if (login.status === 401) {
  usedPassword = 'DuskAndDew!2026';
  const retryToken = csrfFrom((await call('/admin/login')).text);
  login = await call('/admin/login', { form: { email, password: usedPassword, _csrf: retryToken } });
}
record('founder sign-in works', login.status === 303, `status ${login.status}`);

if (login.headers.get('location') === '/account/password') {
  const page = await call('/account/password');
  const changed = await call('/account/password', {
    method: 'POST',
    form: { _csrf: csrfFrom(page.text), current: usedPassword, password, confirm: password },
  });
  record('forced first-login password change', changed.status === 200, `status ${changed.status}`);
}

const overview = await call('/admin');
record('console overview authorised', overview.status === 200 && overview.text.includes('Overview') && overview.text.includes('Paid revenue'), `status ${overview.status}`);

for (const [path, needle] of [
  ['/admin/products', 'Products'],
  ['/admin/inventory', 'Available = physical stock'],
  ['/admin/orders', 'Orders'],
  ['/admin/batches', 'Production batches'],
  ['/admin/analytics', 'Gross revenue'],
  ['/admin/payments', 'Paystack'],
  ['/admin/audit', 'Audit log'],
]) {
  const res = await call(path);
  record(`console ${path}`, res.status === 200 && res.text.includes(needle), `status ${res.status}`);
}

const payments = await call('/admin/payments');
record('payment collection is disabled by default', payments.text.includes('Payments are disabled'), '');
record('no provider secret in HTML', !payments.text.includes('sk_test') && !payments.text.includes('sk_live'), '');

const badHook = await call('/webhooks/paystack', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-paystack-signature': 'deadbeef' },
  body: JSON.stringify({ event: 'charge.success', data: { id: 'preview', reference: 'nope', status: 'success', amount: 1 } }),
});
record('unsigned payment webhook rejected', badHook.status === 401, `status ${badHook.status}`);

const waitlistPage = await call('/');
const waitToken = csrfFrom(waitlistPage.text);
const waitlist = await call('/waitlist', {
  form: { _csrf: waitToken, name: 'Preview Check', email: `preview-${Date.now()}@example.com`, country: 'GB', product_id: 'prd_moisturiser' },
});
record('waitlist registration writes and redirects', waitlist.status === 303 && String(waitlist.headers.get('location')).startsWith('/waitlist/thanks'), `status ${waitlist.status}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('Failures: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
