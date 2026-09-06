import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PIN, assetURL, stableSupportsFleet, verifyRelease, verifyBytes, verifyInnerManifest } from './bootstrap-os1-release.mjs';

test('stable compatibility never mistakes an old or unversioned build for Fleet',()=>{
  for(const m of [{version:'0.9.1'},{version:'0.9.20'},{version:'0.9.21'},{version:'0.9.21',build:'69'}])assert.equal(stableSupportsFleet(m),false);
  for(const m of [{version:'0.9.21',build:'70'},{version:'0.9.22'},{version:'0.10.0'},{version:'1.0.0'}])assert.equal(stableSupportsFleet(m),true);
  for(const m of [null,{}, {version:'latest'}, {version:'0.9.21-beta.4'}])assert.throws(()=>stableSupportsFleet(m));
});
test('release identity is pinned independently of a mutable download URL',()=>{
  const release={tag_name:PIN.tag,draft:false,prerelease:true,target_commitish:PIN.commit,
    assets:[{name:PIN.zip,browser_download_url:assetURL,digest:'sha256:'+PIN.zipSHA}]};
  const reference={ref:'refs/tags/'+PIN.tag,object:{type:'commit',sha:PIN.commit}};
  verifyRelease(release,reference);
  for(const change of [{tag_name:'latest'},{draft:true},{prerelease:false},{target_commitish:'main'},
    {assets:[]},{assets:[{name:PIN.zip,browser_download_url:'https://example.com/download'}]}])assert.throws(()=>verifyRelease({...release,...change},reference));
  assert.throws(()=>verifyRelease(release,{...reference,object:{type:'commit',sha:'0'.repeat(40)}}));
});
test('tampered download bytes and inner manifest are rejected before installer calls',()=>{
  const original=Buffer.from('fixture');const sha=createHash('sha256').update(original).digest('hex');
  verifyBytes(original,sha);assert.throws(()=>verifyBytes(Buffer.from('tampered'),sha));
  const manifest={version:PIN.version,size:PIN.pkgSize,sha256:PIN.pkgSHA,minimum_macos:'13.0',object_key:`os1/releases/${PIN.version}/OS-1-${PIN.version}.pkg`};
  assert.throws(()=>verifyInnerManifest(manifest,Buffer.alloc(PIN.pkgSize)));
  assert.throws(()=>verifyInnerManifest({...manifest,version:'0.9.1'},Buffer.alloc(1)));
  assert.throws(()=>verifyInnerManifest({...manifest,sha256:'0'.repeat(64)},Buffer.alloc(1)));
});
