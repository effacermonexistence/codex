// Explicit local cache migration. No auth caches, system state, or originals
// are moved; no production backup/restore is executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source = fs.realpathSync(process.argv[2]);
const report = JSON.parse(fs.readFileSync(path.join(source, 'verification-report.json')));
if (report.bucket !== 'omar-private-archive' || !['all_git_bundles_verified','all_objects_present','all_sha256_recorded','all_sizes_match'].every(k => report[k] === true)) throw Error('Unverified mirror');
const root = path.join(os.homedir(), 'Library/Application Support/OS-1/r2-mirrors');
fs.mkdirSync(root, {recursive:true, mode:0o700});
const destination = path.join(root, path.basename(source));
if (fs.existsSync(destination)) throw Error('Mirror already exists; do not overwrite');
const staging = fs.mkdtempSync(path.join(root, '.import-'));
fs.chmodSync(staging, 0o700);
// APFS clone copies archive data cheaply, not the user's live credentials.
execFileSync('/bin/cp', ['-cR', path.join(source, 'repos'), path.join(staging, 'repos')]);
fs.copyFileSync(path.join(source, 'verification-report.json'), path.join(staging, 'verification-report.json'));
fs.chmodSync(path.join(staging, 'verification-report.json'), 0o600);
for (const repo of fs.readdirSync(path.join(staging,'repos'))) {
  const original = path.join(source,'repos',repo), copied = path.join(staging,'repos',repo);
  const head = p => execFileSync('/usr/bin/git',['-C',p,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if (head(original) !== head(copied)) throw Error('Copied repository HEAD mismatch: '+repo);
}
fs.renameSync(staging, destination);
console.log(JSON.stringify({destination, capturedAt:report.captured_at, originalsPreserved:true, authCopied:false}));
