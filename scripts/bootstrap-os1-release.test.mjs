import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIN, assetURL, requestHeaders, stableSupportsCurrentRuntime, verifyRelease, verifyBytes, verifyInnerManifest } from './bootstrap-os1-release.mjs';
import { updateDownloadPage } from './update-os1-download-page.mjs';

test('CI metadata authentication is never forwarded to assets or other hosts',()=>{
  assert.equal(requestHeaders('https://api.github.com/repos/effacermonexistence/codex/releases/tags/'+PIN.tag,'fixture').authorization,'Bearer fixture');
  for(const url of [assetURL,'https://example.com','https://api.github.com.evil.test/repos/effacermonexistence/codex/releases', 'https://api.github.com/repos/other/repository/releases'])assert.equal(requestHeaders(url,'fixture').authorization,undefined);
});

test('bootstrap requires the pinned runtime and known matching build, not merely Fleet support',()=>{
  for(const m of [{version:'0.9.1'},{version:'0.9.21',build:'70'},{version:'0.9.43'},
    {version:PIN.version},{version:PIN.version,build:String(Number(PIN.build)-1)},{version:PIN.version,build:'invalid'}])assert.equal(stableSupportsCurrentRuntime(m),false);
  for(const m of [{version:PIN.version,build:PIN.build},{version:'0.10.0'},{version:'1.0.0'}])assert.equal(stableSupportsCurrentRuntime(m),true);
  for(const m of [null,{}, {version:'latest'}, {version:'0.9.44-beta.1'}])assert.throws(()=>stableSupportsCurrentRuntime(m));
});

test('installer rechecks selected minimum runtime before any package execution',
  {skip:process.platform!=='darwin'},()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'os1-selected-floor-test-'));
    const packagePath=path.join(directory,'fixture.pkg'),manifestPath=path.join(directory,'manifest.json');
    const installer=fileURLToPath(new URL('../products/os1-mac-runtime/scripts/install-os1.sh',import.meta.url));
    fs.writeFileSync(packagePath,'x');
    try {
      for(const candidate of [{version:'0.9.44',build:'95'},{version:'0.9.47',build:'104'},
        {version:'0.9.48'},{version:'0.9.48',build:'104'},{version:'0.9.48',build:'invalid'}]) {
        fs.writeFileSync(manifestPath,JSON.stringify({...candidate,size:1,sha256:'0'.repeat(64),
          minimum_macos:'13.0',object_key:`os1/releases/${candidate.version}/OS-1-${candidate.version}.pkg`}));
        const result=spawnSync('/bin/bash',[installer],{encoding:'utf8',timeout:10000,
          env:{...process.env,OS1_ALLOW_UNNOTARIZED_BETA:'1',OS1_BETA_PACKAGE_PATH:packagePath,
            OS1_BETA_MANIFEST_PATH:manifestPath,OS1_MINIMUM_RELEASE_VERSION:'0.9.48',OS1_MINIMUM_RELEASE_BUILD:'105',
            OS1_VERIFY_ONLY:'1',OS1_SKIP_LOGIN:'1',OS1_SKIP_PREREQUISITES:'1'}});
        assert.equal(result.status,1,JSON.stringify(candidate));
        assert.match(result.stderr,/older than the selected runtime/);
        assert.doesNotMatch(result.stdout,/Verified OS-1 beta|installation was not performed/);
      }
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
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

test('landing-page patch refuses an unreviewed source without producing a replacement',()=>{
  assert.throws(()=>updateDownloadPage('<html>changed website</html>'), /Landing page changed/);
});

test('new-Mac Claude install merges full-access defaults without deleting existing settings',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'os1-claude-settings-test-'));
  const templatePath=path.join(directory,'template.json');
  const destinationPath=path.join(directory,'settings.json');
  const installer=fileURLToPath(new URL('./install-claude-remote-backup-hook.mjs',import.meta.url));
  try {
    fs.writeFileSync(templatePath,JSON.stringify({
      permissions:{defaultMode:'bypassPermissions'},
      sandbox:{enabled:true,allowUnsandboxedCommands:true},
      skipDangerousModePermissionPrompt:true,
      hooks:{SessionStart:[{hooks:[{type:'command',command:'node "$HOME/.claude/hooks/remote-backup-guard.mjs"'}]}],
        Stop:[{hooks:[{type:'command',command:'node "$HOME/.claude/hooks/remote-backup-guard.mjs"'}]}],
        SessionEnd:[{hooks:[{type:'command',command:'node "$HOME/.claude/hooks/remote-backup-guard.mjs"'}]}]},
    }));
    fs.writeFileSync(destinationPath,JSON.stringify({theme:'dark',permissions:{allow:['Bash(git status)']},
      sandbox:{filesystem:{allowWrite:['/tmp/build']}},hooks:{UserPromptSubmit:[{hooks:[{type:'command',command:'existing-hook'}]}]}}));
    const result=spawnSync(process.execPath,[installer,templatePath,destinationPath],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    const installed=JSON.parse(fs.readFileSync(destinationPath,'utf8'));
    assert.equal(installed.theme,'dark');
    assert.deepEqual(installed.permissions.allow,['Bash(git status)']);
    assert.equal(installed.permissions.defaultMode,'bypassPermissions');
    assert.deepEqual(installed.sandbox.filesystem,{allowWrite:['/tmp/build']});
    assert.equal(installed.sandbox.enabled,true);
    assert.equal(installed.sandbox.allowUnsandboxedCommands,true);
    assert.equal(installed.skipDangerousModePermissionPrompt,true);
    assert.equal(installed.hooks.UserPromptSubmit[0].hooks[0].command,'existing-hook');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('installer independently rejects a downgraded stable pointer before package execution',
  { skip: process.platform !== 'darwin' }, ()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'os1-bootstrap-floor-test-'));
    const packagePath=path.join(directory,'fixture.pkg'), manifestPath=path.join(directory,'manifest.json');
    fs.writeFileSync(packagePath,'x'); // Deliberately not an executable installer.
    const installer=fileURLToPath(new URL('../products/os1-mac-runtime/scripts/install-os1.sh',import.meta.url));
    try {
      for(const candidate of [{version:'0.9.1'},{version:'0.9.21'},{version:'0.9.43'},
        {version:'0.9.44',build:'94'},{version:'0.9.44',build:'invalid'}]) {
        fs.writeFileSync(manifestPath,JSON.stringify({...candidate,size:1,sha256:'0'.repeat(64),
          minimum_macos:'13.0',object_key:`os1/releases/${candidate.version}/OS-1-${candidate.version}.pkg`}));
        const result=spawnSync('/bin/bash',[installer],{encoding:'utf8',timeout:10000,
          env:{...process.env,OS1_ALLOW_UNNOTARIZED_BETA:'1',OS1_BETA_PACKAGE_PATH:packagePath,
            OS1_BETA_MANIFEST_PATH:manifestPath,OS1_REQUIRE_ACCOUNT_MODELS_RELEASE:'1',
            OS1_VERIFY_ONLY:'1',OS1_SKIP_LOGIN:'1',OS1_SKIP_PREREQUISITES:'1'}});
        assert.equal(result.status,1,JSON.stringify(candidate));
        assert.match(result.stderr,/lacks account-aware model selection|incompatible build/);
        assert.doesNotMatch(result.stdout,/installation was not performed|Verified OS-1 beta/);
      }
    } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  });
