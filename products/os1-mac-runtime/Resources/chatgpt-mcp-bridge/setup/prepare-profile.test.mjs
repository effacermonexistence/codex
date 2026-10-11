import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPreparation} from './prepare-profile.mjs';
test('preparation uses official stdio transport, file reference, loopback ephemeral admin listener',()=>{
 const p=buildPreparation('tunnel_0123456789abcdef','/Users/fixture');
 assert.ok(p.args.includes('file:/Users/fixture/.os1/chatgpt-mcp-transport/control-plane.key'));
 assert.ok(p.args.includes('127.0.0.1:0'));assert.ok(!p.args.includes('--force'));
 assert.ok(!p.args.includes('--open-web-ui'));assert.ok(!p.args.includes('run'));
 assert.match(p.args[p.args.indexOf('--mcp-command')+1],/server\.mjs/);
});
test('no placeholder, URI, path or shell expression accepted as tunnel ID',()=>{
 for(const x of [undefined,'','REAL_TUNNEL_ID','tunnel_x','../tunnel_12345678','tunnel_12345678;echo','https://example.com'])
  assert.throws(()=>buildPreparation(x,'/Users/fixture'));
});
test('command paths with spaces and quotes stay single shell words',()=>{
 const p=buildPreparation('tunnel_0123456789abcdef',"/Users/a b'c");
 assert.ok(p.args[p.args.indexOf('--mcp-command')+1].includes("'\\''"));
 assert.equal(p.args.filter(x=>x==='--mcp-command').length,1);
});
test('invalid home cannot enter command',()=>{
 for(const x of [undefined,'relative','/Users/x\nnew','/Users/x\0'])assert.throws(()=>buildPreparation('tunnel_0123456789abcdef',x));
});
