/** Bundle the Worker for Cloudflare (single ESM module) with esbuild. */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

const result = await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: 'dist/worker.js',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

if (result.errors.length) process.exit(1);
console.log('Built dist/worker.js');
