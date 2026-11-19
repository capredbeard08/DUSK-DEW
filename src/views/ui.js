/** Shared HTML rendering helpers, layout shells and design-system components. */
import { escapeHtml as h } from '../lib/security.js';
import { money } from '../lib/email.js';

export { h, money };

export const TONES = {
  amber: { glass: '#B07A33', glassDark: '#7C4E1B', label: '#F6EFE3' },
  deep: { glass: '#6E4A2C', glassDark: '#43290F', label: '#F3EADB' },
  soft: { glass: '#C79A62', glassDark: '#94682F', label: '#FBF4E8' },
  green: { glass: '#3E5C4A', glassDark: '#223A2C', label: '#F1EBDF' },
};

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function fmtDateTime(iso) {
  return fmtDate(iso, true);
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

let bottleSeq = 0;
export function bottleArt({ name = '', net = '', tone = 'amber', imageUrl = null, className = '' }) {
  if (imageUrl) {
    return `<img class="bottle-photo ${h(className)}" src="${h(imageUrl)}" alt="${h(name)}" loading="lazy">`;
  }
  const t = TONES[tone] || TONES.amber;
  const id = `btl${(bottleSeq += 1)}`;
  return `<svg class="bottle-art ${h(className)}" viewBox="0 0 260 340" role="img" aria-label="${h(name)}">
  <defs>
    <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.glassDark}"/><stop offset="0.35" stop-color="${t.glass}"/>
      <stop offset="0.7" stop-color="${t.glass}"/><stop offset="1" stop-color="${t.glassDark}"/>
    </linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <ellipse cx="130" cy="316" rx="86" ry="12" fill="#1C3A2E" opacity="0.10"/>
  <rect x="97" y="30" width="66" height="26" rx="6" fill="#2A241C"/>
  <rect x="104" y="52" width="52" height="14" rx="3" fill="#3B3327"/>
  <path d="M104 66h52c12 0 22 10 22 22v208c0 8-6 14-14 14H96c-8 0-14-6-14-14V88c0-12 10-22 22-22z" fill="url(#${id}a)"/>
  <rect x="88" y="120" width="84" height="110" rx="4" fill="${t.label}" opacity="0.94"/>
  <text x="130" y="150" text-anchor="middle" font-family="Georgia,serif" font-size="10" letter-spacing="2.4" fill="#1C3A2E">DUSK &amp; DEW</text>
  <line x1="106" y1="160" x2="154" y2="160" stroke="#C8A96A" stroke-width="0.8"/>
  <text x="130" y="182" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="#3B4B41">${h(truncate(name, 26))}</text>
  <text x="130" y="206" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="7.5" letter-spacing="1" fill="#6B6F68">${h(net)}</text>
  <path d="M118 78h8v200h-8z" fill="url(#${id}b)" opacity="0.5"/>
</svg>`;
}

function truncate(value, max) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function csrfInput(token) {
  return `<input type="hidden" name="_csrf" value="${h(token)}">`;
}

export function noticeBar(searchParams) {
  const notice = searchParams.get('notice');
  const error = searchParams.get('error');
  if (!notice && !error) return '';
  return `${error ? `<div class="flash flash-error" role="alert">${h(error)}</div>` : ''}
  ${notice ? `<div class="flash flash-ok" role="status">${h(notice)}</div>` : ''}`;
}

export const STATUS_LABELS = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Processing',
  production_pending: 'Production pending',
  ready_for_dispatch: 'Ready for dispatch',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  needs_attention: 'Needs attention',
  unpaid: 'Unpaid',
  pending: 'Pending',
  failed: 'Failed',
  partially_refunded: 'Partially refunded',
  draft: 'Draft',
  active: 'Active',
  out_of_stock: 'Out of stock',
  temporarily_unavailable: 'Temporarily unavailable',
  discontinued: 'Discontinued',
  planned: 'Planned',
  awaiting_manufacturer: 'Awaiting manufacturer',
  production_started: 'Production started',
  quality_review: 'Quality review',
  completed: 'Completed',
  received: 'Received into inventory',
  waiting: 'Waiting',
  notified: 'Notified',
  converted: 'Converted',
  queued: 'Queued',
  sent: 'Sent',
  skipped: 'Skipped',
};

