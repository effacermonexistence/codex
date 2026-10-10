// Diagnostics only: never allow or print a suspected secret. Only exact audited
// tokens are classified. Source-path diagnostics are not Swift type encodings.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const policy = JSON.parse(fs.readFileSync(new URL('../security/client-artifact-scan-policy.json', import.meta.url), 'utf8'));
const auditedPublicTokens = new Map();
for (const [fingerprint, provenance] of Object.entries(policy.publicTokenProvenance)) {
  if (typeof provenance.publicToken !== 'string') continue;
  if (createHash('sha256').update(provenance.publicToken).digest('hex') !== fingerprint ||
      !policy.entropy.allowedTokenSha256.includes(fingerprint)) {
    throw new Error('Invalid exact audited-token provenance');
  }
  if (provenance.tokenKind === 'compiler_type') {
    if (!/^_TtC(?:[CVFO])?\d/.test(provenance.publicToken)) {
      throw new Error('Invalid audited compiler-token kind');
    }
  } else if (provenance.tokenKind === 'diagnostic_source_path') {
    if (!/^[a-f0-9]{40}$/.test(provenance.sourceRevision ?? '') ||
        !/^[a-f0-9]{64}$/.test(provenance.sourceSHA256 ?? '') ||
        !/^products\/os1-mac-runtime\/Sources\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.swift$/.test(provenance.source ?? '') ||
        provenance.sourceURL !== `https://github.com/effacermonexistence/codex/blob/${provenance.sourceRevision}/${provenance.source}` ||
        !provenance.publicToken.startsWith('/') ||
        !provenance.publicToken.endsWith('/' + provenance.source.slice(0, -6)) ||
        provenance.publicToken.includes('/../') || provenance.publicToken.includes('/./')) {
      throw new Error('Invalid exact public-source-path provenance');
    }
  } else {
    throw new Error('Unsupported audited-token kind');
  }
  auditedPublicTokens.set(fingerprint, provenance);
}
const found = new Set();
for(const text of fs.readFileSync(process.argv[2]).toString('latin1').match(/[\x20-\x7e]{48,}/g)??[]) {
  for(const token of text.match(/[A-Za-z0-9_+/=-]{48,}/g)??[]) {
    const hash=createHash('sha256').update(token).digest('hex');
    const provenance = auditedPublicTokens.get(hash);
    if(!provenance||token!==provenance.publicToken||found.has(hash))continue; found.add(hash);
    if (provenance.tokenKind === 'diagnostic_source_path') {
      console.log(JSON.stringify({fingerprint:hash,length:token.length,
        tokenKind:provenance.tokenKind,publicCompilerType:null,source:provenance.source}));
      continue;
    }
    const result=spawnSync('xcrun',['swift-demangle','--compact',token],{encoding:'utf8',timeout:10000});
    const decoded=result.stdout?.trim();
    const recognized=result.status===0&&decoded&&decoded!==token&&!decoded.includes('\n')&&
      (!provenance.demangledPublicType||decoded===provenance.demangledPublicType);
    console.log(JSON.stringify({fingerprint:hash,length:token.length,
      tokenKind:provenance.tokenKind,publicCompilerType:recognized?decoded:null,source:provenance.source}));
  }
}
