/** Public storefront pages. Server-rendered, no client-side data fetching. */
import { publicLayout, productCard, bottleArt, h, money, field, csrfInput, stockPill, fmtDate, emptyState, pager } from './ui.js';

function paragraphs(text = '') {
  return String(text)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => {
      const clean = block.trim();
      if (/^[A-Z0-9 &'’/()-]{4,}$/.test(clean) && clean.length < 60) {
        return `<h3 class="policy-head">${h(clean)}</h3>`;
      }
      return `<p>${h(clean).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function heroBottles(products) {
  const picks = products.slice(0, 3);
  return `<div class="hero-stack">
    ${picks
      .map(
        (p, i) => `<div class="hero-bottle hb-${i + 1}">
          ${bottleArt({ name: p.name, net: p.net_contents, tone: p.image_tone, imageUrl: p.image_url })}
        </div>`,
      )
      .join('')}
    <span class="hero-ring" aria-hidden="true"></span>
  </div>`;
}

function waitlistForm({ settings, products, csrf, compact = false, selected = '', heading = 'Join the waitlist', copy = 'No payment is taken. We will write when the first batch is ready for your country.' }) {
  return `<form class="waitlist-form ${compact ? 'compact' : ''}" method="post" action="/waitlist">
    ${csrfInput(csrf)}
    <div class="wl-head"><h2>${h(heading)}</h2><p>${h(copy)}</p></div>
    <div class="wl-fields">
      ${field({ label: 'Name', name: 'name', required: true, placeholder: 'Your name' })}
      ${field({ label: 'Email', name: 'email', type: 'email', required: true, placeholder: 'you@example.com' })}
      ${field({
        label: 'Country',
        name: 'country',
        type: 'select',
        value: 'NG',
        options: (settings.countries || []).map((c) => ({ value: c.code, label: c.name })),
      })}
      ${field({
        label: 'Product of interest',
        name: 'product_id',
        type: 'select',
        value: selected,
        options: [{ value: '', label: 'Any / not sure yet' }].concat(products.map((p) => ({ value: p.id, label: p.name }))),
      })}
    </div>
    <div class="hp-field" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
    <button class="btn btn-dark" type="submit">Register interest</button>
    <p class="wl-fine">We store your name, email, country and product interest to contact you about availability. See our shipping and returns page for policy detail.</p>
  </form>`;
}

export function homePage(base) {
  const { settings, content, products, ingredients, csrf } = base;
  const hero = content.home_hero || { title: 'Skin, from first dew to last light.', body: '' };
  const featured = products.filter(({ product }) => product.featured).slice(0, 4);
  const collection = featured.length ? featured : products.slice(0, 4);
  const ctaHref = settings.store_mode === 'live' ? '/shop' : '#waitlist';
  const ctaLabel = settings.store_mode === 'live' ? 'Shop the collection' : 'Join the waitlist';
  const highlights = [
    ['01', 'Full INCI disclosure', 'Every product page carries the complete ingredient declaration, in order.'],
    ['02', 'Recorded batches', 'Each production run is logged with manufacturer, quantity and dates.'],
    ['03', 'Cleared destinations only', 'We open a country when shipping and regulatory clearance are in place.'],
  ];
  return publicLayout({
    ...base,
    title: 'Considered skincare, made in Lagos',
    description: 'DUSK & DEW — Nigerian-founded skincare in amber glass. Full ingredient disclosure, recorded production batches, international shipping as destinations are cleared.',
    body: `
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">Nigerian-founded · International</p>
          <h1>${h(hero.title)}</h1>
          <p class="lede">${h(hero.body)}</p>
          <div class="hero-actions">
            <a class="btn btn-dark" href="${ctaHref}">${h(ctaLabel)}</a>
            <a class="btn btn-outline" href="/our-story">Our story</a>
          </div>
          <p class="hero-fine">${settings.payments_enabled === '1' ? 'Payments verified server-side. Duties and taxes may apply on arrival.' : 'Waitlist mode: register interest, no payment is taken.'}</p>
        </div>
        ${heroBottles(products.map(({ product }) => product))}
      </div>
    </section>

    <section class="marquee" aria-label="Brand principles">
      <div class="wrap marquee-inner">
        <span>Full ingredient lists</span><span>·</span><span>Amber glass</span><span>·</span><span>Batch recorded</span><span>·</span><span>Made in Lagos</span><span>·</span><span>International</span>
      </div>
    </section>

    <section class="section wrap">
      <div class="section-head">
        <div><p class="eyebrow">The first release</p><h2>Four steps, nothing extra</h2></div>
        <a class="text-link" href="/shop">View all products →</a>
      </div>
      <div class="product-grid">${collection.map(({ product, stock }) => productCard(product, stock)).join('')}</div>
    </section>

    <section class="split wrap">
      <div class="split-media">
        <div class="editorial-frame">
          ${bottleArt({ name: 'First Dew Hydrating Serum', net: '30 ml', tone: 'amber' })}
        </div>
      </div>
      <div class="split-copy">
        <p class="eyebrow">Philosophy</p>
        <h2>${h(content.philosophy?.title || 'A quiet kind of care')}</h2>
        ${paragraphs(content.philosophy?.body || '')}
        <a class="text-link" href="/our-story">Read the full story →</a>
      </div>
    </section>

    <section class="band">
      <div class="wrap band-grid">
        ${highlights
          .map(
            ([num, title, body]) => `<div class="band-item"><p class="band-num">${num}</p><h3>${h(title)}</h3><p>${h(body)}</p></div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="section wrap">
      <div class="section-head">
        <div><p class="eyebrow">Ingredient transparency</p><h2>${h(content.ingredient_promise?.title || 'Full disclosure, every time')}</h2></div>
        <a class="text-link" href="/ingredients">Open the library →</a>
      </div>
      <div class="ingredient-band">
        <div class="ingredient-copy">${paragraphs(content.ingredient_promise?.body || '')}</div>
        <ul class="ingredient-chips">
          ${ingredients
            .slice(0, 10)
            .map((ing) => `<li><a href="/ingredients/${h(ing.slug)}">${h(ing.inci_name)}</a><span>${h(ing.fn || '')}</span></li>`)
            .join('')}
        </ul>
      </div>
    </section>

    <section class="section section-tint" id="waitlist">
      <div class="wrap split split-reverse">
        <div class="split-copy">
          <p class="eyebrow">${settings.store_mode === 'live' ? 'First access' : 'Waitlist open'}</p>
          <h2>Be told before the first batch leaves the studio</h2>
          <p>We are finalising manufacturing, regulatory clearance and international shipping country by country. Register your interest and we will write to you when your destination opens — or when preordering is authorised.</p>
          <p class="fine">Your details are used only for availability and occasional studio letters. No payment is collected.</p>
        </div>
        ${waitlistForm({ settings, products, csrf })}
      </div>
    </section>`,
  });
}

export function shopPage(base) {
  const { products, categories, filters, settings, total, page, pages } = base;
  const activeCat = filters.category || '';
  return publicLayout({
    ...base,
    title: 'Shop',
    description: 'The DUSK & DEW catalogue: serums, balms, cleansers and ritual sets.',
    body: `<div class="wrap page-head">
      <p class="eyebrow">Catalogue</p>
      <h1>The collection</h1>
      <p class="lede">${products.length} of ${total} products. Every listing shows availability before you commit.</p>
      <p class="fine">${settings.payments_enabled === '1' ? 'Prices are shown in USD and include product only; shipping is calculated before payment.' : 'Waitlist mode: prices are shown for reference. No payment is taken.'}</p>
    </div>
    <div class="wrap shop-layout">
      <aside class="filters" aria-label="Filters">
        <form method="get" action="/shop">
          <label class="filter-label" for="q">Search</label>
          <input id="q" type="search" name="q" value="${h(filters.q || '')}" placeholder="Search products">
          <p class="filter-label">Category</p>
          <div class="filter-links">
            <a href="/shop${filters.q ? `?q=${encodeURIComponent(filters.q)}` : ''}" class="${!activeCat ? 'active' : ''}">All</a>
            ${categories
              .map(
                (c) =>
                  `<a href="/shop?category=${h(c.slug)}${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ''}" class="${activeCat === c.slug ? 'active' : ''}">${h(c.name)}</a>`,
              )
              .join('')}
          </div>
          <label class="filter-label" for="availability">Availability</label>
          <select id="availability" name="availability">
            <option value="">All</option>
            <option value="in_stock" ${filters.availability === 'in_stock' ? 'selected' : ''}>In stock only</option>
            <option value="preorder" ${filters.availability === 'preorder' ? 'selected' : ''}>Preorder</option>
            <option value="waitlist" ${filters.availability === 'waitlist' ? 'selected' : ''}>Join waitlist</option>
          </select>
          <label class="filter-label" for="sort">Sort by</label>
          <select id="sort" name="sort">
            <option value="featured" ${filters.sort === 'featured' ? 'selected' : ''}>Featured</option>
            <option value="price-asc" ${filters.sort === 'price-asc' ? 'selected' : ''}>Price: low to high</option>
            <option value="price-desc" ${filters.sort === 'price-desc' ? 'selected' : ''}>Price: high to low</option>
            <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Name</option>
          </select>
          <button class="btn btn-dark full" type="submit">Apply filters</button>
        </form>
      </aside>
      <div class="shop-results">
        ${products.length ? `<div class="product-grid grid-3">${products.map(({ product, stock }) => productCard(product, stock)).join('')}</div>` : emptyState('No products match those filters', 'Try a broader search or clear the filters.')}
        ${pages > 1 ? `<div class="pager-row">${pager(`/shop?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}`, { page, pages })}</div>` : ''}
      </div>
    </div>`,
  });
}

export function productPage(base) {
  const { product, stock, ingredients, related, settings, csrf, categories } = base;
  const ingredientByName = new Map(ingredients.map((i) => [i.inci_name.toLowerCase(), i]));
  const inciParts = String(product.inci_text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const claims = String(product.claims || '')
    .split(/[,;]\s*/)
    .filter(Boolean);
  return publicLayout({
    ...base,
    title: product.name,
    description: product.subtitle || product.description || '',
    body: `<div class="wrap breadcrumb"><a href="/shop">Shop</a> <span>/</span> ${
      product.category_slug ? `<a href="/shop?category=${h(product.category_slug)}">${h(product.category_name)}</a> <span>/</span>` : ''
    } <span>${h(product.name)}</span></div>
    <section class="wrap product-detail">
      <div class="product-media">
        ${bottleArt({ name: product.name, net: product.net_contents, tone: product.image_tone, imageUrl: product.image_url })}
        <div class="media-meta"><span>${h(product.net_contents || '')}</span><span>SKU ${h(product.sku)}</span></div>
      </div>
      <div class="product-info">
        <p class="eyebrow">${h(product.category_name || 'Skincare')}</p>
        <h1>${h(product.name)}</h1>
        <p class="lede">${h(product.subtitle || '')}</p>
        <div class="price-row">
          <span class="price price-lg">${money(product.price_cents, product.currency)}</span>
          ${stockPill(stock)}
        </div>
        <p class="fine">${settings.payments_enabled === '1' ? 'Product price only. Shipping and any applicable duties are shown separately.' : 'Waitlist mode — no payment is taken today.'}</p>
        ${
          stock.purchasable
            ? `<form class="buy-form" data-add-to-bag data-id="${h(product.id)}" data-name="${h(product.name)}" data-price="${product.price_cents}" data-slug="${h(product.slug)}" data-image-tone="${h(product.image_tone)}" data-net="${h(product.net_contents || '')}">
                <label for="qty">Quantity</label>
                <input id="qty" name="qty" type="number" min="1" max="${stock.preorder ? 10 : Math.max(1, product.physical_stock - product.reserved_stock)}" value="1">
                <button class="btn btn-dark" type="submit">${stock.preorder ? 'Add preorder to bag' : 'Add to bag'}</button>
              </form>
              ${stock.preorder ? '<p class="notice-inline">Preorder units are allocated to a recorded production batch. Your payment is only taken once preordering is authorised.</p>' : ''}
              ${product.fulfilment_model === 'preorder' && product.preorder_enabled ? '<p class="fine">Physical stock is not deducted for preorders; units are committed to the batch.</p>' : ''}`
            : stock.waitlist
              ? `<div class="waitlist-inline">
                  <p><strong>${h(stock.label)}.</strong> Register your interest and we will write when this product is available for your country.</p>
                  <form method="post" action="/waitlist" class="stack-form">
                    ${csrfInput(csrf)}
                    <input type="hidden" name="product_id" value="${h(product.id)}">
                    ${field({ label: 'Name', name: 'name', required: true })}
                    ${field({ label: 'Email', name: 'email', type: 'email', required: true })}
                    ${field({
                      label: 'Country',
                      name: 'country',
                      type: 'select',
                      value: 'NG',
                      options: (settings.countries || []).map((c) => ({ value: c.code, label: c.name })),
                    })}
                    <div class="hp-field" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
                    <button class="btn btn-dark" type="submit">Join the waitlist</button>
                  </form>
                </div>`
              : `<p class="notice-inline">${h(stock.label)}. ${settings.support_email ? `Write to <a href="mailto:${h(settings.support_email)}">${h(settings.support_email)}</a> with any questions.` : ''}</p>`
        }
        <dl class="spec-list">
          <div><dt>Net contents</dt><dd>${h(product.net_contents || '—')}</dd></div>
          <div><dt>SKU</dt><dd>${h(product.sku)}</dd></div>
          <div><dt>Format</dt><dd>${product.fulfilment_model === 'preorder' ? 'Preorder — production batch' : 'In stock — physical inventory'}</dd></div>
          <div><dt>Ingredient status</dt><dd>${product.verification_status === 'verified' ? 'Founder verified' : 'Pending founder verification'}</dd></div>
        </dl>
        <div class="accordion">
          <details open><summary>Description</summary><div class="acc-body">${paragraphs(product.description || '')}</div></details>
          <details><summary>Full INCI ingredient declaration</summary><div class="acc-body">
            <p class="fine">Ingredients are listed as entered by the founder, in descending order. Ingredient education is not medical advice.</p>
            <ol class="inci-list">${inciParts
              .map((name) => {
                const match = ingredientByName.get(name.toLowerCase());
                return `<li>${match ? `<a href="/ingredients/${h(match.slug)}">${h(name)}</a>` : h(name)}</li>`;
              })
              .join('')}</ol>
          </div></details>
          <details><summary>Directions for use</summary><div class="acc-body">${paragraphs(product.directions || 'Directions are pending founder publication.')}</div></details>
          <details><summary>Warnings</summary><div class="acc-body">${paragraphs(product.warnings || 'Warnings are pending founder publication.')}</div></details>
          ${claims.length ? `<details><summary>Product claims</summary><div class="acc-body"><ul class="plain-list">${claims.map((c) => `<li>${h(c)}</li>`).join('')}</ul></div></details>` : ''}
          <details><summary>Shipping information</summary><div class="acc-body">${paragraphs(product.shipping_info || 'Shipping information is confirmed at checkout for your destination.')}<p><a class="text-link" href="/shipping-and-returns">Full shipping and returns policy →</a></p></div></details>
        </div>
      </div>
    </section>
    ${
      related.length
        ? `<section class="section wrap"><div class="section-head"><div><p class="eyebrow">Continue</p><h2>Pairs well with</h2></div><a class="text-link" href="/shop">All products →</a></div>
        <div class="product-grid grid-3">${related.map(({ product: p, stock: s }) => productCard(p, s)).join('')}</div></section>`
        : ''
    }`,
  });
}

export function storyPage(base) {
  const content = base.content.our_story || { title: 'Our story', body: '' };
  return publicLayout({
    ...base,
    title: 'Our story',
    description: 'DUSK & DEW is Nigerian-founded, with formulations developed around disclosure and recorded production.',
    body: `<div class="wrap page-head narrow">
      <p class="eyebrow">The house</p>
      <h1>${h(content.title)}</h1>
    </div>
    <section class="wrap editorial">
      <div class="editorial-media">${bottleArt({ name: 'DUSK & DEW', net: 'Lagos', tone: 'deep' })}</div>
      <div class="editorial-body">${paragraphs(content.body)}</div>
    </section>
    <section class="band">
      <div class="wrap band-grid">
        <div class="band-item"><p class="band-num">01</p><h3>Disclosure first</h3><p>Complete INCI declarations and a public ingredient library, not a marketing summary.</p></div>
        <div class="band-item"><p class="band-num">02</p><h3>Records, not promises</h3><p>Batches, receipts and stock movements are recorded so we can answer questions with facts.</p></div>
        <div class="band-item"><p class="band-num">03</p><h3>Patience over reach</h3><p>We open destinations and preorders only when manufacturing, clearance and shipping are verified.</p></div>
      </div>
    </section>`,
  });
}

export function ingredientsPage(base) {
  const { ingredients, query } = base;
  return publicLayout({
    ...base,
    title: 'Ingredient library',
    description: 'INCI names, common names, cosmetic functions and formulation notes for every ingredient used by DUSK & DEW.',
    body: `<div class="wrap page-head">
      <p class="eyebrow">Education</p>
      <h1>Ingredient library</h1>
      <p class="lede">The INCI name, common name, cosmetic function and formulation notes for every ingredient in our catalogue. This library is educational and is not medical advice.</p>
      <form class="search-line" method="get" action="/ingredients">
        <input type="search" name="q" value="${h(query || '')}" placeholder="Search by INCI or common name">
        <button class="btn btn-dark" type="submit">Search</button>
      </form>
    </div>
    <div class="wrap ingredient-grid">
      ${ingredients
        .map(
          (ing) => `<article class="ingredient-card">
            <p class="eyebrow">${h(ing.fn || 'Ingredient')}</p>
            <h3><a href="/ingredients/${h(ing.slug)}">${h(ing.inci_name)}</a></h3>
            <p class="ing-common">${h(ing.common_name || '')}</p>
            <p>${h(ing.notes || '')}</p>
            <p class="fine">${h(ing.categories || '')}</p>
          </article>`,
        )
        .join('')}
    </div>`,
  });
}

export function ingredientPage(base) {
  const { ingredient, products } = base;
  return publicLayout({
    ...base,
    title: ingredient.inci_name,
    description: `${ingredient.inci_name} (${ingredient.common_name || ''}) — cosmetic function and formulation notes.`,
    body: `<div class="wrap breadcrumb"><a href="/ingredients">Ingredient library</a> <span>/</span> <span>${h(ingredient.inci_name)}</span></div>
    <article class="wrap ingredient-detail">
      <p class="eyebrow">${h(ingredient.fn || 'Ingredient')}</p>
      <h1>${h(ingredient.inci_name)}</h1>
      <p class="lede">${h(ingredient.common_name || '')}</p>
      <dl class="spec-list">
        <div><dt>INCI name</dt><dd>${h(ingredient.inci_name)}</dd></div>
        <div><dt>Common name</dt><dd>${h(ingredient.common_name || '—')}</dd></div>
        <div><dt>Cosmetic function</dt><dd>${h(ingredient.fn || '—')}</dd></div>
        <div><dt>Used in</dt><dd>${h(ingredient.categories || '—')}</dd></div>
      </dl>
      <h2>Formulation notes</h2>
      ${paragraphs(ingredient.notes || '')}
      <h2>Supporting references</h2>
      ${paragraphs(ingredient.references_text || 'References are recorded by the founder.')}
      <p class="fine">This information is provided for education and is not medical advice. Patch test new products and consult a qualified professional for skin concerns.</p>
      ${products.length ? `<h2>Found in</h2><div class="product-grid grid-3">${products.map(({ product, stock }) => productCard(product, stock)).join('')}</div>` : ''}
    </article>`,
  });
}

export function policyPage(base, key, fallbackTitle) {
  const content = base.content[key] || { title: fallbackTitle, body: '' };
  return publicLayout({
    ...base,
    title: content.title,
    description: `${content.title} — DUSK & DEW.`,
    body: `<div class="wrap page-head narrow"><p class="eyebrow">Customer care</p><h1>${h(content.title)}</h1></div>
    <article class="wrap policy-body">${paragraphs(content.body)}</article>`,
  });
}

export function preorderPage(base) {
  const content = base.content.preorder_policy || { title: 'How preorders work', body: '' };
  const rows = base.preorderProducts || [];
  return publicLayout({
    ...base,
    title: 'Preorder information',
    description: 'How DUSK & DEW preorders, production batches, dispatch estimates and refunds work.',
    body: `<div class="wrap page-head narrow"><p class="eyebrow">Production</p><h1>${h(content.title)}</h1>
      <p class="fine">${base.settings.preorders_enabled === '1' ? 'Preorders are authorised for selected batches.' : 'Preorders are currently closed. The founder enables them only once manufacturing, regulatory, shipping and payment arrangements are verified.'}</p>
    </div>
    <article class="wrap policy-body">${paragraphs(content.body)}</article>
    ${
      rows.length
        ? `<section class="section wrap"><h2>Batch allocations</h2>
        ${rows
          .map(
            (r) => `<div class="batch-public">
              <div><p class="eyebrow">${h(r.reference)}</p><h3>${h(r.product_name)}</h3>
              <p class="fine">Manufacturer: ${h(r.manufacturer || 'to be confirmed')} · Estimated completion: ${h(r.estimated_completion ? fmtDate(r.estimated_completion) : 'to be confirmed')}</p></div>
              <div class="batch-meter"><span style="width:${Math.min(100, Math.round((Number(r.preorder_qty) / Math.max(1, Number(r.allocated_qty))) * 100))}%"></span></div>
              <p class="fine">${Number(r.preorder_qty)} of ${Number(r.allocated_qty)} allocated units preordered</p>
            </div>`,
          )
          .join('')}</section>`
        : ''
    }`,
  });
}

export function contactPage(base) {
  return publicLayout({
    ...base,
    title: 'Contact',
    description: 'Contact DUSK & DEW customer care.',
    body: `<div class="wrap page-head narrow"><p class="eyebrow">Customer care</p><h1>${h(base.content.contact_intro?.title || 'Write to us')}</h1>
      <p class="lede">${h(base.content.contact_intro?.body || '')}</p></div>
    <section class="wrap contact-grid">
      <form class="panel-form" method="post" action="/contact">
        ${csrfInput(base.csrf)}
        ${field({ label: 'Name', name: 'name', required: true })}
        ${field({ label: 'Email', name: 'email', type: 'email', required: true })}
        ${field({ label: 'Order reference (optional)', name: 'subject', placeholder: 'DD-0001' })}
        ${field({ label: 'Message', name: 'message', type: 'textarea', required: true, rows: 6 })}
        <div class="hp-field" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn btn-dark" type="submit">Send message</button>
      </form>
      <aside class="contact-aside">
        <h2>Customer care</h2>
        ${base.settings.support_email ? `<p><a href="mailto:${h(base.settings.support_email)}">${h(base.settings.support_email)}</a></p>` : '<p>Support address is being finalised.</p>'}
        <p class="fine">We reply during Lagos business hours. Include your order reference for anything order-related.</p>
        <h3>Policies</h3>
        <p><a class="text-link" href="/shipping-and-returns">Shipping, returns and refunds →</a></p>
        <p><a class="text-link" href="/preorder-information">Preorder information →</a></p>
        <h3>Social</h3>
        <p class="fine">${base.settings.social_instagram || base.settings.social_tiktok || base.settings.social_x ? [base.settings.social_instagram, base.settings.social_tiktok, base.settings.social_x].filter(Boolean).map((u) => `<a href="${h(u)}" rel="noopener">${h(u.replace(/^https?:\/\//, ''))}</a>`).join('<br>') : 'Social accounts are added in the Founder Console.'}</p>
      </aside>
    </section>`,
  });
}

export function bagPage(base) {
  return publicLayout({
    ...base,
    title: 'Your bag',
    body: `<div class="wrap page-head"><p class="eyebrow">Checkout</p><h1>Your bag</h1></div>
    <section class="wrap bag-layout">
      <div id="bag-items" class="bag-items"><p class="fine">Loading your bag…</p></div>
      <aside class="bag-summary">
        <h2>Summary</h2>
        <div class="summary-row"><span>Subtotal</span><span id="bag-subtotal">—</span></div>
        <div class="summary-row"><span>Shipping</span><span>Calculated per destination</span></div>
        <p class="fine">${base.settings.payments_enabled === '1' ? 'Duties and import taxes are not included and may be payable on arrival.' : 'Waitlist mode: submitting your bag registers interest. No payment is taken.'}</p>
        <a class="btn btn-dark full" id="bag-checkout" href="/checkout">${base.settings.payments_enabled === '1' ? 'Continue to checkout' : 'Register my interest'}</a>
        <a class="btn btn-outline full" href="/shop">Continue shopping</a>
      </aside>
    </section>`,
  });
}

export function checkoutPage(base) {
  const { settings, countries, csrf } = base;
  const paymentsOn = settings.payments_enabled === '1' && base.providers.length > 0;
  return publicLayout({
    ...base,
    title: 'Checkout',
    body: `<div class="wrap page-head"><p class="eyebrow">Checkout</p><h1>${paymentsOn ? 'Complete your order' : 'Register your interest'}</h1>
      <p class="lede">${paymentsOn ? 'Payment is verified on our server before stock is committed. We never store card details.' : 'Ordering opens in waitlist mode: we record your interest and write to you before anything is charged.'}</p>
    </div>
    <section class="wrap checkout-layout">
      <form class="checkout-form" id="checkout-form" method="post" action="/checkout">
        ${csrfInput(csrf)}
        <input type="hidden" name="items" id="checkout-items" value="">
        <fieldset><legend>Contact</legend>
          ${field({ label: 'Full name', name: 'name', required: true, attrs: 'autocomplete="name"' })}
          ${field({ label: 'Email', name: 'email', type: 'email', required: true, attrs: 'autocomplete="email"' })}
        </fieldset>
        <fieldset><legend>Delivery</legend>
          <div class="field">
            <label for="f-country">Country <span class="req">*</span></label>
            <select id="f-country" name="country" required data-shipping-select>
              ${countries.map((c) => `<option value="${h(c.code)}" data-shipping="${c.shipping_cents || 0}">${h(c.name)}${paymentsOn && c.shipping_cents !== null ? ` — shipping ${money(c.shipping_cents, settings.default_currency)}` : ''}</option>`).join('')}
            </select>
            <p class="hint">${paymentsOn ? 'Import duties and taxes may be payable on arrival and are not included.' : 'No payment is taken in waitlist mode. We use this to understand where to open shipping first.'}</p>
          </div>
          ${field({ label: 'Address line 1', name: 'line1', required: true, attrs: 'autocomplete="address-line1"' })}
          ${field({ label: 'Address line 2', name: 'line2', attrs: 'autocomplete="address-line2"' })}
          <div class="two-col">
            ${field({ label: 'City', name: 'city', required: true, attrs: 'autocomplete="address-level2"' })}
            ${field({ label: 'State / region', name: 'region', attrs: 'autocomplete="address-level1"' })}
          </div>
          <div class="two-col">
            ${field({ label: 'Postcode', name: 'postcode', required: true, attrs: 'autocomplete="postal-code"' })}
            ${field({ label: 'Phone', name: 'phone', type: 'tel', attrs: 'autocomplete="tel"' })}
          </div>
        </fieldset>
        ${paymentsOn ? '<fieldset><legend>Payment</legend><p class="fine">You will be redirected to the payment provider. Only providers configured and verified for this store are shown.</p>' + base.providers.map((p) => `<label class="radio"><input type="radio" name="provider" value="${h(p.provider)}" ${base.providers[0].provider === p.provider ? 'checked' : ''}> <span>${h(p.label)}</span></label>`).join('') + '</fieldset>' : ''}
        <label class="check"><input type="checkbox" name="terms" required> <span>I have read the shipping and returns policy and understand that import duties may apply on arrival.</span></label>
        <div class="hp-field" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn btn-dark full" type="submit" ${countries.length ? '' : 'disabled'}>${paymentsOn ? 'Continue to payment' : 'Register my interest'}</button>
        <p class="fine">By continuing you confirm the details above. ${paymentsOn ? 'Payment status is confirmed server-side; a success page alone never marks an order paid.' : 'No payment is collected in waitlist mode.'}</p>
      </form>
      <aside class="bag-summary" id="checkout-summary">
        <h2>Your bag</h2>
        <div id="checkout-items-list"><p class="fine">Loading…</p></div>
        <div class="summary-row"><span>Subtotal</span><span id="checkout-subtotal">—</span></div>
        <div class="summary-row"><span>Shipping</span><span id="checkout-shipping">Per destination</span></div>
        <div class="summary-row total"><span>Total</span><span id="checkout-total">—</span></div>
        <p class="fine">All amounts in ${h(settings.default_currency || 'USD')}.</p>
      </aside>
    </section>`,
  });
}

export function waitlistThanks(base) {
  return publicLayout({
    ...base,
    title: 'You are on the list',
    body: `<section class="wrap centered-page">
      <p class="eyebrow">Registered</p>
      <h1>You are on the list</h1>
      <p class="lede">Thank you. We have recorded your interest${base.productName ? ` in ${h(base.productName)}` : ''}. We will write to you when there is news about availability for your country.</p>
      <p class="fine">No payment has been taken. You can update your preferences by replying to any email from us.</p>
      <a class="btn btn-dark" href="/shop">Back to the collection</a>
    </section>`,
  });
}

export function orderPage(base) {
  const { order, items, payments, refunds, authorized, lookupError } = base;
  if (!authorized) {
    return publicLayout({
      ...base,
      title: 'Order lookup',
      body: `<section class="wrap centered-page">
        <p class="eyebrow">Order lookup</p>
        <h1>Confirm your email</h1>
        <p class="lede">For your privacy, enter the email address used for this order.</p>
        ${lookupError ? `<div class="flash flash-error">${h(lookupError)}</div>` : ''}
        <form method="post" action="/order/${h(order.reference)}/lookup" class="panel-form narrow-form">
          ${csrfInput(base.csrf)}
          <input type="hidden" name="reference" value="${h(order.reference)}">
          ${field({ label: 'Email', name: 'email', type: 'email', required: true })}
          <button class="btn btn-dark" type="submit">View order</button>
        </form>
      </section>`,
    });
  }
  return publicLayout({
    ...base,
    title: `Order ${order.reference}`,
    body: `<div class="wrap page-head">
      <p class="eyebrow">Order ${h(order.reference)}</p>
      <h1>${h(order.payment_status === 'paid' ? 'Thank you — payment verified' : 'Order summary')}</h1>
      <p class="lede">Placed ${h(fmtDate(order.placed_at, true))} · ${h(order.email)}</p>
      <div class="status-row">${h(order.payment_status.replace(/_/g, ' '))} · ${h(order.fulfilment_status.replace(/_/g, ' '))}</div>
    </div>
    <section class="wrap order-layout">
      <div class="order-items">
        ${items
          .map(
            (item) => `<div class="order-item"><div><p>${h(item.name)}</p><p class="fine">SKU ${h(item.sku)} · Qty ${item.qty}${item.fulfilment_model === 'preorder' ? ' · Preorder' : ''}</p></div><span>${money(item.line_total_cents, order.currency)}</span></div>`,
          )
          .join('')}
        <div class="summary-row"><span>Subtotal</span><span>${money(order.subtotal_cents, order.currency)}</span></div>
        <div class="summary-row"><span>Shipping</span><span>${money(order.shipping_cents, order.currency)}</span></div>
        <div class="summary-row total"><span>Total</span><span>${money(order.total_cents, order.currency)}</span></div>
      </div>
      <aside class="order-side">
        <h2>Delivery</h2>
        <p>${h(order.shipping_name || order.name)}<br>${h(order.shipping_line1 || '')}${order.shipping_line2 ? `<br>${h(order.shipping_line2)}` : ''}<br>${h(order.shipping_city || '')} ${h(order.shipping_region || '')} ${h(order.shipping_postcode || '')}<br>${h(order.country)}</p>
        ${order.tracking_number ? `<p><strong>Tracking:</strong> ${h(order.tracking_number)}${order.shipping_provider ? ` (${h(order.shipping_provider)})` : ''}</p>` : '<p class="fine">Tracking is emailed when your parcel is dispatched.</p>'}
        <h2>Payments</h2>
        ${
          payments.length
            ? payments.map((p) => `<p class="fine">${h(p.provider)} · ${h(p.reference)} · ${money(p.amount_cents, p.currency)} · ${h(p.status)}</p>`).join('')
            : '<p class="fine">No payment recorded.</p>'
        }
        ${refunds.length ? `<h2>Refunds</h2>${refunds.map((r) => `<p class="fine">${money(r.amount_cents, order.currency)} · ${h(r.status)} · ${h(fmtDate(r.created_at))}</p>`).join('')}` : ''}
        <p class="fine">Questions? <a href="/contact">Contact customer care</a> with reference ${h(order.reference)}.</p>
      </aside>
    </section>`,
  });
}

export function offlinePayPage(base) {
  const { order, reference } = base;
  return publicLayout({
    ...base,
    title: `Test payment ${reference}`,
    body: `<section class="wrap centered-page">
      <p class="eyebrow">Sandbox payment — no real charge</p>
      <h1>Complete test payment</h1>
      <p class="lede">Order ${h(order.reference)} · ${money(order.total_cents, order.currency)}</p>
      <p class="fine">This page exists only because <code>PAYMENTS_OFFLINE=1</code> is set in the local environment. It simulates a provider webhook so the full inventory and order pipeline can be exercised. It is never available in production.</p>
      <form method="post" action="/pay/${h(reference)}">
        ${csrfInput(base.csrf)}
        <button class="btn btn-dark" type="submit">Simulate verified payment</button>
      </form>
    </section>`,
  });
}

export function notFoundPage(base) {
  return publicLayout({
    ...base,
    title: 'Page not found',
    body: `<section class="wrap centered-page"><p class="eyebrow">404</p><h1>This page has evaporated</h1><p class="lede">The page you asked for does not exist. The collection is still here.</p><a class="btn btn-dark" href="/shop">Shop the collection</a></section>`,
  });
}