export function pill(status) {
  return `<span class="pill pill-${h(String(status).replace(/_/g, '-'))}">${h(STATUS_LABELS[status] || status)}</span>`;
}

export function stockPill(stock) {
  return `<span class="stock stock-${h(stock.key)}">${h(stock.label)}</span>`;
}

export function productCard(product, stock) {
  return `<article class="card">
  <a class="card-media" href="/shop/${h(product.slug)}">
    ${bottleArt({ name: product.name, net: product.net_contents, tone: product.image_tone, imageUrl: product.image_url })}
    ${product.fulfilment_model === 'preorder' ? '<span class="card-flag">Preorder</span>' : ''}
  </a>
  <div class="card-body">
    <p class="eyebrow">${h(product.category_name || 'Skincare')}</p>
    <h3><a href="/shop/${h(product.slug)}">${h(product.name)}</a></h3>
    <p class="card-sub">${h(product.subtitle || '')}</p>
    <div class="card-foot">
      <span class="price">${money(product.price_cents, product.currency)}</span>
      ${stockPill(stock)}
    </div>
  </div>
</article>`;
}

export function pager(baseUrl, { page, pages }) {
  if (pages <= 1) return '';
  const url = new URL(baseUrl, 'https://x.local');
  const link = (p, label, cls = '') => {
    url.searchParams.set('page', String(p));
    return `<a class="page-link ${cls}" href="${h(url.pathname + url.search)}">${h(label)}</a>`;
  };
  return `<nav class="pager" aria-label="Pagination">
    ${page > 1 ? link(page - 1, '← Previous') : '<span class="page-link disabled">← Previous</span>'}
    <span class="page-count">Page ${page} of ${pages}</span>
    ${page < pages ? link(page + 1, 'Next →') : '<span class="page-link disabled">Next →</span>'}
  </nav>`;
}

