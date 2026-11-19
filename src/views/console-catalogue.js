/** Founder Console: category and ingredient screens. */
import { consoleLayout, field, csrfInput, h, table, emptyState } from './ui.js';

const page = (base, opts) => consoleLayout({ ...base, ...opts, csrf: base.csrf });
const panel = (title, body, note = '') => `<section class="panel"><div class="panel-head"><h2>${h(title)}</h2>${note ? `<p class="fine">${h(note)}</p>` : ''}</div>${body}</section>`;

export function categoriesPage(base) {
  const { categories } = base;
  const form = (c) => `<form method="post" action="/admin/categories${c ? `/${h(c.id)}` : ''}" class="console-form">
    ${csrfInput(base.csrf)}
    <div class="form-grid">
      ${field({ label: 'Name', name: 'name', value: c ? c.name : '', required: true })}
      ${field({ label: 'Display order', name: 'sort_order', type: 'number', value: c ? String(c.sort_order) : '0', attrs: 'step="1"', hint: 'Lower numbers show first.' })}
      ${field({ label: 'Description', name: 'description', type: 'textarea', value: c ? c.description || '' : '', rows: 2 })}
    </div>
    <div class="form-actions">
      <button class="btn btn-dark" type="submit">${c ? 'Save' : 'Add category'}</button>
      ${c ? `<button class="btn btn-danger" type="submit" name="action" value="delete" data-confirm="Delete this category? ${c.product_count} product(s) will become uncategorised.">Delete</button>` : ''}
    </div>
  </form>`;
  return page(base, {
    title: 'Categories',
    subtitle: 'How products are grouped on the shop page.',
    active: 'categories',
    body: `${categories.length ? `<div class="console-grid-2">${categories.map((c) => panel(`${c.name}`, form(c), `${c.product_count} product(s) · /${c.slug}`)).join('')}</div>` : emptyState('No categories yet', 'Add your first one below.')}
    ${panel('Add a category', form(null))}`,
  });
}

export function ingredientsPage(base) {
  const { ingredients, q } = base;
  const rows = ingredients.map((i) => [
    `<a href="/admin/ingredients/${h(i.id)}">${h(i.inci_name)}</a>`,
    h(i.common_name || ''),
    h(i.fn || ''),
    String(i.product_count),
  ]);
  return page(base, {
    title: 'Ingredients',
    subtitle: 'The INCI names customers see. Attach them to products from each product page.',
    active: 'ingredients',
    body: `<div class="toolbar">
      <form class="toolbar-form" method="get" action="/admin/ingredients">
        <input type="search" name="q" value="${h(q)}" placeholder="Search ingredients" aria-label="Search ingredients">
        <button class="btn btn-quiet" type="submit">Search</button>
      </form>
    </div>
    ${table(['INCI name', 'Common name', 'Function', { label: 'Products', align: 'right' }], rows, { empty: q ? 'No ingredient matches that search' : 'No ingredients yet' })}
    ${panel('Add an ingredient', `<form method="post" action="/admin/ingredients" class="console-form">
      ${csrfInput(base.csrf)}
      <div class="form-grid">
        ${field({ label: 'INCI name', name: 'inci_name', required: true, hint: 'The official INCI name, exactly as it should print.' })}
        ${field({ label: 'Common name', name: 'common_name' })}
        ${field({ label: 'Function', name: 'fn', placeholder: 'Humectant' })}
        ${field({ label: 'Groups', name: 'categories', placeholder: 'Hydration' })}
      </div>
      <div class="form-actions"><button class="btn btn-dark" type="submit">Add ingredient</button></div>
    </form>`)}`,
  });
}

export function ingredientFormPage(base) {
  const { ingredient: i, products } = base;
  return page(base, {
    title: i.inci_name,
    subtitle: products.length ? `Used in ${products.length} product(s)` : 'Not used in any product yet',
    active: 'ingredients',
    body: `<form method="post" action="/admin/ingredients/${h(i.id)}" class="console-form">
      ${csrfInput(base.csrf)}
      ${panel('Details', `<div class="form-grid">
        ${field({ label: 'INCI name', name: 'inci_name', value: i.inci_name, required: true })}
        ${field({ label: 'Common name', name: 'common_name', value: i.common_name || '' })}
        ${field({ label: 'Function', name: 'fn', value: i.fn || '' })}
        ${field({ label: 'Groups', name: 'categories', value: i.categories || '' })}
        ${field({ label: 'Notes shown to customers', name: 'notes', type: 'textarea', value: i.notes || '', rows: 4, hint: 'Only state what you can support.' })}
        ${field({ label: 'References', name: 'references_text', type: 'textarea', value: i.references_text || '', rows: 3 })}
      </div>`)}
      ${products.length ? panel('Used in', `<ul class="alert-list">${products.map((p) => `<li><a href="/admin/products/${h(p.id)}">${h(p.name)}</a></li>`).join('')}</ul>`) : ''}
      <div class="form-actions">
        <button class="btn btn-dark" type="submit">Save ingredient</button>
        <button class="btn btn-danger" type="submit" name="action" value="delete" data-confirm="Delete this ingredient? It will be removed from every product.">Delete ingredient</button>
        <a class="btn btn-quiet" href="/admin/ingredients">Back to ingredients</a>
      </div>
    </form>`,
  });
}
