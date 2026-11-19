/** Founder Console pages. Every action is a server-rendered form with CSRF. */
import {
  consoleLayout,
  field,
  csrfInput,
  h,
  money,
  fmtDate,
  fmtDateTime,
  pill,
  table,
  statCard,
  emptyState,
  pager,
  STATUS_LABELS,
} from './ui.js';
import { CURRENCIES } from '../lib/pricing.js';

const PRODUCT_STATUSES = ['draft', 'active', 'out_of_stock', 'temporarily_unavailable', 'discontinued'];
const FULFILMENT_STATUSES = ['awaiting_payment', 'paid', 'processing', 'production_pending', 'ready_for_dispatch', 'shipped', 'delivered', 'cancelled', 'refunded', 'needs_attention'];
const BATCH_STATUSES = ['planned', 'awaiting_manufacturer', 'production_started', 'quality_review', 'completed', 'received', 'cancelled'];

const page = (base, opts) => consoleLayout({ ...base, ...opts, csrf: base.csrf });

function panel(title, body, note = '') {
  return `<section class="panel"><div class="panel-head"><h2>${h(title)}</h2>${note ? `<p class="fine">${h(note)}</p>` : ''}</div>${body}</section>`;
}

export function consoleLoginPage({ error = '', email = '', csrf = '', demo = null }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Founder Console · DUSK &amp; DEW</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head><body class="console console-login">
<main class="login-shell">
  <div class="login-brand"><span class="brand-name">DUSK &amp; DEW</span><span class="console-sub">Founder Console</span></div>
  <form class="panel-form login-form" method="post" action="/admin/login">
    ${csrfInput(csrf)}
    <p class="eyebrow">Private access</p>
    <h1>Sign in</h1>
    <p class="fine">Only authorised founder accounts may access business operations.</p>
    ${error ? `<div class="flash flash-error" role="alert">${h(error)}</div>` : ''}
    ${field({ label: 'Email', name: 'email', type: 'email', value: email, required: true, attrs: 'autocomplete="email"' })}
    ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    <button class="btn btn-dark full" type="submit">Sign in to the console</button>
    ${demo ? `<p class="fine">First-run account: <code>${h(demo.email)}</code> — password supplied at setup. Change it after signing in.</p>` : ''}
    <p class="fine"><a href="/">← Back to the storefront</a></p>
  </form>
</main></body></html>`;
}

export function overviewPage(base) {
  const { summary, recentOrders, lowStock, activity, chart, alerts, settings } = base;
  const maxChart = Math.max(1, ...chart.map((c) => c.total));
  return page(base, {
    title: 'Overview',
    subtitle: 'Business at a glance. Paid revenue only counts verified payments.',
    active: 'overview',
    body: `
    ${
      alerts.length
        ? `<div class="alert-stack">${alerts
            .map((a) => `<div class="alert alert-${h(a.level)}"><strong>${h(a.title)}</strong> ${a.href ? `<a href="${h(a.href)}">Review →</a>` : ''}<p>${h(a.text)}</p></div>`)
            .join('')}</div>`
        : ''
    }
    <div class="stat-grid">
      ${statCard('Paid revenue', money(summary.revenuePaid), `${summary.paidOrders} paid orders`)}
      ${statCard('Pending payments', money(summary.pendingValue), `${summary.pendingOrders} awaiting payment`)}
      ${statCard('Refunds', money(summary.refunds), 'All time')}
      ${statCard('Total orders', String(summary.ordersCount), `${summary.orders30} in 30 days`)}
      ${statCard('Average order value', money(summary.aov), 'Paid orders only')}
      ${statCard('Customers', String(summary.customers), `${summary.waitlist} on the waitlist`)}
      ${statCard('Active products', String(summary.activeProducts), `${summary.totalProducts} total`)}
      ${statCard('Physical inventory', `${summary.inventoryUnits} units`, `${summary.availableUnits} available`)}
      ${statCard('Low stock', String(summary.lowStockCount), 'Below threshold')}
      ${statCard('Out of stock', String(summary.outOfStockCount), 'Needs restock')}
      ${statCard('Active batches', String(summary.activeBatches), `${summary.preorderUnits} units preordered`)}
      ${statCard('Store mode', settings.store_mode === 'live' ? 'Live' : 'Waitlist', settings.payments_enabled === '1' ? 'Payments enabled' : 'Payments disabled')}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Paid revenue, last 14 days',
        `<div class="bar-chart" role="img" aria-label="Paid revenue for the last 14 days">
          ${chart
            .map(
              (c) => `<div class="bar-col" title="${h(c.date)}: ${money(c.total)}"><div class="bar" style="height:${Math.max(2, Math.round((c.total / maxChart) * 100))}%"></div><span>${h(c.label)}</span></div>`,
            )
            .join('')}
        </div>
        <p class="fine">Total for period: ${money(chart.reduce((sum, c) => sum + c.total, 0))}</p>`,
      )}
      ${panel(
        'Needs attention',
        lowStock.length
          ? `<ul class="alert-list">${lowStock
              .map(
                (p) => `<li><a href="/admin/inventory/${h(p.product_id)}">${h(p.name)}</a><span>${p.available} available · threshold ${p.low_stock_threshold}</span></li>`,
              )
              .join('')}</ul>
            <a class="text-link" href="/admin/inventory">Open inventory →</a>`
          : '<p class="fine">No low-stock products. Stock levels are healthy.</p>',
      )}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Recent orders',
        recentOrders.length
          ? table(
              ['Reference', 'Customer', 'Total', 'Payment', 'Fulfilment'],
              recentOrders.map((o) => [
                `<a href="/admin/orders/${h(o.id)}">${h(o.reference)}</a>`,
                h(o.name),
                money(o.total_cents, o.currency),
                pill(o.payment_status),
                pill(o.fulfilment_status),
              ]),
            ) + '<a class="text-link" href="/admin/orders">All orders →</a>'
          : emptyState('No orders yet'),
      )}
      ${panel(
        'Recent activity',
        activity.length
          ? `<ul class="activity">${activity
              .map(
                (a) => `<li><span class="activity-action">${h(a.action)}</span><span class="activity-meta">${h(a.actor_email || 'system')} · ${h(fmtDateTime(a.created_at))}</span></li>`,
              )
              .join('')}</ul><a class="text-link" href="/admin/audit">Full audit log →</a>`
          : '<p class="fine">No activity recorded yet.</p>',
      )}
    </div>`,
  });
}

export function productsPage(base) {
  const { products, filters, counts } = base;
  return page(base, {
    title: 'Products',
    subtitle: `${counts.total} products · ${counts.active} active · ${counts.draft} draft · ${counts.out} out of stock`,
    active: 'products',
    body: `
    <div class="toolbar">
      <form method="get" action="/admin/products" class="toolbar-form">
        <input type="search" name="q" value="${h(filters.q || '')}" placeholder="Search name or SKU">
        <select name="status">
          <option value="">All statuses</option>
          ${PRODUCT_STATUSES.map((s) => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        <button class="btn btn-dark" type="submit">Filter</button>
      </form>
      <a class="btn btn-dark" href="/admin/products/new">Add product</a>
    </div>
    ${
      base.verificationCount
        ? `<div class="alert alert-warn"><strong>${base.verificationCount} product${base.verificationCount === 1 ? '' : 's'} pending ingredient verification.</strong><p>Only publish product information the founder has verified. Open each product and set “Ingredient status” once checked.</p></div>`
        : ''
    }
    ${table(
      ['Product', 'SKU', 'Price', 'Stock', 'Model', 'Status', 'Updated', ''],
      products.map((p) => [
        `<a href="/admin/products/${h(p.id)}"><strong>${h(p.name)}</strong></a><br><span class="fine">${h(p.category_name || 'Uncategorised')}</span>`,
        h(p.sku),
        money(p.price_cents, p.currency),
        `${p.physical_stock} physical<br><span class="fine">${Math.max(0, p.physical_stock - p.reserved_stock)} available</span>`,
        p.fulfilment_model === 'preorder' ? 'Preorder' : 'Inventory',
        pill(p.status),
        h(fmtDate(p.updated_at)),
        `<a class="text-link" href="/admin/products/${h(p.id)}">Edit</a>`,
      ]),
      { empty: 'No products yet', emptyText: 'Add your first product to open the catalogue.' },
    )}`,
  });
}

export function productFormPage(base) {
  const { product, categories, isNew, prices = {}, ingredients = [], selected = {} } = base;
  const p = product || {};
  const price = (p.price_cents || 0) / 100;
  const cost = p.cost_cents === null || p.cost_cents === undefined ? '' : (p.cost_cents / 100).toFixed(2);
  const action = isNew ? '/admin/products' : `/admin/products/${p.id}`;
  return page(base, {
    title: isNew ? 'Add product' : p.name,
    subtitle: isNew ? 'New catalogue entry' : `SKU ${p.sku} · ${STATUS_LABELS[p.status] || p.status}`,
    active: 'products',
    body: `<form method="post" action="${action}" class="console-form">
      ${csrfInput(base.csrf)}
      ${panel(
        'Identity',
        `<div class="form-grid">
          ${field({ label: 'Product name', name: 'name', value: p.name || '', required: true })}
          ${field({ label: 'URL slug', name: 'slug', value: p.slug || '', hint: 'Leave blank to generate from the name.' })}
          ${field({ label: 'SKU', name: 'sku', value: p.sku || '', required: true, hint: 'Must be unique.' })}
          ${field({ label: 'Category', name: 'category_id', type: 'select', value: p.category_id || '', options: [{ value: '', label: 'Uncategorised' }].concat(categories.map((c) => ({ value: c.id, label: c.name }))) })}
          ${field({ label: 'Subtitle', name: 'subtitle', value: p.subtitle || '' })}
          ${field({ label: 'Net contents', name: 'net_contents', value: p.net_contents || '', placeholder: '30 ml / 1.0 fl oz' })}
        </div>`,
      )}
      ${panel('Description and directions', `<div class="form-grid">
        ${field({ label: 'Description', name: 'description', type: 'textarea', value: p.description || '', rows: 7 })}
        ${field({ label: 'Directions for use', name: 'directions', type: 'textarea', value: p.directions || '', rows: 4 })}
        ${field({ label: 'Warnings', name: 'warnings', type: 'textarea', value: p.warnings || '', rows: 4 })}
        ${field({ label: 'Verified product claims', name: 'claims', type: 'textarea', value: p.claims || '', rows: 3, hint: 'Comma-separated. Publish only claims you can substantiate.' })}
        ${field({ label: 'Shipping information', name: 'shipping_info', type: 'textarea', value: p.shipping_info || '', rows: 4 })}
      </div>`)}
      ${panel('Ingredients', `<div class="form-grid">
        ${field({ label: 'Full INCI declaration', name: 'inci_text', type: 'textarea', value: p.inci_text || '', rows: 5, hint: 'Descending order, comma-separated. This text is published verbatim on the product page.' })}
        ${field({ label: 'Ingredient status', name: 'verification_status', type: 'select', value: p.verification_status || 'pending', options: [{ value: 'pending', label: 'Pending founder verification' }, { value: 'verified', label: 'Founder verified' }] })}
      </div>`)}
      ${panel('Pricing and stock', `<div class="form-grid">
        ${field({ label: 'Base price (in the currency below)', name: 'price', type: 'number', value: price ? price.toFixed(2) : '', required: true, attrs: 'step="0.01" min="0"' })}
        ${field({ label: 'Currency', name: 'currency', type: 'select', value: p.currency || 'USD', options: CURRENCIES.map((c) => ({ value: c, label: c })) })}
        ${CURRENCIES.map((c) => field({ label: `Price in ${c}`, name: `price_${c}`, type: 'number', value: Number.isInteger(prices[c]) ? (prices[c] / 100).toFixed(2) : '', attrs: 'step="0.01" min="0"', hint: c === (p.currency || 'USD') ? 'This is the base price above.' : 'Leave blank to not sell in this currency. No automatic conversion.' })).join('')}
        ${field({ label: 'Unit cost (USD, internal)', name: 'cost', type: 'number', value: cost, attrs: 'step="0.01" min="0"', hint: 'Used for margin reports only. Never shown publicly.' })}
        ${field({ label: 'Low-stock threshold', name: 'low_stock_threshold', type: 'number', value: p.low_stock_threshold ?? 10, attrs: 'min="0"' })}
        ${isNew ? field({ label: 'Opening physical stock', name: 'opening_stock', type: 'number', value: '0', attrs: 'min="0"', hint: 'Records an initial restock entry in the inventory ledger.' }) : ''}
        ${field({ label: 'Fulfilment model', name: 'fulfilment_model', type: 'select', value: p.fulfilment_model || 'inventory', options: [{ value: 'inventory', label: 'Physical inventory' }, { value: 'preorder', label: 'Production batch preorder' }], hint: 'Preorder products never consume physical stock.' })}
      </div>`)}
      ${panel('Availability and publication', `<div class="form-grid">
        ${field({ label: 'Product status', name: 'status', type: 'select', value: p.status || 'draft', options: PRODUCT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) })}
        ${field({ label: 'Preorder functionality', name: 'preorder_enabled', type: 'select', value: String(p.preorder_enabled || 0), options: [{ value: '0', label: 'Preorder disabled' }, { value: '1', label: 'Preorder enabled for this product' }], hint: 'Global preorders must also be authorised in Payments settings.' })}
        ${field({ label: 'Manual unavailability', name: 'manual_unavailable', type: 'select', value: String(p.manual_unavailable || 0), options: [{ value: '0', label: 'Available (subject to stock)' }, { value: '1', label: 'Temporarily unavailable' }], hint: 'Takes precedence over stock status.' })}
        ${field({ label: 'Featured on home page', name: 'featured', type: 'select', value: String(p.featured || 0), options: [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }] })}
      </div>`)}
      ${panel('Media', `<div class="form-grid">
        ${field({ label: 'Image URL', name: 'image_url', value: p.image_url || '', hint: 'Leave blank to use the generated amber-glass illustration.' })}
        ${field({ label: 'Illustration tone', name: 'image_tone', type: 'select', value: p.image_tone || 'amber', options: [{ value: 'amber', label: 'Amber' }, { value: 'deep', label: 'Deep amber' }, { value: 'soft', label: 'Soft gold' }, { value: 'green', label: 'Forest green' }] })}
      </div>`)}
      <div class="form-actions">
        <button class="btn btn-dark" type="submit">${isNew ? 'Create product' : 'Save changes'}</button>
        <a class="btn btn-quiet" href="/admin/products">Cancel</a>
        ${!isNew && p.status !== 'discontinued' ? `<button class="btn btn-danger" type="submit" name="action" value="archive" data-confirm="Archive this product? It will be removed from the storefront but its order history is kept.">Archive product</button>` : ''}
        ${!isNew ? `<button class="btn btn-danger" type="submit" name="action" value="delete" data-confirm="Permanently delete this product? This cannot be undone. Products that appear on orders cannot be deleted.">Delete product</button>` : ''}
      </div>
      ${panel(
        'Ingredients (INCI order)',
        `<input type="hidden" name="ingredients_present" value="1">
        ${
          ingredients.length
            ? `<ul class="ing-picker">${ingredients
                .map(
                  (i) => `<li><label><input type="checkbox" name="ing_${h(i.id)}" value="1" ${selected[i.id] ? 'checked' : ''}> <span>${h(i.inci_name)}</span></label><input type="number" name="ingpos_${h(i.id)}" value="${selected[i.id] || ''}" min="1" step="1" placeholder="#" aria-label="Position of ${h(i.inci_name)}"></li>`,
                )
                .join('')}</ul>`
            : '<p class="fine">No ingredients exist yet.</p>'
        }
        <p class="fine">Tick what the product contains and number them in the order they must print, highest concentration first. <a href="/admin/ingredients">Manage ingredients</a></p>`,
      )}
      ${!isNew ? `<p class="fine">Products that have been ordered can only be archived, so order history stays intact. A product that has never been ordered can be deleted for good.</p>` : ''}
    </form>`,
  });
}

export function inventoryPage(base) {
  const { rows, summary } = base;
  return page(base, {
    title: 'Inventory',
    subtitle: 'Available = physical stock − reserved stock. Reserved units belong to unpaid orders.',
    active: 'inventory',
    body: `<div class="stat-grid stat-grid-4">
      ${statCard('Total physical units', String(summary.physical), 'In storage')}
      ${statCard('Available units', String(summary.available), 'After reservations')}
      ${statCard('Reserved units', String(summary.reserved), 'Held by pending orders')}
      ${statCard('Units sold', String(summary.sold), 'Verified payments')}
      ${statCard('Low stock', String(summary.low), 'At or below threshold')}
      ${statCard('Out of stock', String(summary.out), 'Available = 0')}
      ${statCard('Stock value at cost', money(summary.value), 'Where unit cost recorded')}
      ${statCard('Reservations active', String(summary.activeReservations), 'Expire after 30 minutes')}
    </div>
    ${table(
      ['Product', 'SKU', 'Physical', 'Reserved', 'Available', 'Sold', 'Threshold', 'Status', 'Last restock', ''],
      rows.map((r) => [
        `<a href="/admin/inventory/${h(r.product_id)}">${h(r.name)}</a>`,
        h(r.sku),
        String(r.physical_stock),
        String(r.reserved_stock),
        `<strong>${Math.max(0, r.physical_stock - r.reserved_stock)}</strong>`,
        String(r.units_sold),
        String(r.low_stock_threshold),
        pill(r.status),
        h(fmtDate(r.last_restock_at)),
        `<a class="text-link" href="/admin/inventory/${h(r.product_id)}">Manage</a>`,
      ]),
    )}
    <p class="fine"><a class="text-link" href="/admin/restocks">Restock a product →</a> · <a class="text-link" href="/admin/inventory/export.csv">Export inventory CSV</a></p>`,
  });
}

export function inventoryDetailPage(base) {
  const { row, movements, reservations } = base;
  const available = Math.max(0, row.physical_stock - row.reserved_stock);
  return page(base, {
    title: row.name,
    subtitle: `SKU ${row.sku} · Inventory ledger`,
    active: 'inventory',
    body: `<div class="backline"><a href="/admin/inventory">← Inventory</a><a href="/admin/products/${h(row.product_id)}">Edit product →</a></div>
    <div class="stat-grid stat-grid-4">
      ${statCard('Physical', String(row.physical_stock))}
      ${statCard('Reserved', String(row.reserved_stock))}
      ${statCard('Available', String(available))}
      ${statCard('Units sold', String(row.units_sold))}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Restock',
        `<form method="post" action="/admin/inventory/${h(row.product_id)}/restock" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Quantity received', name: 'qty', type: 'number', required: true, attrs: 'min="1"' })}
          ${field({ label: 'Supplier / manufacturer', name: 'supplier' })}
          ${field({ label: 'Production batch reference', name: 'batch_ref' })}
          ${field({ label: 'Unit cost (USD)', name: 'unit_cost', type: 'number', attrs: 'step="0.01" min="0"' })}
          ${field({ label: 'Restock date', name: 'restock_date', type: 'date', value: new Date().toISOString().slice(0, 10) })}
          ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 2 })}
          <button class="btn btn-dark" type="submit">Record restock</button>
        </form>`,
        'Adds to physical stock and writes an auditable restock + movement.',
      )}
      ${panel(
        'Adjustment',
        `<form method="post" action="/admin/inventory/${h(row.product_id)}/adjust" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Quantity change', name: 'qty_delta', type: 'number', required: true, hint: 'Use a negative number to reduce stock (e.g. −3).' })}
          ${field({ label: 'Reason category', name: 'category', type: 'select', value: 'correction', options: [{ value: 'damaged', label: 'Damaged' }, { value: 'expired', label: 'Expired' }, { value: 'sample', label: 'Sample' }, { value: 'promotion', label: 'Promotion' }, { value: 'correction', label: 'Correction' }, { value: 'other', label: 'Other' }] })}
          ${field({ label: 'Reason (required)', name: 'reason', required: true, hint: 'Recorded permanently against this adjustment.' })}
          ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2 })}
          <button class="btn btn-outline" type="submit" data-confirm="Record this stock adjustment? It cannot be edited later.">Record adjustment</button>
        </form>`,
        'Stock history is never overwritten. Corrections are new entries.',
      )}
    </div>
    ${panel(
      'Active reservations',
      reservations.length
        ? table(
            ['Order', 'Qty', 'Expires', 'Status'],
            reservations.map((r) => [`<a href="/admin/orders/${h(r.order_id)}">${h(r.order_reference || r.order_id)}</a>`, String(r.qty), h(fmtDateTime(r.expires_at)), pill(r.status)]),
          )
        : '<p class="fine">No active reservations.</p>',
    )}
    ${panel(
      'Movement history',
      table(
        ['When', 'Type', 'Change', 'Physical after', 'Reserved after', 'Reason'],
        movements.map((m) => [h(fmtDateTime(m.created_at)), h(m.kind), `${m.qty_delta > 0 ? '+' : ''}${m.qty_delta}`, String(m.physical_after), String(m.reserved_after), h(m.reason || '')]),
        { empty: 'No movements yet' },
      ),
    )}`,
  });
}

export function restocksPage(base) {
  const { products, restocks, totalCost } = base;
  return page(base, {
    title: 'Restocking',
    subtitle: 'Record incoming production and received inventory',
    active: 'restocks',
    body: `<div class="console-grid-2">
      ${panel(
        'Record a restock',
        `<form method="post" action="/admin/restocks" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Product', name: 'product_id', type: 'select', required: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` })) })}
          ${field({ label: 'Quantity', name: 'qty', type: 'number', required: true, attrs: 'min="1"' })}
          ${field({ label: 'Supplier / manufacturer', name: 'supplier' })}
          ${field({ label: 'Batch reference', name: 'batch_ref' })}
          ${field({ label: 'Unit cost (USD)', name: 'unit_cost', type: 'number', attrs: 'step="0.01" min="0"' })}
          ${field({ label: 'Restock date', name: 'restock_date', type: 'date', value: new Date().toISOString().slice(0, 10) })}
          ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2 })}
          <button class="btn btn-dark" type="submit">Record restock</button>
        </form>`,
        'Every restock increases physical stock and appends to the ledger.',
      )}
      ${panel(
        'Restock summary',
        `<div class="stat-grid stat-grid-2">
          ${statCard('Restock entries', String(restocks.length))}
          ${statCard('Recorded cost', money(totalCost), 'Where unit cost was entered')}
        </div>
        <p class="fine">Full history below. Stock received from confirmed production batches also appears here.</p>`,
      )}
    </div>
    ${panel(
      'Restock history',
      table(
        ['Date', 'Product', 'Qty', 'Supplier', 'Batch', 'Unit cost', 'Recorded by'],
        restocks.map((r) => [
          h(fmtDate(r.restock_date)),
          `<a href="/admin/inventory/${h(r.product_id)}">${h(r.product_name)}</a>`,
          `+${r.qty}`,
          h(r.supplier || '—'),
          h(r.batch_ref || '—'),
          r.unit_cost_cents === null ? '—' : money(r.unit_cost_cents),
          h(r.actor_email || '—'),
        ]),
        { empty: 'No restocks recorded', emptyText: 'Record your first restock to increase physical stock.' },
      ),
    )}`,
  });
}

