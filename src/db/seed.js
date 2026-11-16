/**
 * Idempotent first-run seed.
 *
 * IMPORTANT: the catalogue below is demonstration content. Ingredient lists and
 * claims are placeholders that the founder must verify and approve in the
 * Founder Console before the storefront is published to customers.
 */
import { nowIso, one, run, setSetting, uid } from '../lib/db.js';
import { hashPassword } from '../lib/security.js';
import { DEFAULT_TEMPLATES } from '../lib/email.js';

const CATEGORIES = [
  ['cat_serums', 'serums', 'Serums', 'Concentrated daily treatments.', 1],
  ['cat_balms', 'balms-moisturisers', 'Balms & Moisturisers', 'Barrier-supporting finishing steps.', 2],
  ['cat_cleansers', 'cleansers', 'Cleansers', 'Milk and gel cleansers for the first step.', 3],
  ['cat_sets', 'rituals', 'Ritual Sets', 'Complete routines in amber glass.', 4],
];

const INGREDIENTS = [
  ['ing_aqua', 'aqua', 'Aqua', 'Water', 'Solvent', 'Serums, cleansers, moisturisers', 'Primary carrier for water-soluble actives.'],
  ['ing_glycerin', 'glycerin', 'Glycerin', 'Glycerol', 'Humectant', 'All water-based formulas', 'Draws water into the upper layers of the skin; typically used at 2–10%.'],
  ['ing_niacinamide', 'niacinamide', 'Niacinamide', 'Vitamin B3', 'Skin-conditioning agent', 'Serums, moisturisers', 'Water-soluble form of vitamin B3. Formulated at 2–5% in most leave-on products.'],
  ['ing_hyaluronate', 'sodium-hyaluronate', 'Sodium Hyaluronate', 'Hyaluronic acid salt', 'Humectant', 'Serums, moisturisers', 'Lower molecular weight salt of hyaluronic acid; usually paired with glycerin.'],
  ['ing_squalane', 'squalane', 'Squalane', 'Olive-derived squalane', 'Emollient', 'Balms, moisturisers, serums', 'Lightweight, non-greasy emollient; oxidation-resistant compared with unsaturated oils.'],
  ['ing_panthenol', 'panthenol', 'Panthenol', 'Pro-vitamin B5', 'Skin-conditioning agent', 'Serums, balms', 'Soothing humectant, commonly used at 1–5%.'],
  ['ing_tocopherol', 'tocopherol', 'Tocopherol', 'Vitamin E', 'Antioxidant', 'Balms, oils', 'Protects oils in the formula from oxidation; also a skin-conditioning agent.'],
  ['ing_shea', 'butyrospermum-parkii-butter', 'Butyrospermum Parkii Butter', 'Shea butter', 'Emollient', 'Balms, moisturisers', 'Rich occlusive butter; use level determines texture and richness.'],
  ['ing_jojoba', 'simmondsia-chinensis-seed-oil', 'Simmondsia Chinensis Seed Oil', 'Jojoba oil', 'Emollient', 'Cleansers, balms', 'Wax ester rather than a triglyceride; stable and well tolerated.'],
  ['ing_caprylic', 'caprylic-capric-triglyceride', 'Caprylic/Capric Triglyceride', 'Fractionated coconut oil', 'Emollient, solvent', 'Cleansers, balms', 'Light, stable emollient used as a carrier in cleansing and balm formulas.'],
  ['ing_benzoate', 'sodium-benzoate', 'Sodium Benzoate', 'Sodium salt of benzoic acid', 'Preservative', 'Water-based formulas', 'Preservative effective at acidic pH; usually combined with potassium sorbate.'],
  ['ing_citric', 'citric-acid', 'Citric Acid', 'Citric acid', 'pH adjuster', 'All formulas', 'Buffers finished pH; not used as an exfoliant at adjusting levels.'],
];

