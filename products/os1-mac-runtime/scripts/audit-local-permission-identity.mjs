// Read-only audit of this application's macOS privacy identity. Never alters
// TCC databases, trust roots, other applications or privacy approvals.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const app = resolve(process.argv[2]);
const out = mkdtempSync(join(tmpdir(), 'os1-privacy-identity-'));
const audit = [];
for (const db of [join(homedir(), 'Library/Application Support/com.apple.TCC/TCC.db'), '/Library/Application Support/com.apple.TCC/TCC.db']) {
  const records = JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', db,
    "SELECT service,auth_value,hex(csreq) AS requirement FROM access WHERE client='com.omaragi.os1' AND service IN ('kTCCServiceSystemPolicyDocumentsFolder','kTCCServiceSystemPolicyAllFiles');"], { encoding: 'utf8' }) || '[]');
  for (const row of records) {
    const file = join(out, row.service + '.csreq');
    writeFileSync(file, Buffer.from(row.requirement, 'hex'), { mode: 0o600 });
    let matches = true;
    try { execFileSync('/usr/bin/codesign', ['--verify', '-R', file, app], { stdio: 'pipe' }); }
    catch { matches = false; }
    audit.push({ service: row.service, granted: row.auth_value === 2, installedIdentityMatches: matches, requirementFile: file });
  }
}
writeFileSync(join(out, 'audit.json'), JSON.stringify({ app, audit }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ out, audit }, null, 2));
