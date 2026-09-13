// Exact-source landing-page patch; no server/private core is committed here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PIN, assetURL } from './bootstrap-os1-release.mjs';

export const beforeSHA = '7a7184e4e9dbe5c15c1313aa037865210a92dbb858aea564ee6b2b6e31f99417';
export function updateDownloadPage(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), beforeSHA,
    'Landing page changed; review the fresh source instead of overwriting it');
  const oldURL = 'https://github.com/effacermonexistence/codex/releases/download/os1-v0.9.44-beta.1/OS-1-0.9.44-macOS-beta.zip';
  assert.equal(original.split(oldURL).length - 1, 2);
  let output = original.replaceAll(oldURL, assetURL);
  for (const [oldText, newText] of [
    ['DOWNLOAD MAC BETA · 95', `DOWNLOAD MAC BETA · ${PIN.build}`],
    ['>Download Mac beta · build 95<', `>Download Mac beta · build ${PIN.build}<`],
    ['OS-1 CLODEX 0.9.44 · build 95 · macOS 13+ · Apple Silicon + Intel',
      `OS-1 CLODEX ${PIN.version} · build ${PIN.build} · macOS 13+ · Apple Silicon + Intel`],
  ]) {
    assert.equal(output.split(oldText).length - 1, 1, `Expected exact text: ${oldText}`);
    output = output.replace(oldText, newText);
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  assert(source && destination, 'source HTML and new destination HTML required');
  const output = updateDownloadPage(fs.readFileSync(source, 'utf8'));
  fs.writeFileSync(destination, output, { flag: 'wx', mode: 0o644 });
  console.log(JSON.stringify({ sourceSHA256: beforeSHA,
    outputSHA256: createHash('sha256').update(output).digest('hex'), tag: PIN.tag, build: PIN.build }));
}
