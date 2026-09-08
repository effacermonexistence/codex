// Exact-source landing-page patch; no server/private core is committed here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PIN, assetURL } from './bootstrap-os1-release.mjs';

export const beforeSHA = '1cd947bf108715a529c9da415c9ba65255935283399439d55e25938f7ff70b31';
export function updateDownloadPage(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), beforeSHA,
    'Landing page changed; review the fresh source instead of overwriting it');
  const oldURL = 'https://os1-route-gateway.omar-git-r2-backup.workers.dev/v1/releases/download';
  assert.equal(original.split(oldURL).length - 1, 2);
  let output = original.replaceAll(oldURL, assetURL);
  for (const [oldText, newText] of [
    ['DOWNLOAD FOR MAC', `DOWNLOAD MAC BETA · ${PIN.build}`],
    ['>Download for Mac<', `>Download Mac beta · build ${PIN.build}<`],
    ['The Mac app and web app share one OS-1 Claudex session surface.',
      `OS-1 CLODEX ${PIN.version} · build ${PIN.build} · macOS 13+ · Apple Silicon + Intel`],
    ['Install the Mac app once to connect your local Codex and Claude Code accounts. After connection, this same page becomes the full web workspace with synchronized sessions, RCC routing, model selection, effort control, and evidence receipts.',
      'Work in the local OS-1 app with your own Codex and Claude Code accounts. OS-1 checks the models and reasoning levels available to your account before routing. This download is an unnotarized beta, not an Apple-notarized release. Open the ZIP and follow README.txt; the installer verifies the package before requesting your Mac administrator password. Per-device account logins and native permission approvals remain required.'],
    ['<span>Install once, continue on web</span>', '<span>Install the beta · work in the OS-1 app</span>'],
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
