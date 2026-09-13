#!/usr/bin/env node
// Explicit bootstrap-only beta fallback. Never changes the stable release channel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PIN = Object.freeze({
  tag: 'os1-v0.9.48-beta.1', version: '0.9.48', build: '105',
  commit: '4828aa1f07ed16a5c4f3a2935b897753276a3815',
  zip: 'OS-1-0.9.48-macOS-beta.zip',
  zipSHA: 'a9b798a10543314d56579a8810ac6561809f7080bcf170089287ac84e3d72fc5',
  pkgSHA: 'a714576257c64f937e0fe2030817d614e2515b0cc7ee6d4c9e72948e8b94341e',
  pkgSize: 18628409,
});
const repository = 'effacermonexistence/codex';
const api = 'https://api.github.com/repos/' + repository;
export const assetURL = `https://github.com/${repository}/releases/download/${PIN.tag}/${PIN.zip}`;
const gateway = 'https://os1-route-gateway.omar-git-r2-backup.workers.dev';
const installer = fileURLToPath(new URL('../products/os1-mac-runtime/scripts/install-os1.sh', import.meta.url));

export function stableSupportsCurrentRuntime(manifest) {
  assert(manifest && /^\d+\.\d+\.\d+$/.test(manifest.version), 'Invalid stable release version');
  const v=manifest.version.split('.').map(Number), min=PIN.version.split('.').map(Number);
  for(let i=0;i<3;i++) { if(v[i]!==min[i]) return v[i]>min[i]; }
  // Require the same verified build at the floor; an absent build is unknown.
  return /^\d+$/.test(String(manifest.build)) && Number(manifest.build)>=Number(PIN.build);
}
export function verifyRelease(release, reference) {
  assert.equal(release.tag_name,PIN.tag);assert.equal(release.draft,false);assert.equal(release.prerelease,true);
  assert.equal(release.target_commitish,PIN.commit);
  assert.equal(reference.ref,'refs/tags/'+PIN.tag);assert.equal(reference.object?.type,'commit');assert.equal(reference.object.sha,PIN.commit);
  const asset=release.assets?.find(a=>a.name===PIN.zip);assert(asset,'Pinned asset missing');
  assert.equal(asset.browser_download_url,assetURL);
  if(asset.digest) assert.equal(asset.digest,'sha256:'+PIN.zipSHA);
}
export function verifyBytes(bytes, expected) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,'Pinned release hash mismatch');
}
export function verifyInnerManifest(m, bytes) {
  assert.equal(m.version,PIN.version);assert.equal(m.size,PIN.pkgSize);assert.equal(bytes.length,PIN.pkgSize);
  assert.equal(m.sha256,PIN.pkgSHA);assert.equal(m.minimum_macos,'13.0');
  assert.equal(m.object_key,`os1/releases/${PIN.version}/OS-1-${PIN.version}.pkg`);
  verifyBytes(bytes,PIN.pkgSHA);
}
export function requestHeaders(url,token) {
  const metadata=url.startsWith(api+'/');
  return {'user-agent':'OS1-verified-bootstrap/1','accept':metadata?'application/vnd.github+json':'*/*',
    ...(metadata&&token?{authorization:'Bearer '+token}:{})};
}
export const downloadTimeout = maxBytes => maxBytes > 2_000_000 ? 300000 : 60000;
async function download(url,maxBytes) {
  const response=await fetch(url,{signal:AbortSignal.timeout(downloadTimeout(maxBytes)),headers:requestHeaders(url,process.env.GH_TOKEN??process.env.GITHUB_TOKEN)});
  assert(response.ok,`Download failed: HTTP ${response.status} from ${new URL(url).hostname}`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;assert(size<=maxBytes,'Download too large');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const json=async url=>JSON.parse(await download(url,2_000_000));
function run(command,args,options={}) {
  return execFileSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:4_000_000,...options});
}
export async function preparePinnedBeta(directory) {
  const [release,reference]=await Promise.all([json(api+'/releases/tags/'+PIN.tag),json(api+'/git/ref/tags/'+PIN.tag)]);
  verifyRelease(release,reference);
  const zip=await download(assetURL,25_000_000);verifyBytes(zip,PIN.zipSHA);
  const zipPath=path.join(directory,'release.zip');fs.writeFileSync(zipPath,zip,{mode:0o600});
  const entries=run('/usr/bin/unzip',['-Z','-1',zipPath]).trim().split('\n');
  assert(entries.every(e=>!e.startsWith('/')&&!e.split('/').includes('..')),'Unsafe archive path');
  run('/usr/bin/ditto',['-x','-k',zipPath,directory]);
  const bundle=path.join(directory,'OS-1-'+PIN.version+'-macOS-beta');
  const packagePath=path.join(bundle,'OS-1.pkg'),manifestPath=path.join(bundle,'latest.json');
  for(const file of [packagePath,manifestPath])assert(fs.lstatSync(file).isFile(),'Invalid bundle file');
  verifyInnerManifest(JSON.parse(fs.readFileSync(manifestPath)),fs.readFileSync(packagePath));
  const expanded=path.join(directory,'expanded');run('/usr/sbin/pkgutil',['--expand-full',packagePath,expanded]);
  const app=path.join(expanded,'OS-1-component.pkg/Payload/Applications/OS-1 CLODEX.app');
  assert.equal(run('/usr/bin/plutil',['-extract','CFBundleVersion','raw',path.join(app,'Contents/Info.plist')]).trim(),PIN.build);
  // The trusted installer additionally validates the complete payload allowlist,
  // architectures and code signatures before it can call sudo installer.
  return {packagePath,manifestPath};
}
async function main() {
  assert(process.argv.slice(2).every(a=>a==='--verify-only'),'Unknown bootstrap release argument');
  const verifyOnly=process.argv.includes('--verify-only');
  const stable=await json(gateway+'/v1/releases/latest');
  if(stableSupportsCurrentRuntime(stable)) {
    console.log('OS1 bootstrap: compatible stable release '+stable.version);
    run('/bin/bash',[installer],{stdio:'inherit',timeout:0,env:{...process.env,OS1_REQUIRE_FLEET_RELEASE:'1',OS1_REQUIRE_ACCOUNT_MODELS_RELEASE:'1',OS1_MINIMUM_RELEASE_VERSION:PIN.version,OS1_MINIMUM_RELEASE_BUILD:PIN.build,...(verifyOnly?{OS1_VERIFY_ONLY:'1',OS1_SKIP_PREREQUISITES:'1',OS1_SKIP_LOGIN:'1'}:{})}});
    return;
  }
  console.error(`OS1 bootstrap: stable ${stable.version} is older than the required runtime. Using explicitly pinned ${PIN.tag}, build ${PIN.build}. WARNING: this beta is not Apple-notarized. No Gatekeeper/TCC settings are changed.`);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'os1-bootstrap-beta-'));fs.chmodSync(directory,0o700);
  try {
    const prepared=await preparePinnedBeta(directory);
    run('/bin/bash',[installer],{stdio:'inherit',timeout:0,env:{...process.env,
      OS1_ALLOW_UNNOTARIZED_BETA:'1',OS1_REQUIRE_FLEET_RELEASE:'0',OS1_BETA_PACKAGE_PATH:prepared.packagePath,OS1_BETA_MANIFEST_PATH:prepared.manifestPath,
      ...(verifyOnly?{OS1_VERIFY_ONLY:'1',OS1_SKIP_PREREQUISITES:'1',OS1_SKIP_LOGIN:'1'}:{})}});
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch(error=>{console.error('OS1 bootstrap release rejected:',error.message);process.exitCode=1;});
}
