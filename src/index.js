/**
 * DUSK & DEW — Cloudflare Worker entry point.
 * Storefront + Founder Console + D1-backed operations, rendered server-side.
 */
import { ensureReady } from './lib/bootstrap.js';
import { getAuth, canAccessConsole } from './lib/security.js';
import { html, isAssetPath, jsonResponse, publicContext } from './lib/http.js';
import { handleWebhook } from './lib/payments.js';
import { handlePublic } from './routes/public.js';
import { handleAccount } from './routes/account.js';
import { handleAdmin, handleAdminLogin } from './routes/admin.js';
import { handleAdminSales } from './routes/admin-sales.js';
import { handleAdminSystem } from './routes/admin-system.js';
import { notFoundPage } from './views/public.js';

const ROBOTS = `User-agent: *
Disallow: /admin
Disallow: /account
Disallow: /checkout
Disallow: /order
Disallow: /pay
Allow: /

Sitemap: /sitemap.xml
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    const method = request.method.toUpperCase();

    if (path === '/healthz') {
      try {
        await ensureReady(env);
        return jsonResponse({ ok: true, service: 'dusk-and-dew', time: new Date().toISOString() });
      } catch (err) {
        return jsonResponse({ ok: false, error: String(err).slice(0, 200) }, 503);
      }
    }

    if (path === '/robots.txt') {
      return new Response(ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (isAssetPath(path)) {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      return env.ASSETS.fetch(request);
    }

    try {
      await ensureReady(env);
      const db = env.DB;

      if (path.startsWith('/webhooks/')) {
        if (method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
        const provider = path.split('/')[2];
        const rawBody = await request.text();
        const result = await handleWebhook(db, env, provider, rawBody, request.headers);
        return jsonResponse(result.body, result.status);
      }

      if (path === '/admin/login') {
        return await handleAdminLogin({ db, request, env, path, method });
      }

      if (path === '/admin' || path.startsWith('/admin/')) {
        const auth = await getAuth(db, request);
        if (!auth || !canAccessConsole(auth.user)) {
          const headers = new Headers({ location: '/admin/login' });
          return new Response(null, { status: 303, headers });
        }
        const args = { db, request, env, url, path, method, auth };
        const response = (await handleAdmin(args)) || (await handleAdminSales(args)) || (await handleAdminSystem(args));
        if (response) return response;
        return html('<h1>Console page not found</h1>', 404);
      }

      const accountResponse = await handleAccount({ db, request, env, url, path, method });
      if (accountResponse) return accountResponse;

      const publicResponse = await handlePublic({ db, request, env, url, path, method });
      if (publicResponse) return publicResponse;

      const ctxPage = await publicContext(db, request);
      return html(notFoundPage(ctxPage), 404, ctxPage.cookies);
    } catch (err) {
      console.error('Unhandled request error', err && err.stack ? err.stack : err);
      return html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Something went wrong</title><link rel="stylesheet" href="/styles.css"></head>
        <body class="public"><main class="wrap centered-page"><p class="eyebrow">Server error</p><h1>Something went wrong</h1>
        <p>The request could not be completed. Please try again, or contact customer care if it continues.</p>
        <a class="btn btn-dark" href="/">Return home</a></main></body></html>`,
        500,
      );
    }
  },
};
