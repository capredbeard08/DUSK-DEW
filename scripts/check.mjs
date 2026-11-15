/** Syntax-check every source module (fast pre-flight before tests/build). */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['src', 'scripts', 'tests'];
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(full);
  }
}
roots.forEach(walk);
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`Syntax OK — ${files.length} modules checked.`);
