// Diagnostics only: never allow or print a suspected secret. Recognized Swift
// compiler type encodings may be demangled to public declaration names.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const policy = JSON.parse(fs.readFileSync(new URL('../security/client-artifact-scan-policy.json', import.meta.url), 'utf8'));
const auditedCompilerTokens = new Map();
for (const [fingerprint, provenance] of Object.entries(policy.publicTokenProvenance)) {
  if (typeof provenance.publicToken !== 'string') continue;
  if (!/^_TtC[V]?/.test(provenance.publicToken) ||
      createHash('sha256').update(provenance.publicToken).digest('hex') !== fingerprint ||
      !policy.entropy.allowedTokenSha256.includes(fingerprint)) {
    throw new Error('Invalid audited compiler-token provenance');
  }
  auditedCompilerTokens.set(fingerprint, provenance);
}
const found = new Set();
for(const text of fs.readFileSync(process.argv[2]).toString('latin1').match(/[\x20-\x7e]{48,}/g)??[]) {
  for(const token of text.match(/[A-Za-z0-9_+/=-]{48,}/g)??[]) {
    const hash=createHash('sha256').update(token).digest('hex');
    const provenance = auditedCompilerTokens.get(hash);
    if(!provenance||token!==provenance.publicToken||found.has(hash))continue; found.add(hash);
    const result=spawnSync('xcrun',['swift-demangle','--compact',token],{encoding:'utf8',timeout:10000});
    const decoded=result.stdout?.trim();
    const recognized=result.status===0&&decoded&&decoded!==token&&!decoded.includes('\n')&&
      (!provenance.demangledPublicType||decoded===provenance.demangledPublicType);
    console.log(JSON.stringify({fingerprint:hash,length:token.length,
      publicCompilerType:recognized?decoded:null,source:provenance.source}));
  }
}
