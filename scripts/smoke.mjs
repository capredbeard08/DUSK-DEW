/** Quick end-to-end smoke check of the Worker routes. */
import { createEnv, request, loginFounder } from '../tests/helpers.mjs';

const env = await createEnv();

for (const path of ['/', '/shop', '/shop/first-dew-hydrating-serum', '/ingredients', '/ingredients/glycerin', '/our-story', '/contact', '/shipping-and-returns', '/preorder-information', '/bag', '/checkout', '/admin/login', '/healthz']) {
  const res = await request(env, path);
  console.log(res.status, path, res.text.length, res.text.startsWith('{') ? '' : '');
}

const login = await loginFounder(env);
console.log('login', login.status, login.location, Object.keys(login.jar));
for (const path of ['/admin', '/admin/products', '/admin/inventory', '/admin/restocks', '/admin/orders', '/admin/customers', '/admin/preorders', '/admin/batches', '/admin/analytics', '/admin/content', '/admin/notifications', '/admin/payments', '/admin/shipping', '/admin/users', '/admin/audit', '/admin/settings']) {
  const res = await request(env, path, { jar: login.jar });
  console.log(res.status, path, res.text.slice(0, 120).replace(/\s+/g, ' '));
}
