#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'SimulationGarden'), output = path.join(root, 'Resources/SimulationGarden');
execFileSync('npm', ['run', 'build'], { cwd: source, stdio: 'inherit' });
const dist = path.join(source, 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
// The single self-contained Vite bundle is classic-script compatible. Avoid
// file:// ES-module CORS without weakening WebKit's file access policy.
for (const name of fs.readdirSync(path.join(dist, 'assets')).filter(x => x.endsWith('.js'))) {
  const file = path.join(dist, 'assets', name), code = fs.readFileSync(file, 'utf8');
  new vm.Script(code);
  // Preserve module-local lexical scope when serving as a local classic script.
  // Only explicit window bridge functions may enter the host namespace.
  fs.writeFileSync(file, '(()=>{\n' + code + '\n})();\n');
}
html = html.replace(/<script type="module" crossorigin src=/g, '<script defer src=').replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ');
if (html.includes('type="module"')) throw Error('Unexpected module dependency; do not weaken local file security');
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.rmSync(output, { recursive: true, force: true }); fs.cpSync(dist, output, { recursive: true });
const files = [];
function walk(folder) { for (const e of fs.readdirSync(folder, { withFileTypes: true })) { const p = path.join(folder, e.name); if (e.isDirectory()) walk(p); else { const b = fs.readFileSync(p); files.push({ path: path.relative(output, p), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }); } } }
walk(output); fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ schema: 1, source: 'products/os1-mac-runtime/SimulationGarden', files }, null, 2) + '\n');
console.log('Simulation garden bundled locally; no external network or independent engine.');