const PRODUCTS = [
  {
    id: 'prd_serum',
    slug: 'first-dew-hydrating-serum',
    sku: 'DD-SER-030',
    name: 'First Dew Hydrating Serum',
    subtitle: 'A light, layerable hydration serum',
    description:
      'A weightless water-based serum formulated around glycerin, sodium hyaluronate and niacinamide. It layers under moisturiser and sits well beneath makeup. Presented in amber glass with a glass dropper.\n\nDemonstration copy — replace with founder-approved product copy before publishing.',
    net: '30 ml / 1.0 fl oz',
    inci:
      'Aqua, Glycerin, Niacinamide, Sodium Hyaluronate, Panthenol, Caprylic/Capric Triglyceride, Sodium Benzoate, Citric Acid',
    directions: 'Apply two to three drops to clean, damp skin morning and evening. Follow with moisturiser.',
    warnings: 'For external use only. Discontinue use if irritation occurs. Patch test before first use. Store away from direct sunlight.',
    claims: 'Fragrance-free',
    shipping: 'Ships from our studio in amber glass, cushioned in recycled board. Shipping charges and delivery estimates are confirmed at checkout for your destination.',
    price: 4800,
    cost: 1650,
    category: 'cat_serums',
    tone: 'amber',
    featured: 1,
    stock: 100,
    low: 10,
  },
  {
    id: 'prd_balm',
    slug: 'last-light-repair-balm',
    sku: 'DD-BAL-050',
    name: 'Last Light Repair Balm',
    subtitle: 'An occlusive evening balm',
    description:
      'A rich balm built on shea butter, squalane and jojoba oil for the final step of an evening routine. Warms between the fingertips and presses over moisturiser.\n\nDemonstration copy — replace with founder-approved product copy before publishing.',
    net: '50 ml / 1.7 fl oz',
    inci:
      'Butyrospermum Parkii Butter, Squalane, Simmondsia Chinensis Seed Oil, Caprylic/Capric Triglyceride, Tocopherol',
    directions: 'Warm a small amount between clean fingertips and press over the face as the last step of the evening routine.',
    warnings: 'For external use only. Contains nut-derived shea butter. Discontinue use if irritation occurs.',
    claims: 'Fragrance-free',
    shipping: 'Ships from our studio in amber glass. Shipping charges and delivery estimates are confirmed at checkout for your destination.',
    price: 5600,
    cost: 2100,
    category: 'cat_balms',
    tone: 'deep',
    featured: 1,
    stock: 42,
    low: 10,
  },
  {
    id: 'prd_cleanser',
    slug: 'dew-milk-cleanser',
    sku: 'DD-CLN-120',
    name: 'Dew Milk Cleanser',
    subtitle: 'A gentle rinse-off milk',
    description:
      'A soft cleansing milk that lifts sunscreen and daily grime without a tight after-feel. Rinses clean or removes with a warm cloth.\n\nDemonstration copy — replace with founder-approved product copy before publishing.',
    net: '120 ml / 4.0 fl oz',
    inci:
      'Aqua, Glycerin, Caprylic/Capric Triglyceride, Simmondsia Chinensis Seed Oil, Panthenol, Sodium Benzoate, Citric Acid',
    directions: 'Massage over dry or damp skin, then rinse with lukewarm water or remove with a soft cloth.',
    warnings: 'For external use only. Avoid direct contact with eyes. Discontinue use if irritation occurs.',
    claims: '',
    shipping: 'Ships from our studio in amber glass. Shipping charges and delivery estimates are confirmed at checkout for your destination.',
    price: 3200,
    cost: 1100,
    category: 'cat_cleansers',
    tone: 'soft',
    featured: 0,
    stock: 8,
    low: 10,
  },
  {
    id: 'prd_moisturiser',
    slug: 'rain-shield-daily-moisturiser',
    sku: 'DD-MOI-050',
    name: 'Rain Shield Daily Moisturiser',
    subtitle: 'A daily barrier moisturiser',
    description:
      'A medium-weight daily moisturiser combining glycerin, squalane and panthenol. Currently between production runs — join the waitlist to be notified.\n\nDemonstration copy — replace with founder-approved product copy before publishing.',
    net: '50 ml / 1.7 fl oz',
    inci: 'Aqua, Glycerin, Squalane, Panthenol, Caprylic/Capric Triglyceride, Sodium Benzoate, Citric Acid',
    directions: 'Apply to clean skin morning and evening after serum.',
    warnings: 'For external use only. Discontinue use if irritation occurs.',
    claims: '',
    shipping: 'Ships from our studio in amber glass. Shipping charges and delivery estimates are confirmed at checkout for your destination.',
    price: 4400,
    cost: 1500,
    category: 'cat_balms',
    tone: 'amber',
    featured: 0,
    stock: 0,
    low: 10,
  },
  {
    id: 'prd_trio',
    slug: 'dusk-ritual-trio',
    sku: 'DD-SET-001',
    name: 'Dusk Ritual Trio',
    subtitle: 'Cleanse, hydrate, seal — in one box',
    description:
      'The three-step evening ritual: Dew Milk Cleanser, First Dew Hydrating Serum and Last Light Repair Balm, boxed together. Allocated to a future production batch; preorders open only when the founder authorises them.\n\nDemonstration copy — replace with founder-approved product copy before publishing.',
    net: '3 × full size',
    inci: 'See individual products for full INCI declarations.',
    directions: 'Cleanse, apply serum to damp skin, then press balm over the top.',
    warnings: 'For external use only. See individual products for warnings.',
    claims: '',
    shipping: 'Ships from our studio once the production batch is received and packed.',
    price: 12000,
    cost: 4400,
    category: 'cat_sets',
    tone: 'deep',
    featured: 1,
    stock: 0,
    low: 5,
    preorder: 1,
  },
];