export function field({ label, name, value = '', type = 'text', required = false, placeholder = '', hint = '', attrs = '', options = null, rows = 4 }) {
  const id = `f-${name}`;
  const common = `id="${id}" name="${h(name)}" ${required ? 'required' : ''} ${attrs}`;
  let control;
  if (type === 'textarea') {
    control = `<textarea ${common} rows="${rows}" placeholder="${h(placeholder)}">${h(value)}</textarea>`;
  } else if (type === 'select') {
    control = `<select ${common}>${(options || [])
      .map((o) => `<option value="${h(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${h(o.label)}</option>`)
      .join('')}</select>`;
  } else if (type === 'checkbox') {
    control = `<label class="check"><input type="checkbox" ${common} ${value ? 'checked' : ''}> <span>${h(placeholder || label)}</span></label>`;
    return `<div class="field field-check">${control}${hint ? `<p class="hint">${h(hint)}</p>` : ''}</div>`;
  } else {
    control = `<input ${common} type="${h(type)}" value="${h(value)}" placeholder="${h(placeholder)}">`;
  }
  return `<div class="field">
    <label for="${id}">${h(label)}${required ? ' <span class="req">*</span>' : ''}</label>
    ${control}
    ${hint ? `<p class="hint">${h(hint)}</p>` : ''}
  </div>`;
}

const NAV_LINKS = [
  ['/shop', 'Shop', 'shop'],
  ['/ingredients', 'Ingredients', 'ingredients'],
  ['/our-story', 'Our Story', 'story'],
  ['/preorder-information', 'Preorder', 'preorder'],
  ['/shipping-and-returns', 'Shipping & Returns', 'shipping'],
  ['/contact', 'Contact', 'contact'],
];

export function publicLayout({ title, description = '', body, active = '', bodyClass = '', settings = {}, auth = null, searchParams = new URLSearchParams(), csrf = '' }) {
  const notice = noticeBar(searchParams);
  const nav = NAV_LINKS.map(
    ([href, label, key]) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`,
  ).join('');
  const announcement = settings.announcement_title
    ? `<div class="announce"><span>${h(settings.announcement_title)}</span> ${h(settings.announcement_body || '')}</div>`
    : '';
  const accountLinks = auth
    ? `<a href="/account">Account</a>${auth.user && ['founder', 'admin', 'staff'].includes(auth.user.role) ? '<a href="/admin">Console</a>' : ''}`
    : `<a href="/account/login">Sign in</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · DUSK &amp; DEW</title>
<meta name="description" content="${h(description || 'DUSK & DEW — considered skincare in amber glass. Full ingredient disclosure, recorded production batches, international shipping.')}">
<meta name="theme-color" content="#1C3A2E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..500&family=Hanken+Grotesk:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/theme.css">
<script src="/theme-init.js"></script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="public${bodyClass ? ` ${h(bodyClass)}` : ''}">
<a class="skip" href="#main">Skip to content</a>
${announcement}
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><span class="brand-name">DUSK &amp; DEW</span><span class="brand-tag">Skin, from first dew to last light.</span></a>
    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Toggle navigation">
    <label for="nav-toggle" class="nav-button" aria-hidden="true"><span></span><span></span><span></span></label>
    <nav class="site-nav" aria-label="Primary">${nav}</nav>
    <div class="header-tools">
      ${accountLinks}
      <a class="bag-link" href="/bag">Bag <span id="bag-count" class="bag-count" aria-live="polite">0</span></a>
    </div>
  </div>
</header>
<main id="main">
  ${notice ? `<div class="wrap">${notice}</div>` : ''}
  ${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <p class="brand-name">DUSK &amp; DEW</p>
      <p class="footer-tagline">Skin, from first dew to last light.</p>
      <p class="footer-note">Nigerian-founded. Formulated with recording and disclosure at the centre.</p>
    </div>
    <div>
      <p class="footer-head">Shop</p>
      <a href="/shop">All products</a>
      <a href="/shop?category=serums">Serums</a>
      <a href="/shop?category=balms-moisturisers">Balms &amp; moisturisers</a>
      <a href="/shop?category=rituals">Ritual sets</a>
    </div>
    <div>
      <p class="footer-head">House</p>
      <a href="/our-story">Our story</a>
      <a href="/ingredients">Ingredient library</a>
      <a href="/preorder-information">Preorder information</a>
      <a href="/contact">Contact</a>
    </div>
    <div>
      <p class="footer-head">Care</p>
      <a href="/shipping-and-returns">Shipping &amp; returns</a>
      <a href="/account">Your account</a>
      <a href="/waitlist">Waitlist</a>
      ${settings.support_email ? `<a href="mailto:${h(settings.support_email)}">${h(settings.support_email)}</a>` : ''}
    </div>
    <div class="footer-news">
      <p class="footer-head">Letters from the studio</p>
      <form method="post" action="/newsletter" class="inline-form">
        ${csrfInput(csrf)}
        <label class="sr-only" for="news-email">Email address</label>
        <input id="news-email" type="email" name="email" placeholder="Email address" required>
        <button class="btn btn-dark" type="submit">Subscribe</button>
      </form>
      <p class="footer-note">Occasional notes on batches, restocks and new formulas. Unsubscribe at any time.</p>
      <div class="socials" data-socials>
        ${settings.social_instagram ? `<a href="${h(settings.social_instagram)}" rel="noopener">Instagram</a>` : ''}
        ${settings.social_tiktok ? `<a href="${h(settings.social_tiktok)}" rel="noopener">TikTok</a>` : ''}
        ${settings.social_x ? `<a href="${h(settings.social_x)}" rel="noopener">X</a>` : ''}
      </div>
    </div>
  </div>
  <div class="wrap footer-base">
    <p>© ${new Date().getFullYear()} DUSK &amp; DEW. All rights reserved.</p>
    <p>Prices displayed in ${h(settings.default_currency || 'USD')}. Import duties may apply on arrival.</p>
  </div>
</footer>
<script src="/vendor/gsap/gsap.min.js" defer></script>
<script src="/vendor/gsap/ScrollTrigger.min.js" defer></script>
<script src="/vendor/gsap/SplitText.min.js" defer></script>
<script src="/vendor/gsap/DrawSVGPlugin.min.js" defer></script>
<script src="/vendor/gsap/MotionPathPlugin.min.js" defer></script>
<script src="/app.js" defer></script>
<script src="/theme.js" defer></script>
</body>
</html>`;
}

