/**
 * Local development server: Node HTTP -> Worker fetch handler.
 * Serves ./public as static assets and keeps SQLite in ./data/dev.sqlite.
 * This is a development harness only; production deploy targets Cloudflare.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createD1 } from './d1-shim.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const root = process.cwd();

// Minimal .env loader (development only).
if (existsSync(path.join(root, '.env'))) {
  const text = await readFile(path.join(root, '.env'), 'utf8');
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

await mkdir(path.join(root, 'data'), { recursive: true });
const DB_FILE = path.join(root, 'data', 'dev.sqlite');
const db = createD1(DB_FILE);

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    const rel = url.pathname.replace(/^\/+/, '');
    const filePath = path.join(root, 'public', rel);
    if (!filePath.startsWith(path.join(root, 'public')) || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
      },
    });
  },
};

const env = {
  DB: db,
  ASSETS,
  APP_ORIGIN: process.env.APP_ORIGIN || `http://localhost:${PORT}`,
  FOUNDER_EMAIL: process.env.FOUNDER_EMAIL,
  FOUNDER_PASSWORD: process.env.FOUNDER_PASSWORD,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,
  PAYPAL_MODE: process.env.PAYPAL_MODE,
  PAYMENTS_OFFLINE: process.env.PAYMENTS_OFFLINE,
  PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

const worker = (await import('../src/index.js')).default;

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(url, { method: req.method, headers, body });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === 'set-cookie') continue;
      res.setHeader(key, value);
    }
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error('dev-server error', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`Development server error:\n${err && err.stack ? err.stack : err}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DUSK & DEW dev server listening on http://${HOST}:${PORT} (db: ${DB_FILE})`);
});