const PRODUCT_INGREDIENTS = {
  prd_serum: ['ing_aqua', 'ing_glycerin', 'ing_niacinamide', 'ing_hyaluronate', 'ing_panthenol', 'ing_caprylic', 'ing_benzoate', 'ing_citric'],
  prd_balm: ['ing_shea', 'ing_squalane', 'ing_jojoba', 'ing_caprylic', 'ing_tocopherol'],
  prd_cleanser: ['ing_aqua', 'ing_glycerin', 'ing_caprylic', 'ing_jojoba', 'ing_panthenol', 'ing_benzoate', 'ing_citric'],
  prd_moisturiser: ['ing_aqua', 'ing_glycerin', 'ing_squalane', 'ing_panthenol', 'ing_caprylic', 'ing_benzoate', 'ing_citric'],
};

const COUNTRIES = [
  ['NG', 'Nigeria', 1, 'Lagos and nationwide courier', 'Delivery estimates are confirmed by the courier at dispatch.'],
  ['GB', 'United Kingdom', 2, null, 'Import duties and VAT may apply on arrival and are set by UK customs.'],
  ['US', 'United States', 3, null, 'Import duties may apply on arrival and are set by US customs.'],
  ['CA', 'Canada', 4, null, 'Import duties and taxes may apply on arrival and are set by Canadian customs.'],
  ['AE', 'United Arab Emirates', 5, null, 'Import duties may apply on arrival and are set by UAE customs.'],
];