export function ordersPage(base) {
  const { orders, filters, total, page: current, pages } = base;
  return page(base, {
    title: 'Orders',
    subtitle: `${total} order${total === 1 ? '' : 's'} · payment and fulfilment states are tracked separately`,
    active: 'orders',
    body: `<div class="toolbar">
      <form method="get" action="/admin/orders" class="toolbar-form toolbar-wrap">
        <input type="search" name="q" value="${h(filters.q || '')}" placeholder="Order reference or customer">
        <select name="payment">
          <option value="">All payments</option>
          ${['unpaid', 'pending', 'paid', 'failed', 'partially_refunded', 'refunded'].map((s) => `<option value="${s}" ${filters.payment === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        <select name="fulfilment">
          <option value="">All fulfilment</option>
          ${FULFILMENT_STATUSES.map((s) => `<option value="${s}" ${filters.fulfilment === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
        <input type="date" name="from" value="${h(filters.from || '')}" aria-label="From date">
        <input type="date" name="to" value="${h(filters.to || '')}" aria-label="To date">
        <button class="btn btn-dark" type="submit">Filter</button>
      </form>
      <a class="btn btn-quiet" href="/admin/orders/export.csv">Export CSV</a>
    </div>
    ${table(
      ['Reference', 'Placed', 'Customer', 'Country', 'Total', 'Payment', 'Fulfilment', ''],
      orders.map((o) => [
        `<a href="/admin/orders/${h(o.id)}">${h(o.reference)}</a>`,
        h(fmtDate(o.placed_at, true)),
        `${h(o.name)}<br><span class="fine">${h(o.email)}</span>`,
        h(o.country),
        money(o.total_cents, o.currency),
        pill(o.payment_status),
        pill(o.fulfilment_status),
        o.stock_issue ? '<span class="stock stock-out_of_stock">Stock issue</span>' : '',
      ]),
      { empty: 'No orders match', emptyText: 'Try clearing the filters.' },
    )}
    ${pages > 1 ? pager(`/admin/orders?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}`, { page: current, pages }) : ''}`,
  });
}

export function orderDetailPage(base) {
  const { order, items, payments, refunds, notes, providers } = base;
  const paid = (payments || []).filter((p) => p.status === 'succeeded');
  const refunded = (refunds || []).reduce((sum, r) => sum + r.amount_cents, 0);
  return page(base, {
    title: `Order ${order.reference}`,
    subtitle: `${fmtDate(order.placed_at, true)} · ${order.email}`,
    active: 'orders',
    body: `<div class="backline"><a href="/admin/orders">← Orders</a><a href="/order/${h(order.reference)}?email=${encodeURIComponent(order.email)}" target="_blank" rel="noopener">Customer view ↗</a></div>
    ${order.stock_issue ? `<div class="alert alert-danger"><strong>Stock could not be fulfilled after payment.</strong><p>Resolve manually: restock and fulfil, or issue a refund below. This order is flagged for founder attention.</p></div>` : ''}
    <div class="stat-grid stat-grid-4">
      ${statCard('Order total', money(order.total_cents, order.currency))}
      ${statCard('Payment', STATUS_LABELS[order.payment_status] || order.payment_status)}
      ${statCard('Fulfilment', STATUS_LABELS[order.fulfilment_status] || order.fulfilment_status)}
      ${statCard('Refunded', money(refunded))}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Items',
        table(
          ['Product', 'SKU', 'Qty', 'Unit', 'Total', 'Model'],
          items.map((i) => [h(i.name), h(i.sku), String(i.qty), money(i.unit_price_cents, order.currency), money(i.line_total_cents, order.currency), i.fulfilment_model === 'preorder' ? 'Preorder' : 'Inventory']),
        ) +
          `<div class="totals-block">
            <div class="summary-row"><span>Subtotal</span><span>${money(order.subtotal_cents, order.currency)}</span></div>
            <div class="summary-row"><span>Shipping</span><span>${money(order.shipping_cents, order.currency)}</span></div>
            <div class="summary-row total"><span>Total</span><span>${money(order.total_cents, order.currency)}</span></div>
          </div>`,
      )}
      ${panel(
        'Customer and delivery',
        `<p><strong>${h(order.name)}</strong><br>${h(order.email)}<br>${h(order.country)}</p>
        <p>${h(order.shipping_name || '')}<br>${h(order.shipping_line1 || '')}${order.shipping_line2 ? `<br>${h(order.shipping_line2)}` : ''}<br>${h(order.shipping_city || '')} ${h(order.shipping_region || '')} ${h(order.shipping_postcode || '')}<br>${h(order.shipping_phone || '')}</p>
        <p class="fine">Payment reference: ${h(order.payment_reference || '—')}</p>
        <p class="fine">Internal notes: ${h(order.internal_notes || '—')}</p>`,
      )}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Update fulfilment',
        `<form method="post" action="/admin/orders/${h(order.id)}/fulfilment" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Fulfilment status', name: 'fulfilment_status', type: 'select', value: order.fulfilment_status, options: FULFILMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) })}
          ${field({ label: 'Shipping provider', name: 'shipping_provider', value: order.shipping_provider || '' })}
          ${field({ label: 'Tracking number', name: 'tracking_number', value: order.tracking_number || '' })}
          <button class="btn btn-dark" type="submit">Save fulfilment</button>
        </form>`,
        'Dispatch and tracking emails are queued automatically for shipped orders.',
      )}
      ${panel(
        'Refund',
        order.payment_status === 'paid' || order.payment_status === 'partially_refunded'
          ? `<form method="post" action="/admin/orders/${h(order.id)}/refund" class="form-grid">
              ${csrfInput(base.csrf)}
              ${field({ label: 'Refund amount (USD)', name: 'amount', type: 'number', required: true, attrs: 'step="0.01" min="0.01"', hint: `Captured: ${money(paid[0]?.amount_cents || order.total_cents, order.currency)}. Refunded so far: ${money(refunded)}.` })}
              ${field({ label: 'Reason', name: 'reason', required: true })}
              ${field({ label: 'Return stock to inventory', name: 'restock', type: 'select', value: '0', options: [{ value: '0', label: 'No — goods not received' }, { value: '1', label: 'Yes — goods received and resaleable' }] })}
              <button class="btn btn-danger" type="submit" data-confirm="Issue this refund? It is sent to the payment provider where supported.">Issue refund</button>
            </form>`
          : '<p class="fine">Refunds are available on paid orders only.</p>',
        providersConfiguredText(providers),
      )}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Payments',
        payments.length
          ? table(
              ['Provider', 'Reference', 'Amount', 'Status', 'Verified'],
              payments.map((p) => [h(p.provider), h(p.reference), money(p.amount_cents, p.currency), pill(p.status), h(fmtDateTime(p.verified_at))]),
            )
          : '<p class="fine">No payment records.</p>',
      )}
      ${panel(
        'Refunds',
        refunds.length
          ? table(
              ['Date', 'Amount', 'Status', 'Reason', 'By'],
              refunds.map((r) => [h(fmtDate(r.created_at)), money(r.amount_cents, order.currency), pill(r.status), h(r.reason || ''), h(r.actor_email || '')]),
            )
          : '<p class="fine">No refunds recorded.</p>',
      )}
    </div>
    ${panel(
      'Internal notes',
      `${notes.length ? `<ul class="activity">${notes.map((n) => `<li><span>${h(n.note)}</span><span class="activity-meta">${h(n.actor_email || 'system')} · ${h(fmtDateTime(n.created_at))}</span></li>`).join('')}</ul>` : '<p class="fine">No notes yet.</p>'}
      <form method="post" action="/admin/orders/${h(order.id)}/notes" class="inline-form">
        ${csrfInput(base.csrf)}
        <input type="text" name="note" placeholder="Add an internal note" required>
        <button class="btn btn-outline" type="submit">Add note</button>
      </form>`,
      'Internal only. Never shown to customers.',
    )}`,
  });
}

function providersConfiguredText(providers) {
  if (!providers || !providers.length) return 'No verified payment provider configured — refunds record internally only.';
  return `Verified providers: ${providers.map((p) => p.provider).join(', ')}.`;
}

export function customersPage(base) {
  const { customers, waitlist } = base;
  return page(base, {
    title: 'Customers',
    subtitle: `${customers.length} customers · ${waitlist.length} waitlist registrations`,
    active: 'customers',
    body: `${table(
      ['Name', 'Email', 'Country', 'Orders', 'Spent', 'Joined'],
      customers.map((c) => [
        h(c.name),
        h(c.email),
        h(c.country || '—'),
        String(c.order_count),
        money(c.spent_cents || 0, 'USD'),
        h(fmtDate(c.created_at)),
      ]),
      { empty: 'No customers yet', emptyText: 'Customers appear when an order is placed.' },
    )}
    ${panel(
      'Waitlist registrations',
      table(
        ['Name', 'Email', 'Country', 'Product interest', 'Status', 'Registered'],
        waitlist.map((w) => [h(w.name), h(w.email), h(w.country || '—'), h(w.product_name || 'Any'), pill(w.status), h(fmtDate(w.created_at))]),
        { empty: 'No waitlist registrations yet' },
      ),
    )}`,
  });
}

export function preordersPage(base) {
  const { waitlist, batches, preorderOrders, settings } = base;
  return page(base, {
    title: 'Preorders & waitlist',
    subtitle: settings.preorders_enabled === '1' ? 'Preorders authorised' : 'Preorders are currently disabled globally',
    active: 'preorders',
    body: `<div class="alert ${settings.preorders_enabled === '1' ? 'alert-warn' : 'alert-info'}">
      <strong>Preorder activation: ${settings.preorders_enabled === '1' ? 'enabled' : 'disabled'}.</strong>
      <p>Preorders must only be activated after manufacturing, regulatory, shipping and payment arrangements are verified. Capacity is capped by each batch allocation.</p>
    </div>
    ${panel(
      'Batch allocations',
      table(
        ['Batch', 'Product', 'Allocated', 'Confirmed', 'Held (unpaid)', 'Remaining', 'Est. completion', 'Status'],
        batches.map((b) => [
          `<a href="/admin/batches/${h(b.batch_id)}">${h(b.reference)}</a>`,
          h(b.product_name),
          String(b.allocated_qty),
          String(b.preorder_qty),
          String(b.preorder_holds),
          String(Math.max(0, b.allocated_qty - b.preorder_qty - b.preorder_holds)),
          h(b.estimated_completion ? fmtDate(b.estimated_completion) : '—'),
          pill(b.status),
        ]),
        { empty: 'No batch allocations', emptyText: 'Create a production batch and assign products.' },
      ),
    )}
    ${panel(
      'Preorder orders',
      table(
        ['Order', 'Customer', 'Product', 'Qty', 'Placed', 'Payment', 'Fulfilment'],
        preorderOrders.map((o) => [
          `<a href="/admin/orders/${h(o.order_id)}">${h(o.reference)}</a>`,
          h(o.name),
          h(o.product_name),
          String(o.qty),
          h(fmtDate(o.placed_at)),
          pill(o.payment_status),
          pill(o.fulfilment_status),
        ]),
        { empty: 'No preorder orders', emptyText: 'Preorder orders will appear here with their batch allocation.' },
      ),
    )}
    ${panel(
      'Waitlist',
      table(
        ['Name', 'Email', 'Country', 'Interest', 'Source', 'Status', 'Registered', ''],
        waitlist.map((w) => [
          h(w.name),
          h(w.email),
          h(w.country || '—'),
          h(w.product_name || 'Any'),
          h(w.source),
          pill(w.status),
          h(fmtDate(w.created_at)),
          w.status === 'waiting'
            ? `<form method="post" action="/admin/preorders/waitlist/${h(w.id)}/notify">${csrfInput(base.csrf)}<button class="linklike" type="submit">Mark notified</button></form>`
            : '',
        ]),
        { empty: 'No waitlist registrations' },
      ),
      'Marking a registration notified queues the restock email template where enabled.',
    )}
    <p class="fine"><a class="text-link" href="/admin/settings">Preorder authorisation is controlled in System settings →</a></p>`,
  });
}

export function batchesPage(base) {
  const { batches, products } = base;
  return page(base, {
    title: 'Production batches',
    subtitle: 'A batch is separate from physical stock until it is received into inventory',
    active: 'batches',
    body: `<div class="console-grid-2">
      ${panel(
        'Create a batch',
        `<form method="post" action="/admin/batches" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Batch reference', name: 'reference', required: true, placeholder: 'BATCH-2026-02' })}
          ${field({ label: 'Manufacturer', name: 'manufacturer' })}
          ${field({ label: 'Product', name: 'product_id', type: 'select', required: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` })) })}
          ${field({ label: 'Allocated quantity', name: 'allocated_qty', type: 'number', required: true, attrs: 'min="1"', hint: 'Maximum units available to preorder from this batch.' })}
          ${field({ label: 'Unit cost (USD)', name: 'unit_cost', type: 'number', attrs: 'step="0.01" min="0"' })}
          ${field({ label: 'Estimated completion', name: 'estimated_completion', type: 'date' })}
          ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2 })}
          <button class="btn btn-dark" type="submit">Create batch</button>
        </form>`,
        'Nothing is added to physical inventory until receipt is confirmed.',
      )}
      ${panel(
        'Batch statuses',
        `<p class="fine">Planned → Awaiting manufacturer → Production started → Quality review → Completed → Received into inventory. Cancelled is always available before receipt.</p>
        <p class="fine">Recording receipt creates restock entries and inventory movements for every allocated product.</p>`,
      )}
    </div>
    ${table(
      ['Reference', 'Manufacturer', 'Products', 'Allocated', 'Preordered', 'Est. completion', 'Status', ''],
      batches.map((b) => [
        `<a href="/admin/batches/${h(b.id)}">${h(b.reference)}</a>`,
        h(b.manufacturer || '—'),
        String(b.product_count),
        String(b.allocated_total || 0),
        String(b.preorder_total || 0),
        h(b.estimated_completion ? fmtDate(b.estimated_completion) : '—'),
        pill(b.status),
        `<a class="text-link" href="/admin/batches/${h(b.id)}">Open</a>`,
      ]),
      { empty: 'No batches yet', emptyText: 'Create your first production batch.' },
    )}`,
  });
}

export function batchDetailPage(base) {
  const { batch, items, products } = base;
  return page(base, {
    title: batch.reference,
    subtitle: `${batch.manufacturer || 'Manufacturer to be confirmed'} · ${STATUS_LABELS[batch.status]}`,
    active: 'batches',
    body: `<div class="backline"><a href="/admin/batches">← Batches</a></div>
    <div class="stat-grid stat-grid-4">
      ${statCard('Allocated', String(items.reduce((s, i) => s + i.allocated_qty, 0)), 'Units')}
      ${statCard('Confirmed preorders', String(items.reduce((s, i) => s + i.preorder_qty, 0)))}
      ${statCard('Held (unpaid)', String(items.reduce((s, i) => s + i.preorder_holds, 0)))}
      ${statCard('Received', String(items.reduce((s, i) => s + i.received_qty, 0)))}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Batch details',
        `<form method="post" action="/admin/batches/${h(batch.id)}" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Reference', name: 'reference', value: batch.reference, required: true })}
          ${field({ label: 'Manufacturer', name: 'manufacturer', value: batch.manufacturer || '' })}
          ${field({ label: 'Status', name: 'status', type: 'select', value: batch.status, options: BATCH_STATUSES.filter((s) => s !== 'received').map((s) => ({ value: s, label: STATUS_LABELS[s] })) })}
          ${field({ label: 'Start date', name: 'start_date', type: 'date', value: batch.start_date || '' })}
          ${field({ label: 'Estimated completion', name: 'estimated_completion', type: 'date', value: batch.estimated_completion || '' })}
          ${field({ label: 'Actual completion', name: 'actual_completion', type: 'date', value: batch.actual_completion || '' })}
          ${field({ label: 'Quality approved', name: 'quality_approved', type: 'select', value: String(batch.quality_approved || 0), options: [{ value: '0', label: 'Not yet' }, { value: '1', label: 'Approved' }] })}
          ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: batch.notes || '', rows: 3 })}
          <button class="btn btn-dark" type="submit">Save batch</button>
        </form>`,
      )}
      ${panel(
        'Receive into inventory',
        batch.status === 'received'
          ? `<p class="fine">Received ${h(fmtDateTime(batch.received_at))}. Physical stock has been increased for each allocated product.</p>`
          : `<p class="fine">This action adds each product's allocated quantity to physical inventory and records restock + movement entries. It can only be performed once.</p>
            <form method="post" action="/admin/batches/${h(batch.id)}/receive" class="stack-form">
              ${csrfInput(base.csrf)}
              <button class="btn btn-dark" type="submit" data-confirm="Confirm receipt of this batch into inventory? This adds stock to every assigned product.">Confirm receipt into inventory</button>
            </form>`,
        'Never add manufactured quantities to inventory before receipt is confirmed.',
      )}
    </div>
    ${panel(
      'Assigned products',
      table(
        ['Product', 'Allocated', 'Confirmed', 'Held', 'Received', 'Unit cost'],
        items.map((i) => [h(i.product_name), String(i.allocated_qty), String(i.preorder_qty), String(i.preorder_holds), String(i.received_qty), i.unit_cost_cents === null ? '—' : money(i.unit_cost_cents)]),
        { empty: 'No products assigned' },
      ),
      'Assign another product to this batch:',
    )}
    <form method="post" action="/admin/batches/${h(batch.id)}/items" class="inline-form">
      ${csrfInput(base.csrf)}
      <select name="product_id" required>${products.map((p) => `<option value="${h(p.id)}">${h(p.name)}</option>`).join('')}</select>
      <input type="number" name="allocated_qty" min="1" placeholder="Allocated qty" required>
      <input type="number" name="unit_cost" min="0" step="0.01" placeholder="Unit cost USD">
      <button class="btn btn-outline" type="submit">Add product to batch</button>
    </form>`,
  });
}

export function analyticsPage(base) {
  const { report, range, countries, products } = base;
  return page(base, {
    title: 'Analytics',
    subtitle: 'Paid revenue is separated from pending and unpaid amounts',
    active: 'analytics',
    body: `<div class="toolbar">
      <form method="get" action="/admin/analytics" class="toolbar-form">
        <label class="fine" for="from">From</label>
        <input id="from" type="date" name="from" value="${h(range.from)}">
        <label class="fine" for="to">To</label>
        <input id="to" type="date" name="to" value="${h(range.to)}">
        <button class="btn btn-dark" type="submit">Apply</button>
        <a class="btn btn-quiet" href="/admin/analytics/export.csv?from=${h(range.from)}&to=${h(range.to)}">Export CSV</a>
      </form>
    </div>
    <div class="stat-grid">
      ${statCard('Gross revenue', money(report.gross), 'Paid payments in range')}
      ${statCard('Refunds', money(report.refunds), 'In range')}
      ${statCard('Net revenue', money(report.net), 'Gross − refunds')}
      ${statCard('Orders', String(report.orderCount), `${report.paidOrderCount} paid`)}
      ${statCard('Average order value', money(report.aov), 'Paid orders')}
      ${statCard('Pending value', money(report.pending), 'Unpaid / awaiting payment')}
      ${statCard('Units sold', String(report.unitsSold), 'Inventory items')}
      ${statCard('Preorder units', String(report.preorderUnits), 'Committed to batches')}
      ${statCard('Restocking cost', money(report.restockCost), 'Where unit cost recorded')}
      ${statCard('Inventory value', money(report.inventoryValue), 'Physical stock at cost')}
      ${statCard('Waitlist conversion', `${report.waitlistConversion}%`, `${report.waitlistConverted} of ${report.waitlistTotal}`)}
      ${statCard('Preorder conversion', `${report.preorderConversion}%`, 'Paid preorders vs registrations')}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Product performance',
        table(
          ['Product', 'Units', 'Revenue', 'Cost', 'Gross margin'],
          products.map((p) => [h(p.name), String(p.units), money(p.revenue), money(p.cost), money(p.revenue - p.cost)]),
          { empty: 'No sales in range' },
        ),
      )}
      ${panel(
        'Sales by country',
        table(
          ['Country', 'Orders', 'Revenue'],
          countries.map((c) => [h(c.country), String(c.orders), money(c.revenue)]),
          { empty: 'No sales in range' },
        ),
      )}
    </div>
    ${panel(
      'Orders and conversion',
      `<p class="fine">Inventory turnover: ${report.turnover.toFixed(2)}× (units sold ÷ average physical stock). Unpaid preorders are excluded from revenue until payment is verified.</p>
      <p class="fine">Preorder revenue is recognised only when a production batch order is paid; delivery costs and duties are not included.</p>`,
    )}`,
  });
}

export function contentPage(base) {
  const { content } = base;
  return page(base, {
    title: 'Content',
    subtitle: 'Storefront copy, policies and homepage sections',
    active: 'content',
    body: `${Object.entries(content)
      .map(
        ([key, item]) => `<form method="post" action="/admin/content/${h(key)}" class="panel console-form">
          ${csrfInput(base.csrf)}
          <div class="panel-head"><h2>${h(key.replace(/_/g, ' '))}</h2><p class="fine">Last updated ${h(fmtDate(item.updated_at, true))}</p></div>
          ${field({ label: 'Title', name: 'title', value: item.title, required: true })}
          ${field({ label: 'Body', name: 'body', type: 'textarea', value: item.body, rows: key.includes('policy') || key === 'our_story' ? 14 : 6 })}
          <button class="btn btn-dark" type="submit">Save</button>
        </form>`,
      )
      .join('')}
    <p class="fine">Use blank lines between paragraphs. A short line in capitals becomes a policy subheading. Do not publish shipping prices or delivery guarantees here — configure them per destination under Shipping.</p>`,
  });
}

export function notificationsPage(base) {
  const { templates, outbox, emailConfigured, counts } = base;
  return page(base, {
    title: 'Notifications',
    subtitle: emailConfigured ? 'Email provider configured' : 'Email provider not configured — messages are recorded but not sent',
    active: 'notifications',
    body: `<div class="alert ${emailConfigured ? 'alert-info' : 'alert-warn'}">
      <strong>${emailConfigured ? 'Sending is configured.' : 'Sending is not configured.'}</strong>
      <p>${emailConfigured ? 'Queued messages are delivered through the configured provider.' : 'Set RESEND_API_KEY and EMAIL_FROM in the environment, then verify the sending domain with the provider. No sending domain is assumed by the platform.'}</p>
      <form method="post" action="/admin/notifications/deliver">${csrfInput(base.csrf)}<button class="btn btn-outline" type="submit">Deliver queued messages</button></form>
    </div>
    <div class="stat-grid stat-grid-4">
      ${statCard('Queued', String(counts.queued))}
      ${statCard('Sent', String(counts.sent))}
      ${statCard('Skipped', String(counts.skipped), 'No provider configured')}
      ${statCard('Failed', String(counts.failed))}
    </div>
    <div class="console-grid-2">
      ${panel(
        'Templates',
        `<div class="template-list">${templates
          .map(
            (t) => `<details class="template-item"><summary>${h(t.name)} <span class="fine">${t.enabled ? '' : '· disabled'}</span></summary>
              <form method="post" action="/admin/notifications/templates/${h(t.key)}" class="stack-form">
                ${csrfInput(base.csrf)}
                ${field({ label: 'Subject', name: 'subject', value: t.subject, required: true })}
                ${field({ label: 'Body', name: 'body', type: 'textarea', value: t.body, rows: 8 })}
                ${field({ label: 'Enabled', name: 'enabled', type: 'select', value: String(t.enabled), options: [{ value: '1', label: 'Enabled' }, { value: '0', label: 'Disabled' }] })}
                <button class="btn btn-outline" type="submit">Save template</button>
              </form>
            </details>`,
          )
          .join('')}</div>`,
        'Placeholders use {{name}} syntax. Never promise dispatch dates here beyond what is recorded on the batch.',
      )}
      ${panel(
        'Outbox',
        table(
          ['Created', 'To', 'Template', 'Subject', 'Status'],
          outbox.map((m) => [h(fmtDate(m.created_at, true)), h(m.to_email), h(m.template_key), h(m.subject), pill(m.status)]),
          { empty: 'No messages yet' },
        ),
        'The outbox is an immutable record of customer communication.',
      )}
    </div>`,
  });
}

export function paymentsPage(base) {
  const { settings, providers, envChecks, webhookBase, offline } = base;
  const enabled = settings.payments_enabled === '1';
  return page(base, {
    title: 'Payments',
    subtitle: enabled ? 'Payments are enabled' : 'Payments are disabled — storefront runs in waitlist mode',
    active: 'payments',
    body: `<div class="alert ${enabled ? 'alert-warn' : 'alert-info'}">
      <strong>${enabled ? 'Live payment collection is enabled.' : 'Payment collection is disabled.'}</strong>
      <p>${enabled ? 'Only providers with verified credentials are offered at checkout. Verify a sandbox transaction end to end before accepting real payments.' : 'The storefront records interest without charging. Activate only once merchant eligibility, regulatory clearance and shipping are verified.'}</p>
    </div>
    <div class="console-grid-2">
      ${panel(
        'Payment settings',
        `<form method="post" action="/admin/payments" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Payment collection', name: 'payments_enabled', type: 'select', value: String(settings.payments_enabled || '0'), options: [{ value: '0', label: 'Disabled — waitlist mode' }, { value: '1', label: 'Enabled — collect payment at checkout' }] })}
          ${field({ label: 'Preferred provider', name: 'payment_provider', type: 'select', value: settings.payment_provider || 'paystack', options: [{ value: 'paystack', label: 'Paystack' }, { value: 'paypal', label: 'PayPal Checkout' }] })}
          ${field({ label: 'Storefront mode', name: 'store_mode', type: 'select', value: settings.store_mode || 'waitlist', options: [{ value: 'waitlist', label: 'Waitlist mode' }, { value: 'live', label: 'Live storefront' }] })}
          <p class="fine">Providers configured in the environment: ${providers.length ? providers.map((p) => `<strong>${h(p.provider)}</strong>`).join(', ') : 'none'}.</p>
          <button class="btn btn-dark" type="submit" data-confirm="Change payment settings? Enabling live collection will charge customers.">Save payment settings</button>
        </form>`,
      )}
      ${panel(
        'Provider readiness',
        `<ul class="checklist">
          ${envChecks
            .map(
              (c) => `<li class="${c.ok ? 'ok' : 'no'}"><span class="tick">${c.ok ? '✓' : '○'}</span><div><strong>${h(c.label)}</strong><p class="fine">${h(c.detail)}</p></div></li>`,
            )
            .join('')}
        </ul>
        ${offline ? '<p class="fine"><strong>Sandbox mode is active</strong> because PAYMENTS_OFFLINE=1. Never enable this in production.</p>' : ''}`,
        'Secrets are read from the server environment only and never displayed.',
      )}
    </div>
    ${panel(
      'Webhook endpoints',
      `<p class="fine">Configure these in your provider dashboard. Signatures are verified before any order is marked paid.</p>
      <ul class="plain-list">
        <li><code>${h(webhookBase)}/webhooks/paystack</code> — Paystack, signed with PAYSTACK_SECRET_KEY</li>
        <li><code>${h(webhookBase)}/webhooks/paypal</code> — PayPal, verified with PAYPAL_WEBHOOK_ID</li>
      </ul>
      <p class="fine">Duplicate events are ignored via a unique provider event key, so repeated webhooks cannot deduct stock twice.</p>`,
    )}
    ${panel(
      'Activation checklist',
      `<ol class="plain-list">
        <li>Merchant account approved for the currency and destination countries.</li>
        <li>Provider credentials and webhook signature verification tested in sandbox.</li>
        <li>Product price, shipping charge and customs language reviewed.</li>
        <li>Refund and cancellation policy published and accurate.</li>
        <li>Email sending domain verified so customers receive payment confirmations.</li>
        <li>Founder sign-off recorded before enabling.</li>
      </ol>`,
    )}`,
  });
}

export function shippingPage(base) {
  const { countries, currency, zones = [], zoneOf = {} } = base;
  const zoneForm = (z) => {
    const id = z ? z.id : '';
    return `<form method="post" action="/admin/shipping/zones${id ? `/${h(id)}` : ''}" class="${id ? 'panel ' : ''}console-form">
        ${csrfInput(base.csrf)}
        ${id ? `<div class="panel-head"><h2>${h(z.name)} <span class="fine">${h(z.currency)}</span></h2></div>` : ''}
        <div class="form-grid">
          ${field({ label: 'Zone name', name: 'name', value: z ? z.name : '', required: true, placeholder: 'United Kingdom' })}
          ${field({ label: 'Currency', name: 'currency', type: 'select', value: z ? z.currency : 'USD', options: CURRENCIES.map((c) => ({ value: c, label: c })), hint: 'Customers in this zone are charged in this currency. Each product needs a price in it.' })}
          ${field({ label: 'Shipping charge', name: 'shipping', type: 'number', value: z ? (z.shipping_cents / 100).toFixed(2) : '', required: true, attrs: 'step="0.01" min="0"' })}
          ${field({ label: 'Free shipping over', name: 'free_over', type: 'number', value: z && z.free_over_cents ? (z.free_over_cents / 100).toFixed(2) : '', attrs: 'step="0.01" min="0"', hint: 'Blank = never free.' })}
          ${field({ label: 'Duties handling', name: 'duties_mode', type: 'select', value: z ? z.duties_mode : 'ddu', options: [{ value: 'ddu', label: 'DDU: customer pays customs on delivery' }, { value: 'ddp', label: 'DDP: collect an estimated duty at checkout' }] })}
          ${field({ label: 'Estimated duty rate (%)', name: 'duty_pct', type: 'number', value: z ? (z.duty_bps / 100).toString() : '0', attrs: 'step="0.01" min="0" max="100"', hint: 'Only charged when handling is DDP. You carry the risk if the estimate is wrong.' })}
          ${field({ label: 'Delivery estimate', name: 'delivery_estimate', value: z ? z.delivery_estimate || '' : '' })}
          ${field({ label: 'Customs note', name: 'customs_note', type: 'textarea', value: z ? z.customs_note || '' : '', rows: 2 })}
        </div>
        <div class="form-actions">
          <button class="btn btn-dark" type="submit">${id ? 'Save zone' : 'Create zone'}</button>
          ${id ? `<button class="btn btn-danger" type="submit" name="action" value="delete" data-confirm="Delete this zone? Its countries fall back to their own shipping charge.">Delete zone</button>` : ''}
        </div>
      </form>`;
  };
  return page(base, {
    title: 'Shipping',
    subtitle: 'Zones set currency, shipping and duties. Only enabled destinations accept orders.',
    active: 'shipping',
    body: `<div class="alert alert-info"><strong>No shipping price is assumed by the platform.</strong><p>Group countries into zones, then assign each destination below to a zone. A destination with no zone uses its own charge in the store's default currency (${h(currency)}).</p></div>
    <h2 class="section-title">Zones</h2>
    <div class="console-grid-2">
      ${zones.map((z) => zoneForm(z)).join('')}
    </div>
    ${panel('Add a zone', zoneForm(null))}
    <h2 class="section-title">Destinations</h2>
    <div class="console-grid-2">
      ${countries
        .map(
          (c) => `<form method="post" action="/admin/shipping/${h(c.code)}" class="panel console-form">
            ${csrfInput(base.csrf)}
            <div class="panel-head"><h2>${h(c.name)} <span class="fine">${h(c.code)}</span></h2></div>
            ${field({ label: 'Enabled for sale', name: 'enabled', type: 'select', value: String(c.enabled), options: [{ value: '0', label: 'Disabled' }, { value: '1', label: 'Enabled' }] })}
            ${field({ label: 'Zone', name: 'zone_id', type: 'select', value: zoneOf[c.code] || '', options: [{ value: '', label: 'No zone (own charge, default currency)' }].concat(zones.map((z) => ({ value: z.id, label: `${z.name} (${z.currency})` }))) })}
            ${field({ label: `Shipping charge (${currency})`, name: 'shipping', type: 'number', step: '0.01', min: '0', value: c.shipping_cents === null ? '' : (c.shipping_cents / 100).toFixed(2), hint: 'Leave blank if not yet quoted — checkout will refuse the destination.' })}
            ${field({ label: 'Delivery estimate', name: 'delivery_estimate', value: c.delivery_estimate || '', hint: 'Describe the range honestly; never guarantee a date.' })}
            ${field({ label: 'Customs / duties note', name: 'customs_note', type: 'textarea', value: c.customs_note || '', rows: 3 })}
            <div class="form-actions">
              <button class="btn btn-dark" type="submit">Save destination</button>
              <button class="btn btn-danger" type="submit" name="action" value="delete" data-confirm="Delete this destination?">Delete</button>
            </div>
          </form>`,
        )
        .join('')}
    </div>
    ${panel(
      'Add a destination',
      `<form method="post" action="/admin/shipping" class="form-grid">
        ${csrfInput(base.csrf)}
        ${field({ label: 'Country code', name: 'code', required: true, placeholder: 'FR', attrs: 'maxlength="2"' })}
        ${field({ label: 'Country name', name: 'name', required: true })}
        <button class="btn btn-outline" type="submit">Add destination</button>
      </form>`,
      'Enable it only once regulatory clearance and shipping are verified.',
    )}`,
  });
}

export function usersPage(base) {
  const { users } = base;
  return page(base, {
    title: 'Users & permissions',
    subtitle: 'Founder, admin and staff roles. Only founders manage payments and roles.',
    active: 'users',
    body: `<div class="console-grid-2">
      ${panel(
        'Create a user',
        `<form method="post" action="/admin/users" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Name', name: 'name', required: true })}
          ${field({ label: 'Email', name: 'email', type: 'email', required: true })}
          ${field({ label: 'Role', name: 'role', type: 'select', value: 'staff', options: [{ value: 'staff', label: 'Staff — orders and inventory viewing' }, { value: 'admin', label: 'Admin — operations' }, { value: 'founder', label: 'Founder — full control' }] })}
          ${field({ label: 'Temporary password', name: 'password', required: true, hint: 'At least 10 characters. The user must change it after first sign-in.' })}
          <button class="btn btn-dark" type="submit">Create user</button>
        </form>`,
      )}
      ${panel(
        'Role capabilities',
        `<ul class="plain-list">
          <li><strong>Founder</strong> — everything, including payments, roles and settings.</li>
          <li><strong>Admin</strong> — products, inventory, orders, batches, refunds, content, analytics.</li>
          <li><strong>Staff</strong> — order and inventory visibility, fulfilment updates.</li>
          <li><strong>Customer</strong> — storefront account only, no console access.</li>
        </ul>`,
      )}
    </div>
    ${table(
      ['Name', 'Email', 'Role', 'Status', 'Last sign-in', ''],
      users.map((u) => [
        h(u.name),
        h(u.email),
        `<span class="role role-${h(u.role)}">${h(u.role)}</span>`,
        u.is_active ? '<span class="stock stock-in_stock">Active</span>' : '<span class="stock stock-unavailable">Disabled</span>',
        h(fmtDateTime(u.last_login_at)),
        u.role === 'founder' && u.is_active && base.user.id === u.id
          ? ''
          : `<form method="post" action="/admin/users/${h(u.id)}/toggle">${csrfInput(base.csrf)}<button class="linklike" type="submit">${u.is_active ? 'Disable' : 'Enable'}</button></form>`,
      ]),
    )}`,
  });
}

export function auditPage(base) {
  const { logs, filters } = base;
  return page(base, {
    title: 'Audit log',
    subtitle: 'Administrative actions are recorded and not editable',
    active: 'audit',
    body: `<form method="get" action="/admin/audit" class="toolbar-form">
      <input type="search" name="q" value="${h(filters.q || '')}" placeholder="Search action or actor">
      <button class="btn btn-dark" type="submit">Search</button>
      <a class="btn btn-quiet" href="/admin/audit/export.csv">Export CSV</a>
    </form>
    ${table(
      ['When', 'Actor', 'Action', 'Entity', 'Details', 'IP'],
      logs.map((l) => [
        h(fmtDateTime(l.created_at)),
        h(l.actor_email || 'system'),
        h(l.action),
        h(l.entity_type ? `${l.entity_type}${l.entity_id ? ` · ${String(l.entity_id).slice(0, 10)}` : ''}` : '—'),
        `<span class="fine">${h(l.details || '')}</span>`,
        h(l.ip || '—'),
      ]),
      { empty: 'No audit entries' },
    )}`,
  });
}

export function settingsPage(base) {
  const { settings, envChecks, schemaVersion } = base;
  return page(base, {
    title: 'System settings',
    subtitle: 'Store identity, operational mode and platform status',
    active: 'settings',
    body: `<div class="console-grid-2">
      ${panel(
        'Store',
        `<form method="post" action="/admin/settings" class="form-grid">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Store name', name: 'store_name', value: settings.store_name || 'DUSK & DEW', required: true })}
          ${field({ label: 'Tagline', name: 'store_tagline', value: settings.store_tagline || '' })}
          ${field({ label: 'Support email', name: 'support_email', type: 'email', value: settings.support_email || '', hint: 'Shown on contact and footer. Use an address you actually monitor.' })}
          ${field({ label: 'Default currency', name: 'default_currency', type: 'select', value: settings.default_currency || 'USD', options: CURRENCIES.map((c) => ({ value: c, label: c })) })}
          ${field({ label: 'Supported currencies', name: 'supported_currencies', value: settings.supported_currencies || 'USD', hint: 'Comma-separated. Prices are currently recorded per product.' })}
          ${field({ label: 'Preorders authorised', name: 'preorders_enabled', type: 'select', value: String(settings.preorders_enabled || '0'), options: [{ value: '0', label: 'Disabled — no paid preorders' }, { value: '1', label: 'Enabled for products opted in' }], hint: 'Only enable after manufacturing, regulatory, shipping and payment arrangements are verified.' })}
          ${field({ label: 'Social — Instagram', name: 'social_instagram', value: settings.social_instagram || '' })}
          ${field({ label: 'Social — TikTok', name: 'social_tiktok', value: settings.social_tiktok || '' })}
          ${field({ label: 'Social — X', name: 'social_x', value: settings.social_x || '' })}
          <button class="btn btn-dark" type="submit">Save settings</button>
        </form>`,
      )}
      ${panel(
        'Platform status',
        `<ul class="checklist">
          <li class="ok"><span class="tick">✓</span><div><strong>Database (D1 / SQLite)</strong><p class="fine">Schema ${h(schemaVersion)}. Foreign keys, CHECK constraints and indexes applied.</p></div></li>
          <li class="ok"><span class="tick">✓</span><div><strong>Server-side sessions</strong><p class="fine">PBKDF2-SHA256 password hashing, hashed session tokens, CSRF on every form.</p></div></li>
          ${envChecks
            .map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><span class="tick">${c.ok ? '✓' : '○'}</span><div><strong>${h(c.label)}</strong><p class="fine">${h(c.detail)}</p></div></li>`)
            .join('')}
        </ul>`,
        'Environment checks report presence only — secret values are never rendered.',
      )}
    </div>
    ${panel(
      'Sample data',
      `<p>The platform was set up with a demonstration order, customer, waitlist entry and production batch. They distort your reports. Remove them once you have seen how they look. Real orders are never touched.</p>
       <form method="post" action="/admin/settings/purge-sample">
         ${csrfInput(base.csrf)}
         <button class="btn btn-danger" type="submit" data-confirm="Remove the sample order, customer, waitlist entry and sample batch? This cannot be undone.">Remove sample data</button>
       </form>
       <p class="fine">Products, categories, ingredients and page content are edited or deleted from their own screens.</p>`,
    )}
    ${panel(
      'Operational safeguards',
      `<ul class="plain-list">
        <li>Orders, payments, refunds and inventory movements are append-only records. Products that have been ordered are archived, never deleted.</li>
        <li>Successful payments deduct stock exactly once; repeated webhooks are ignored by unique event key.</li>
        <li>Stock reservations expire after 30 minutes and release automatically.</li>
        <li>Paid orders that cannot be fulfilled are flagged <em>needs attention</em> instead of silently failing.</li>
        <li>Preorder quantities are capped by founder-approved batch allocations and never touch physical stock.</li>
      </ul>`,
    )}`,
  });
}