const CONSOLE_NAV = [
  { group: 'Business', items: [['/admin', 'Overview', 'overview']] },
  { group: 'Catalogue', items: [['/admin/products', 'Products', 'products'], ['/admin/categories', 'Categories', 'categories'], ['/admin/ingredients', 'Ingredients', 'ingredients'], ['/admin/inventory', 'Inventory', 'inventory'], ['/admin/restocks', 'Restocking', 'restocks']] },
  { group: 'Sales', items: [['/admin/orders', 'Orders', 'orders'], ['/admin/customers', 'Customers', 'customers'], ['/admin/preorders', 'Preorders & waitlist', 'preorders']] },
  { group: 'Production', items: [['/admin/batches', 'Production batches', 'batches']] },
  { group: 'Insights', items: [['/admin/analytics', 'Analytics', 'analytics']] },
  { group: 'Storefront', items: [['/admin/content', 'Content', 'content'], ['/admin/notifications', 'Notifications', 'notifications'], ['/admin/shipping', 'Shipping', 'shipping'], ['/admin/payments', 'Payments', 'payments']] },
  { group: 'Administration', items: [['/admin/users', 'Users & permissions', 'users'], ['/admin/audit', 'Audit log', 'audit'], ['/admin/settings', 'System settings', 'settings']] },
];

export function consoleLayout({ title, body, active = '', user, searchParams = new URLSearchParams(), subtitle = '', csrf = '' }) {
  const notice = noticeBar(searchParams);
  const nav = CONSOLE_NAV.map(
    (group) => `<div class="cgroup"><p>${h(group.group)}</p>${group.items
      .map(([href, label, key]) => `<a href="${href}" class="${active === key ? 'active' : ''}">${h(label)}</a>`)
      .join('')}</div>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · DUSK &amp; DEW Founder Console</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="console">
<input type="checkbox" id="console-nav-toggle" class="nav-toggle">
<aside class="console-side">
  <div class="console-brand">
    <a href="/admin"><span class="brand-name">DUSK &amp; DEW</span><span class="console-sub">Founder Console</span></a>
  </div>
  <nav class="console-nav" aria-label="Console">${nav}</nav>
  <div class="console-foot">
    <p>${h(user.name)} · ${h(user.role)}</p>
    <p class="muted">${h(user.email)}</p>
    <div class="console-foot-links">
      <a href="/" target="_blank" rel="noopener">View storefront ↗</a>
      <form method="post" action="/admin/logout">${csrfInput(csrf)}<button class="linklike" type="submit">Sign out</button></form>
    </div>
  </div>
</aside>
<div class="console-main">
  <header class="console-top">
    <label for="console-nav-toggle" class="console-menu" aria-hidden="true">☰</label>
    <div>
      <h1>${h(title)}</h1>
      ${subtitle ? `<p class="console-subtitle">${h(subtitle)}</p>` : ''}
    </div>
    <div class="console-top-right">
      <a class="btn btn-quiet" href="/admin/orders">Orders</a>
      <a class="btn btn-dark" href="/admin/products/new">Add product</a>
    </div>
  </header>
  ${notice ? `<div class="console-notice">${notice}</div>` : ''}
  <div class="console-body">${body}</div>
</div>
<script src="/app.js" defer></script>
</body>
</html>`;
}

export function statCard(label, value, meta = '') {
  return `<div class="stat"><p class="stat-label">${h(label)}</p><p class="stat-value">${h(value)}</p>${meta ? `<p class="stat-meta">${h(meta)}</p>` : ''}</div>`;
}

export function emptyState(title, text = '', action = '') {
  return `<div class="empty"><p class="empty-title">${h(title)}</p>${text ? `<p>${h(text)}</p>` : ''}${action}</div>`;
}

export function table(headers, rows, opts = {}) {
  if (!rows.length) return emptyState(opts.empty || 'Nothing here yet', opts.emptyText || '');
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${headers.map((hd) => `<th${hd.align ? ` class="ta-${hd.align}"` : ''}>${h(hd.label ?? hd)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td${headers[i]?.align ? ` class="ta-${headers[i].align}"` : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