const CONTENT = [
  [
    'home_hero',
    'Skin, from first dew to last light.',
    'DUSK & DEW is a Nigerian-founded skincare house making considered formulas in amber glass. Every ingredient is listed in full. Every batch is recorded. Nothing is claimed that we cannot support.',
  ],
  [
    'philosophy',
    'A quiet kind of care',
    'We formulate for the long term: few steps, honest concentrations, and packaging that protects what is inside. Our routines are short on purpose, so that each product earns its place on the shelf.',
  ],
  [
    'ingredient_promise',
    'Full disclosure, every time',
    'Each product page carries the complete INCI declaration in descending order, the function of every ingredient in our library, and the directions and warnings that belong with it. Education here is not medical advice.',
  ],
  [
    'shipping_policy',
    'Shipping',
    'We ship from Lagos, Nigeria.\n\nDESTINATIONS\nWe dispatch only to destinations the founder has enabled and cleared for sale. The current list appears at checkout. If your country is not listed, join the waitlist and we will write to you when it opens.\n\nCHARGES AND ESTIMATES\nShipping charges and delivery estimates are set per destination in the Founder Console and shown before payment. We do not guarantee delivery dates: customs clearance and courier delays are outside our control.\n\nCUSTOMS AND IMPORT DUTIES\nInternational orders may attract import duties, taxes or handling fees set by your country. These are payable by the recipient and are not included in the price paid to DUSK & DEW. We cannot calculate them in advance and do not reimburse them.\n\nTRACKING\nTracking details are emailed when your parcel is dispatched and are also available in your account.',
  ],
  [
    'returns_policy',
    'Returns and refunds',
    'DAMAGED OR MISSING ORDERS\nWrite to us within 14 days of the delivery estimate with your order reference and photographs of the packaging. We will replace or refund damaged items once the carrier claim is reviewed.\n\nCHANGE OF MIND\nFor hygiene reasons opened skincare cannot be returned. Unopened, sealed products may be returned within 14 days of delivery, with return shipping arranged by the customer. Refunds are issued to the original payment method after inspection.\n\nPREORDERS\nPreorders may be cancelled for a full refund at any time before the batch is packed for dispatch. If a production batch is delayed, you may cancel and receive a full refund.\n\nREFUND TIMING\nWe issue refunds promptly, but banks and payment providers control how long funds take to appear. We will confirm the refund from our side and provide the provider reference.\n\nHOW TO START\nUse the contact form and include your order reference.',
  ],
  [
    'preorder_policy',
    'How preorders work',
    'A preorder reserves units from a specific production batch. It is not stock sitting in our studio.\n\nPRODUCTION BATCHES\nEach batch has a reference, a manufacturer, a target quantity and an estimated completion date. Preorder capacity is capped at the founder-approved allocation for that batch, so we never sell more than we have arranged to make.\n\nDISPATCH ESTIMATES\nEstimated dispatch dates are shown on the product page and in your confirmation. They are estimates, not guarantees.\n\nNOTIFICATIONS\nWe write at each stage: order confirmation, payment verification, production start, quality approval, receipt into inventory and dispatch.\n\nCANCELLATION AND REFUNDS\nYou may cancel a preorder for a full refund before dispatch. If a batch is delayed beyond the estimate, we will tell you and offer the choice of waiting or a full refund.\n\nDELAYS\nManufacturing, regulatory checks and international freight can move. When they do, we tell affected customers directly rather than quietly changing the date.',
  ],
  [
    'our_story',
    'Made in Lagos, for skin everywhere',
    'DUSK & DEW began with a simple frustration: it was easier to find out what was in a serum than to find out whether the brand would tell you the truth about it.\n\nWe are Nigerian-founded and internationally minded. Our formulas are developed with manufacturing partners we visit, our batches are recorded by reference, and our ingredient library exists so that a customer can read the same information we formulate with.\n\nWe are starting small. The first release is a short ritual, sold in amber glass, shipped from Lagos. As production and regulatory clearance allow, we will open more destinations — in the order we can support them properly.',
  ],
  [
    'contact_intro',
    'Write to us',
    'Questions about an order, a preorder, ingredients or shipping: send a note and we will reply. For order questions, include your order reference.',
  ],
  ['announcement', 'Waitlist open', 'The first release is being finalised. Join the waitlist to be told first — no payment is taken.'],
];

const DEV_FOUNDER_PASSWORD = 'DuskAndDew!2026';

/**
 * The founder bootstrap password must be supplied explicitly. A well-known
 * default exists only for local development and only when ALLOW_DEV_DEFAULTS=1.
 */
export function resolveFounderPassword(env = {}) {
  const supplied = env.FOUNDER_PASSWORD && String(env.FOUNDER_PASSWORD);
  if (supplied) {
    if (supplied.length < 12) {
      throw new Error('FOUNDER_PASSWORD must be at least 12 characters.');
    }
    return supplied;
  }
  if (String(env.ALLOW_DEV_DEFAULTS) === '1') return DEV_FOUNDER_PASSWORD;
  throw new Error('FOUNDER_PASSWORD is not set. Set it as a secret before the first request (local dev: set ALLOW_DEV_DEFAULTS=1).');
}

