// Scope: ordinary Cosmology text only. Never override mathematical glyph fonts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export function checkCosmologySerif(root) {
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'content/cosmology-manifest.json'),'utf8'));
 const routes=['/talek-1-2','/cosmology-source-index',...manifest.chapters.map(c=>'/'+c.slug)];
 for(const route of routes) {
  const html=fs.readFileSync(path.join(root,'site/pages',route.slice(1)+'.html'),'utf8');
  const matches=[...html.matchAll(/<style id="cosmology-reader-v2">([\s\S]*?)<\/style>/g)];
  assert.equal(matches.length,1,route+' single owned reader style');
  const css=matches[0][1];
  for(const prefix of ['font:12px/1.5 ','font:0.86em/1.5 ','font:12px/1.8 ']) assert(css.includes(prefix+'"PT Serif",Georgia,"Times New Roman",serif'),route+' serif '+prefix);
  assert(!/Arial|sans-serif|monospace/.test(css),route+' non-serif ordinary text regression');
  assert(css.includes('.cosmology .source-note a{display:inline;font-family:inherit}'),route+' links inherit serif');
  assert(!/\.katex[^{}]*\{[^}]*font-family/.test(css),route+' do not replace math glyph families');
  assert(html.includes('source revision '+manifest.commit.slice(0,12)),route+' pinned revision');
  assert(html.includes('/s/cosmology-source--LICENSE'),route+' license link');
 }
 return {routes:routes.length,ordinaryText:'serif with explicit serif fallbacks',mathFonts:'not overridden',sourceRevision:manifest.commit.slice(0,12)};
}
