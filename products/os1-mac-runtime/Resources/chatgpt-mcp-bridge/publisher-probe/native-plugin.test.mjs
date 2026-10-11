import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('./native-plugin/',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'.codex-plugin/plugin.json'),'utf8'));
const mapping=JSON.parse(readFileSync(join(root,'.app.json'),'utf8'));

test('installed alpha-version native path uses only the supported legacy registered-app package',()=>{
  assert.equal(existsSync(join(root,'plugin.json')),false);
  assert.equal(existsSync(join(root,'mcp.json')),false);
  assert.equal(existsSync(join(root,'.mcp.json')),false);
  assert.equal(manifest.apps,'./.app.json');
  assert.equal(manifest.name,'os1-native-chat-probe');
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
});

test('native package declares one genuine registered identifier and no parallel direct MCP binding',()=>{
  const entries=Object.entries(mapping.apps);
  assert.equal(entries.length,1);
  assert.equal(entries[0][0],'os1_native_chat_probe');
  assert.match(entries[0][1].id,/^plugin_asdk_app_[0-9a-f]{31,32}$/);
  assert.deepEqual(Object.keys(entries[0][1]),['id']);
  assert.equal(manifest.mcpServers,undefined);
});

test('diagnostic package grants no hooks, credentials, model configuration or private task capability',()=>{
  assert.deepEqual(readdirSync(root).sort(),['.app.json','.codex-plugin']);
  assert.deepEqual(readdirSync(join(root,'.codex-plugin')),['plugin.json']);
  for(const field of ['hooks','skills','agents','commands','model','apiKey','auth']){
    assert.equal(manifest[field],undefined);
  }
  const content=JSON.stringify({manifest,mapping});
  assert.doesNotMatch(content,/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|PROBE_OPERATOR_KEY/);
  assert.match(manifest.description,/fixed synthetic/i);
  assert.match(manifest.description,/no customer tasks or verified quota claim/i);
});