export async function seedDatabase(db, env = {}) {
  const existing = await one(db, 'SELECT value FROM settings WHERE key = ?', 'schema_version');
  const founder = await one(db, 'SELECT id FROM users LIMIT 1');
  // A partially completed seed (for example a platform crypto failure mid-run)
  // is repaired rather than treated as finished.
  if (existing && founder) return { seeded: false };

  // Fail closed before writing anything: no password, no seed, no guessable account.
  resolveFounderPassword(env);

  const now = nowIso();

  const settings = {
    schema_version: '2026-11-14.1',
    store_mode: 'waitlist',
    payments_enabled: '0',
    payment_provider: 'paystack',
    payment_providers: 'paystack,paypal',
    preorders_enabled: '0',
    default_currency: 'USD',
    supported_currencies: 'USD,GBP,EUR',
    support_email: 'care@duskanddew.com',
    email_from: '',
    low_stock_default: '10',
    demo_data: '1',
    order_prefix: 'DD',
    store_name: 'DUSK & DEW',
    store_tagline: 'Skin, from first dew to last light.',
  };
  for (const [key, value] of Object.entries(settings)) {
    await setSetting(db, key, value);
  }

  const founderEmail = (env.FOUNDER_EMAIL || 'founder@duskanddew.com').toLowerCase();
  const founderPassword = resolveFounderPassword(env);
  await run(
    db,
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, is_active, must_change_password, created_at)
     VALUES (?, ?, ?, ?, 'founder', 1, 1, ?)`,
    uid('usr_'),
    founderEmail,
    'Founder',
    await hashPassword(founderPassword),
    now,
  );

  for (const [id, slug, name, description, order] of CATEGORIES) {
    await run(db, 'INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order) VALUES (?, ?, ?, ?, ?)', id, slug, name, description, order);
  }

  for (const [id, slug, inci, common, fn, categories, notes] of INGREDIENTS) {
    await run(
      db,
      `INSERT OR IGNORE INTO ingredients (id, slug, inci_name, common_name, fn, categories, notes, references_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      slug,
      inci,
      common,
      fn,
      categories,
      notes,
      'EU CosIng ingredient inventory; supplier technical data sheet on file.',
    );
  }

  for (const p of PRODUCTS) {
    await run(
      db,
      `INSERT OR IGNORE INTO products
        (id, slug, sku, name, subtitle, description, net_contents, inci_text, directions, warnings, claims,
         shipping_info, price_cents, currency, cost_cents, category_id, status, fulfilment_model, preorder_enabled,
         manual_unavailable, low_stock_threshold, image_tone, verification_status, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?, ?)`,
      p.id,
      p.slug,
      p.sku,
      p.name,
      p.subtitle,
      p.description,
      p.net,
      p.inci,
      p.directions,
      p.warnings,
      p.claims,
      p.shipping,
      p.price,
      p.cost,
      p.category,
      p.stock > 0 ? 'active' : p.preorder ? 'active' : 'out_of_stock',
      p.preorder ? 'preorder' : 'inventory',
      p.preorder ? 1 : 0,
      p.low,
      p.tone,
      p.featured,
      now,
      now,
    );
    await run(
      db,
      `INSERT OR IGNORE INTO inventory (product_id, physical_stock, reserved_stock, units_sold, last_restock_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?)`,
      p.id,
      p.stock,
      p.stock > 0 ? now : null,
      now,
    );
    const list = PRODUCT_INGREDIENTS[p.id] || [];
    for (let i = 0; i < list.length; i += 1) {
      await run(db, 'INSERT OR IGNORE INTO product_ingredients (product_id, ingredient_id, position) VALUES (?, ?, ?)', p.id, list[i], i);
    }
  }

  for (const [code, name, order, estimate, customs] of COUNTRIES) {
    await run(
      db,
      `INSERT OR IGNORE INTO supported_countries (code, name, enabled, shipping_cents, delivery_estimate, customs_note, sort_order)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      code,
      name,
      code === 'NG' ? 1 : 0,
      estimate,
      customs,
      order,
    );
  }

  for (const [key, title, body] of CONTENT) {
    await run(
      db,
      'INSERT OR IGNORE INTO site_content (key, title, body, updated_at) VALUES (?, ?, ?, ?)',
      key,
      title,
      body,
      now,
    );
  }

  for (const template of DEFAULT_TEMPLATES) {
    await run(
      db,
      'INSERT OR IGNORE INTO email_templates (key, name, subject, body, enabled, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
      template.key,
      template.name,
      template.subject,
      template.body,
      now,
    );
  }

  // A planned production batch for the ritual set, so the preorder module has a
  // real record to work with. Nothing is added to physical inventory here.
  const batchId = uid('bat_');
  await run(
    db,
    `INSERT OR IGNORE INTO production_batches
      (id, reference, manufacturer, notes, status, start_date, estimated_completion, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', NULL, NULL, ?, ?, ?)`,
    batchId,
    'BATCH-2026-01',
    'Manufacturer to be confirmed',
    'Allocation for the Dusk Ritual Trio. Set dates and manufacturer in the console once confirmed.',
    founderEmail,
    now,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO batch_items (id, batch_id, product_id, allocated_qty, preorder_qty, preorder_holds, received_qty, unit_cost_cents)
     VALUES (?, ?, 'prd_trio', 200, 0, 0, 0, 4400)`,
    uid('bit_'),
    batchId,
  );

  // Demonstration data is created only once. All fixed rows above use
  // INSERT OR IGNORE, so re-running the seed cannot duplicate the catalogue.
  const demoOrder = await one(db, 'SELECT id FROM orders LIMIT 1');
  if (!demoOrder) {
  const customerId = uid('cus_');
  const orderId = uid('ord_');
  const paymentId = uid('pay_');
  const itemId = uid('oit_');
  const orderRef = 'DD-0001';
  await run(
    db,
    'INSERT OR IGNORE INTO customers (id, email, name, country, created_at) VALUES (?, ?, ?, ?, ?)',
    customerId,
    'sample.customer@example.com',
    'Sample Customer',
    'NG',
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO orders
      (id, reference, customer_id, email, name, country, currency, subtotal_cents, shipping_cents, total_cents,
       payment_status, fulfilment_status, payment_provider, payment_reference, shipping_name, shipping_line1,
       shipping_city, internal_notes, placed_at, paid_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'NG', 'USD', 4800, 0, 4800, 'paid', 'processing', 'sample', 'SAMPLE-PAY-0001',
       'Sample Customer', '1 Example Street', 'Lagos', ?, ?, ?, ?)`,
    orderId,
    orderRef,
    customerId,
    'sample.customer@example.com',
    'Sample Customer',
    'Demonstration order created during setup so the console has example data. Safe to keep as a reference.',
    now,
    now,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO order_items (id, order_id, product_id, name, sku, qty, unit_price_cents, line_total_cents, fulfilment_model)
     VALUES (?, ?, 'prd_serum', 'First Dew Hydrating Serum', 'DD-SER-030', 1, 4800, 4800, 'inventory')`,
    itemId,
    orderId,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO payments (id, order_id, provider, reference, provider_reference, amount_cents, currency, status, created_at, verified_at)
     VALUES (?, ?, 'sample', 'SAMPLE-PAY-0001', 'SAMPLE-PAY-0001', 4800, 'USD', 'succeeded', ?, ?)`,
    paymentId,
    orderId,
    now,
    now,
  );
  await run(db, 'UPDATE inventory SET physical_stock = 99, units_sold = 1 WHERE product_id = ?', 'prd_serum');
  await run(
    db,
    `INSERT OR IGNORE INTO inventory_movements (id, product_id, kind, qty_delta, physical_after, reserved_after, reason, reference_type, reference_id, created_at)
     VALUES (?, 'prd_serum', 'sale', -1, 99, 0, ?, 'order', ?, ?)`,
    uid('mov_'),
    `Demonstration sale for order ${orderRef}`,
    orderId,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO waitlist (id, email, name, country, product_id, source, status, created_at)
     VALUES (?, 'sample.waitlist@example.com', 'Sample Waitlist', 'GB', 'prd_moisturiser', 'waitlist', 'waiting', ?)`,
    uid('wl_'),
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO audit_logs (id, actor_email, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, 'system.seeded', 'system', 'bootstrap', ?, ?)`,
    uid('aud_'),
    founderEmail,
    JSON.stringify({ products: PRODUCTS.length, note: 'Demonstration catalogue and sample order created.' }),
    now,
  );
  }

  return { seeded: true, founderEmail };
}
