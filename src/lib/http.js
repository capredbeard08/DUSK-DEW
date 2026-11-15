/** HTTP response helpers, page context builders and shared request utilities. */
import { all, settingsMap } from '../lib/db.js';
import { getAuth, guestCsrf } from '../lib/security.js';
import { stockBadge } from '../lib/inventory.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
};

export function html(body, status = 200, cookies = [], extra = {}) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra });
  cookies.filter(Boolean).forEach((c) => headers.append('set-cookie', c));
  return new Response(body, { status, headers });
}

export function redirect(location, status = 303, cookies = []) {
  const headers = new Headers({ location, ...SECURITY_HEADERS });
  cookies.filter(Boolean).forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status, headers });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

export function csvResponse(filename, rows) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n');
  return new Response(`\uFEFF${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...SECURITY_HEADERS,
    },
  });
}

export function contentMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.key, row]));
}

export async function publicContext(db, request) {
  const settings = await settingsMap(db);
  settings.countries = await all(db, 'SELECT * FROM supported_countries ORDER BY sort_order, name');
  const content = contentMap(await all(db, 'SELECT * FROM site_content ORDER BY key'));
  const auth = await getAuth(db, request);
  const guest = auth ? { token: auth.csrfToken, setCookie: null } : guestCsrf(request);
  return {
    settings,
    content,
    auth,
    csrf: guest.token,
    cookies: guest.setCookie ? [guest.setCookie] : [],
    searchParams: new URL(request.url).searchParams,
  };
}

/** Public catalogue with computed stock state. Drafts and discontinued items stay hidden. */
export async function catalogue(db, settings, { includeUnavailable = true } = {}) {
  const rows = await all(
    db,
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
            COALESCE(i.physical_stock, 0) AS physical_stock,
            COALESCE(i.reserved_stock, 0) AS reserved_stock,
            COALESCE(i.units_sold, 0) AS units_sold,
            i.last_restock_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.status NOT IN ('draft','discontinued')
     ORDER BY p.featured DESC, p.created_at ASC`,
  );
  return rows
    .filter((p) => includeUnavailable || stockBadge(p, p, settings).purchasable)
    .map((product) => ({ product, stock: stockBadge(product, product, settings) }));
}

export async function readForm(request) {
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const data = await request.json();
      const form = new FormData();
      for (const [key, value] of Object.entries(data || {})) form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      return form;
    }
    return await request.formData();
  } catch {
    return null;
  }
}

export function parseDollars(value) {
  const raw = String(value ?? '').trim().replace(/[^0-9.-]/g, '');
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function intOr(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(num) ? num : fallback;
}

export function booleanish(value) {
  return value === '1' || value === 'on' || value === 'true' ? 1 : 0;
}

export function isAssetPath(path) {
  return /\.(css|js|mjs|svg|png|jpe?g|webp|ico|woff2?|txt|map)$/i.test(path);
}
