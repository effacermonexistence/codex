import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  NativeChatProbe,
  createProbeWorker,
  PROBE_PROMPT,
  RESOURCE_URI,
  BODY_TIMEOUT_MS,
  RATE_LIMIT,
} from './worker.mjs';

// These are isolated fixtures, not native-Chat-host proof or merge authorization.
const OPERATOR_KEY = 'synthetic-test-operator-key-not-a-secret-000000000000';
const ORIGIN = 'https://isolated-probe.invalid';
const APP_HTML = '<!doctype html><html><body>Fixed synthetic probe</body></html>';
const START_TIME = 1_800_000_000_000;
const TTL_MS = 10 * 60 * 1000;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeStorage(map = new Map()) {
  let transactionTail = Promise.resolve();
  const storage = {
    async get(key) {
      if (Array.isArray(key)) {
        return new Map(key.filter((item) => map.has(item)).map((item) => [item, clone(map.get(item))]));
      }
      return clone(map.get(key));
    },
    async put(key, value) {
      if (typeof key === 'string') map.set(key, clone(value));
      else for (const [name, item] of Object.entries(key)) map.set(name, clone(item));
    },
    async transaction(callback) {
      const pending = transactionTail.then(() => callback(storage));
      transactionTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
  return { map, storage };
}

function fixture({ map, key = OPERATOR_KEY, operatorKeyPresent = true, instanceID, now = START_TIME } = {}) {
  const backing = makeStorage(map);
  const clock = { now };
  const names = [];
  const env = {};
  if (operatorKeyPresent) env.PROBE_OPERATOR_KEY = key;
  if (instanceID !== undefined) env.PROBE_INSTANCE_ID = instanceID;
  const expectedInstance = instanceID ?? 'os1-native-chat-probe-20261011a';
  let durable;
  env.NATIVE_PROBE = {
    idFromName(name) {
      names.push(name);
      assert.equal(name, expectedInstance, 'only the operator-configured dedicated mailbox may be addressed');
      return name;
    },
    get(id) {
      assert.equal(id, expectedInstance);
      return { fetch: (request) => durable.fetch(request) };
    },
  };
  const restart = () => {
    durable = new NativeChatProbe({ storage: backing.storage }, env, { now: () => clock.now });
  };
  restart();
  const worker = createProbeWorker({ appHTML: APP_HTML });
  let nextID = 1;

  async function request(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
    const requestHeaders = new Headers(headers);
    if (auth === true) requestHeaders.set('authorization', `Bearer ${OPERATOR_KEY}`);
    else if (typeof auth === 'string') requestHeaders.set('authorization', auth);
    let requestBody;
    if (body !== undefined) {
      if (typeof body === 'string' || body instanceof ReadableStream || body instanceof Uint8Array) requestBody = body;
      else {
        requestBody = JSON.stringify(body);
        requestHeaders.set('content-type', 'application/json');
      }
    }
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, {
      method,
      headers: requestHeaders,
      ...(requestBody === undefined ? {} : { body: requestBody }),
      ...(requestBody instanceof ReadableStream ? { duplex: 'half' } : {}),
    }), env);
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* inspect non-JSON rejection bodies as text */ }
    return { status: response.status, headers: response.headers, text, json };
  }

  async function rpc(method, params = {}, { notification = false, ...options } = {}) {
    return request('/mcp', {
      method: 'POST',
      body: { jsonrpc: '2.0', ...(notification ? {} : { id: nextID++ }), method, params },
      ...options,
    });
  }
  const tool = (name, args = {}, options) => rpc('tools/call', { name, arguments: args }, options);
  const start = (body = {}) => request('/ops/start', { method: 'POST', body, auth: true });
  const cancel = (body = {}) => request('/ops/cancel', { method: 'POST', body, auth: true });
  const result = () => request('/ops/result', { auth: true });
  // Security-rate bookkeeping is separate from probe execution/adoption state.
  const snapshot = () => clone([...backing.map].filter(([name]) => name !== 'rate'));
  return { ...backing, clock, names, request, rpc, tool, start, cancel, result, restart, snapshot };
}

function assertHTTPRejected(reply, status) {
  assert.ok(reply.status >= 400 && reply.status < 600, `expected HTTP rejection, got ${reply.status}: ${reply.text}`);
  if (status !== undefined) assert.equal(reply.status, status);
}

function assertToolOK(reply) {
  assert.equal(reply.status, 200, reply.text);
  assert.ok(reply.json && !reply.json.error, reply.text);
  assert.equal(reply.json.result?.isError === true, false, reply.text);
  return reply.json.result;
}

function assertToolRejected(reply) {
  if (reply.status >= 400) return;
  assert.equal(reply.status, 200, reply.text);
  assert.ok(reply.json?.error || reply.json?.result?.isError === true, `expected tool/RPC rejection: ${reply.text}`);
}

function bridge(reply) {
  const result = assertToolOK(reply);
  assert.ok(result._meta?.bridge, `missing app-only bridge metadata: ${reply.text}`);
  return result._meta.bridge;
}

function assertNoCapabilities(reply, offer) {
  assert.equal(reply.text.includes(OPERATOR_KEY), false, 'operator key must not appear in any response');
  if (offer) {
    assert.equal(reply.text.includes(offer.return_token), false, 'return capability must not appear on this surface');
    assert.equal(reply.text.includes(offer.dispatch_token), false, 'dispatch capability must not appear on this surface');
  }
}

function callback(offer, overrides = {}) {
  return {
    request_id: offer.request_id,
    request_sha256: offer.request_sha256,
    return_token: offer.return_token,
    output: '2',
    ...overrides,
  };
}

function acknowledgement(offer, overrides = {}) {
  return { request_id: offer.request_id, dispatch_token: offer.dispatch_token, ...overrides };
}

async function activeOffer(f) {
  const started = await f.start();
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.state, 'queued');
  return bridge(await f.tool('os1_probe_next')).request;
}

function assertOffer(offer) {
  assert.ok(offer && typeof offer === 'object');
  assert.deepEqual(Object.keys(offer).sort(), [
    'created_at_ms', 'dispatch_token', 'expires_at_ms', 'prompt',
    'request_id', 'request_sha256', 'return_token',
  ].sort());
  assert.equal(offer.prompt, '1+1');
  assert.equal(offer.prompt, PROBE_PROMPT);
  assert.match(offer.request_id, /^[A-Za-z0-9_-]{16,}$/);
  assert.match(offer.request_sha256, /^[a-f0-9]{64}$/);
  assert.equal(offer.request_sha256, createHash('sha256').update(PROBE_PROMPT).digest('hex'));
  for (const token of [offer.return_token, offer.dispatch_token]) {
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 43 && token.length <= 128, 'capability must represent at least 32 random bytes');
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  }
  assert.notEqual(offer.return_token, offer.dispatch_token);
  assert.equal(offer.created_at_ms, START_TIME);
  assert.equal(offer.expires_at_ms, START_TIME + TTL_MS);
}

test('exported prompt/resource are the fixed synthetic fixture', () => {
  assert.equal(PROBE_PROMPT, '1+1');
  assert.equal(RESOURCE_URI, 'ui://os1/native-chat-probe');
});

test('public health does not mutate probe state or claim native/auth/accounting proof', async () => {
  const f = fixture();
  const before = f.snapshot();
  const reply = await f.request('/health');
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.json.state, 'probe_only');
  assert.equal(reply.json.active_state, 'idle');
  assert.equal(reply.json.native_host_verified, false);
  assert.equal(reply.json.host_authentication_verified, false);
  assert.equal(reply.json.usage_accounting_verified, false);
  assert.equal(reply.json.production_available, false);
  assert.equal(reply.json.counts.starts, 0);
  assert.equal(reply.json.counts.offers, 0);
  assertNoCapabilities(reply);
  assert.deepEqual(f.snapshot(), before);
});

test('private operations require the exact operator Bearer credential', async () => {
  const f = fixture();
  for (const [path, method, body] of [
    ['/ops/start', 'POST', {}], ['/ops/cancel', 'POST', {}], ['/ops/result', 'GET', undefined],
  ]) {
    for (const auth of [false, 'Bearer incorrect', 'Basic synthetic', `Bearer ${OPERATOR_KEY}extra`]) {
      const reply = await f.request(path, { method, body, auth });
      assertHTTPRejected(reply, 401);
      assertNoCapabilities(reply);
    }
  }
  assert.equal((await f.result()).status, 200);
  assert.equal(f.snapshot().length, 0, 'unauthorized writes must not create mailbox state');
});

test('missing or undersized configured operator key fails closed', async () => {
  for (const options of [{ operatorKeyPresent: false }, { key: '' }, { key: 'short-key' }]) {
    const f = fixture(options);
    assertHTTPRejected(await f.start());
    assertHTTPRejected(await f.cancel());
    assertHTTPRejected(await f.result());
    assert.equal(f.snapshot().length, 0);
  }
});

test('only documented routes and methods exist; no production/queue/file interface', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const path of [
    '/ops/enqueue', '/ops/dispatch', '/enqueue', '/return', '/cancel', '/api/probe',
    '/oauth', '/oauth/token', '/files', '/v1/chat/completions', '/scv', '/r2', '/production',
  ]) {
    assertHTTPRejected(await f.request(path, { method: 'POST', body: { prompt: 'arbitrary' }, auth: true }));
  }
  for (const [path, method] of [
    ['/ops/start', 'GET'], ['/ops/cancel', 'GET'], ['/ops/result', 'POST'],
    ['/health', 'POST'], ['/mcp', 'GET'],
  ]) {
    assertHTTPRejected(await f.request(path, { method, ...(method === 'POST' ? { body: {} } : {}), auth: true }));
  }
  assert.deepEqual(f.snapshot(), before);
});

test('initialize/ping and tool inventory expose only fixed probe tools', async () => {
  const f = fixture();
  const initialized = await f.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-test', version: '1' },
  });
  assert.equal(initialized.status, 200, initialized.text);
  assert.ok(initialized.json.result?.serverInfo);
  assertToolOK(await f.rpc('ping'));
  const listed = assertToolOK(await f.rpc('tools/list'));
  const names = listed.tools.map((item) => item.name).sort();
  assert.deepEqual(names, ['os1_probe_dispatched', 'os1_probe_next', 'os1_probe_open', 'os1_probe_return'].sort());
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const next = listed.tools.find((item) => item.name === 'os1_probe_next');
  assert.deepEqual(next._meta?.ui?.visibility, ['app']);
  const dispatched = listed.tools.find((item) => item.name === 'os1_probe_dispatched');
  assert.deepEqual(dispatched._meta?.ui?.visibility, ['app']);
  assertNoCapabilities(initialized);
  assert.equal(f.snapshot().length, 0);
});

test('the sole resource is fixed HTML; arbitrary resource/file reads reject', async () => {
  const f = fixture();
  const listed = assertToolOK(await f.rpc('resources/list'));
  assert.equal(listed.resources.length, 1);
  assert.equal(listed.resources[0].uri, RESOURCE_URI);
  assert.equal(listed.resources[0].mimeType, 'text/html;profile=mcp-app');
  const read = assertToolOK(await f.rpc('resources/read', { uri: RESOURCE_URI }));
  assert.equal(read.contents.length, 1);
  assert.equal(read.contents[0].uri, RESOURCE_URI);
  assert.equal(read.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.equal(read.contents[0].text, APP_HTML);
  assert.deepEqual(read.contents[0]._meta?.ui?.csp, { connectDomains: [], resourceDomains: [] });
  for (const uri of ['file:///etc/passwd', 'https://example.invalid/private', `${RESOURCE_URI}/extra`, 'ui://os1/other']) {
    assertToolRejected(await f.rpc('resources/read', { uri }));
  }
  assertToolRejected(await f.rpc('resources/read', { uri: RESOURCE_URI, filename: '/private/example' }));
  assert.equal(f.snapshot().length, 0);
});

test('native resource reads accept standard opaque request metadata without using or echoing it', async () => {
  const f = fixture();
  for (const _meta of [{progressToken:'synthetic-resource-read'},
    {progressToken:4, 'openai/session':'synthetic-do-not-echo', nested:{unused:true}}]) {
    const read = assertToolOK(await f.rpc('resources/read', {uri:RESOURCE_URI, _meta}));
    assert.equal(read.contents[0].text,APP_HTML);
    assert.equal(JSON.stringify(read).includes('synthetic-do-not-echo'),false);
  }
  assert.equal(f.snapshot().length,0);
});

test('request metadata cannot widen the resource allowlist or change execution state', async () => {
  const f=fixture();
  for (const _meta of [null,[],true,'invalid']) {
    assertToolRejected(await f.rpc('resources/read',{uri:RESOURCE_URI,_meta}));
  }
  assertToolRejected(await f.rpc('resources/read',{uri:'file:///private/source',_meta:{progressToken:1}}));
  assertToolRejected(await f.rpc('resources/read',{uri:RESOURCE_URI,_meta:{},filename:'/private/source'}));
  assert.equal(f.snapshot().length,0);
});

test('common request metadata is transported consistently and cannot become business authority',async()=>{
  const f=fixture();
  const _meta={progressToken:'opaque-synthetic',authorization:'synthetic-not-authority'};
  assertToolOK(await f.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'},_meta}));
  assertToolOK(await f.rpc('ping',{_meta}));
  assert.equal(assertToolOK(await f.rpc('tools/list',{_meta})).tools.length,4);
  assert.equal(assertToolOK(await f.rpc('resources/list',{_meta})).resources.length,1);
  assertToolOK(await f.rpc('tools/call',{name:'os1_probe_open',arguments:{},_meta}));
  assertToolRejected(await f.rpc('resources/read',{uri:RESOURCE_URI,filename:'/private/file',_meta}));
  assertToolRejected(await f.rpc('resources/read',{uri:RESOURCE_URI,_meta:{progressToken:true}}));
  assert.equal(f.snapshot().length,0);
});

test('open is metadata-only and never acquires or replays a capability', async () => {
  const f = fixture();
  const idleBefore = f.snapshot();
  const idleOpen = await f.tool('os1_probe_open');
  assertToolOK(idleOpen);
  assertNoCapabilities(idleOpen);
  assert.deepEqual(f.snapshot(), idleBefore);
  assert.equal(f.map.get('rate')?.count, 1, 'open may increment only the isolated abuse-rate ledger');
  assert.equal(f.map.has('probe'), false);
  assert.equal(f.map.has('counts'), false);
  await f.start();
  const queuedBefore = f.snapshot();
  assertToolOK(await f.tool('os1_probe_open'));
  assert.deepEqual(f.snapshot(), queuedBefore);
  const offer = bridge(await f.tool('os1_probe_next')).request;
  const offeredBefore = f.snapshot();
  const openedAgain = await f.tool('os1_probe_open');
  assertToolOK(openedAgain);
  assertNoCapabilities(openedAgain, offer);
  assert.deepEqual(f.snapshot(), offeredBefore);
});

test('a mailbox without an active run reports idle without an offer', async () => {
  const f = fixture();
  const next = bridge(await f.tool('os1_probe_next'));
  assert.equal(next.state, 'idle');
  assert.equal(next.request, undefined);
  assert.equal((await f.result()).json.state, 'idle');
  assert.equal(f.snapshot().length, 0);
});

test('JSON-RPC method notifications never create offers or mutate state', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  for (const [method, params] of [
    ['notifications/initialized', {}],
    ['ping', {}],
    ['tools/call', { name: 'os1_probe_next', arguments: {} }],
    ['tools/call', { name: 'os1_probe_return', arguments: { output: '2' } }],
  ]) {
    const reply = await f.rpc(method, params, { notification: true });
    assert.ok(reply.status === 202 || reply.status === 204 || reply.status >= 400, reply.text);
    assertNoCapabilities(reply);
    assert.deepEqual(f.snapshot(), before);
  }
  assertToolRejected(await f.rpc('prompts/get', { name: 'arbitrary' }));
  assert.deepEqual(f.snapshot(), before);
});

test('malformed, batched, oversized and invalid RPC envelopes reject before mutation', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  const bodies = [
    '{', 'null', '[]', '[{"jsonrpc":"2.0","id":1,"method":"tools/call"}]',
    JSON.stringify({ id: 1, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: [] }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: null }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', extra: true }),
  ];
  for (const body of bodies) {
    assertHTTPRejected(await f.request('/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json' } }), 400);
    assert.deepEqual(f.snapshot(), before);
  }
  const huge = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'os1_probe_next', arguments: { padding: 'x'.repeat(16 * 1024) },
  } });
  assertHTTPRejected(await f.request('/mcp', { method: 'POST', body: huge, headers: { 'content-type': 'application/json' } }), 413);
  assert.deepEqual(f.snapshot(), before);
});

test('start payload cannot set a prompt, file, request ID, expiry or production target', async () => {
  const f = fixture();
  for (const body of [
    { prompt: 'do something else' }, { files: ['synthetic.txt'] }, { request_id: 'chosen-id' },
    { expires_at_ms: START_TIME + 999999999 }, { target: 'production' }, [], null,
  ]) {
    assertHTTPRejected(await f.start(body));
    assert.equal(f.snapshot().length, 0);
  }
  const started = await f.start();
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.prompt, PROBE_PROMPT);
  assertNoCapabilities(started);
});

test('strict tool arguments cannot enqueue arbitrary prompts, files or hidden settings', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  for (const name of ['os1_probe_open', 'os1_probe_next']) {
    for (const args of [{ prompt: 'arbitrary' }, { files: [] }, { target: 'production' }, [], 'text', null]) {
      assertToolRejected(await f.tool(name, args));
      assert.deepEqual(f.snapshot(), before);
    }
  }
  for (const name of ['enqueue', 'os1_enqueue', 'read_file', 'os1_probe_cancel', 'os1_probe_start']) {
    assertToolRejected(await f.tool(name));
  }
  assert.deepEqual(f.snapshot(), before);
});

test('a queued run yields exactly one durable offer, even across competing calls', async () => {
  const f = fixture();
  assert.equal((await f.start()).json.state, 'queued');
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.tool('os1_probe_next')));
  const bridges = replies.map(bridge);
  const offers = bridges.filter((item) => item.state === 'offered');
  assert.equal(offers.length, 1);
  assertOffer(offers[0].request);
  for (const [index, item] of bridges.entries()) {
    if (item.state === 'offered') {
      const contentText = JSON.stringify(replies[index].json.result.content);
      assert.equal(contentText.includes(item.request.return_token), false);
      assert.equal(contentText.includes(item.request.dispatch_token), false);
    } else {
      assert.equal(item.state, 'busy');
      assert.equal(item.request, undefined);
      assertNoCapabilities(replies[index], offers[0].request);
    }
  }
  assert.equal((await f.result()).json.state, 'offered');
  assertToolRejected(await f.start());
  assert.equal((await f.result()).json.request_id, offers[0].request.request_id);
});

test('raw offer capabilities are never retained in durable storage or private/public summaries', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  assertOffer(offer);
  const stored = JSON.stringify(f.snapshot());
  assert.equal(stored.includes(offer.return_token), false);
  assert.equal(stored.includes(offer.dispatch_token), false);
  for (const reply of [await f.result(), await f.request('/health'), await f.rpc('tools/list'), await f.rpc('resources/list')]) {
    assertNoCapabilities(reply, offer);
  }
});

test('callback requires exact request, hash, capability, output and schema; rejection never consumes it', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  const before = f.snapshot();
  const invalid = [
    callback(offer, { request_id: 'different-request' }),
    callback(offer, { request_sha256: '0'.repeat(64) }),
    callback(offer, { return_token: 'wrong-capability' }),
    callback(offer, { return_token: offer.dispatch_token }),
    ...['', '3', '2\n', ' 2', '2 ', '2\u0000'].map((output) => callback(offer, { output })),
    callback(offer, { output: 2 }),
    callback(offer, { prompt: PROBE_PROMPT }),
    callback(offer, { extra: true }),
    (() => { const input = callback(offer); delete input.return_token; return input; })(),
  ];
  for (const args of invalid) {
    const reply = await f.tool('os1_probe_return', args);
    assertToolRejected(reply);
    assertNoCapabilities(reply, offer);
    assert.equal(reply.text.includes('different-request'), false, 'opaque errors must not echo supplied bindings');
    assert.equal(reply.text.includes('wrong-capability'), false);
    assert.deepEqual(f.snapshot(), before, 'invalid callbacks must not consume or alter the one-use capability');
  }
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  assert.equal((await f.result()).json.state, 'returned');
});

test('dispatch acknowledgment requires its own exact capability and strict schema', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  const before = f.snapshot();
  for (const args of [
    acknowledgement(offer, { request_id: 'different-request' }),
    acknowledgement(offer, { dispatch_token: 'incorrect' }),
    acknowledgement(offer, { dispatch_token: offer.return_token }),
    acknowledgement(offer, { extra: true }),
    { request_id: offer.request_id },
  ]) {
    const rejected = await f.tool('os1_probe_dispatched', args);
    assertToolRejected(rejected);
    assertNoCapabilities(rejected, offer);
    assert.deepEqual(f.snapshot(), before);
  }
  assertToolOK(await f.tool('os1_probe_dispatched', acknowledgement(offer)));
  const summary = (await f.result()).json;
  assert.equal(summary.dispatch_acknowledged, true);
  assert.equal(summary.dispatched_at_ms, START_TIME);
  const duplicateBefore = f.snapshot();
  assertToolOK(await f.tool('os1_probe_dispatched', acknowledgement(offer)));
  assert.deepEqual(f.snapshot(), duplicateBefore);
});

test('verified callback completes the fixed result; identical duplicates are idempotent', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  assertToolOK(await f.tool('os1_probe_dispatched', acknowledgement(offer)));
  f.clock.now += 100;
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  const reply = await f.result();
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.json.state, 'returned');
  assert.equal(reply.json.request_id, offer.request_id);
  assert.equal(reply.json.request_sha256, offer.request_sha256);
  assert.equal(reply.json.prompt, PROBE_PROMPT);
  assert.equal(reply.json.output, '2');
  assert.equal(reply.json.output_sha256, createHash('sha256').update('2').digest('hex'));
  assert.equal(reply.json.returned_at_ms, START_TIME + 100);
  assertNoCapabilities(reply, offer);
  const completedBefore = f.snapshot();
  f.clock.now += 100;
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  assert.deepEqual(f.snapshot(), completedBefore, 'duplicate callback must not rewrite output or timestamps');
  for (const args of [callback(offer, { output: '3' }), callback(offer, { return_token: 'different-token' })]) {
    assertToolRejected(await f.tool('os1_probe_return', args));
    assert.deepEqual(f.snapshot(), completedBefore);
  }
  const next = await f.tool('os1_probe_next');
  assert.equal(bridge(next).state, 'returned');
  assert.equal(bridge(next).request, undefined);
  assertNoCapabilities(next, offer);
  assertToolRejected(await f.start());
  assert.equal((await f.result()).json.state, 'returned');
});

test('return can arrive before the ui/message acknowledgment without requiring a resend', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  assert.equal((await f.result()).json.state, 'returned');
  // A delayed ACK may be accepted idempotently or rejected as terminal; neither may roll back completion.
  const ack = await f.tool('os1_probe_dispatched', acknowledgement(offer));
  assert.ok(ack.status === 200 || ack.status >= 400, ack.text);
  const summary = (await f.result()).json;
  assert.equal(summary.state, 'returned');
  assert.equal(summary.output, '2');
  assert.equal(bridge(await f.tool('os1_probe_next')).request, undefined);
});

test('operator cancellation is terminal for queued and offered runs; no public cancellation exists', async () => {
  for (const offered of [false, true]) {
    const f = fixture();
    await f.start();
    const offer = offered ? bridge(await f.tool('os1_probe_next')).request : undefined;
    assert.equal((await f.cancel()).status, 200);
    assert.equal((await f.result()).json.state, 'cancelled');
    const before = f.snapshot();
    const next = await f.tool('os1_probe_next');
    assert.equal(bridge(next).state, 'cancelled');
    assert.equal(bridge(next).request, undefined);
    if (offer) {
      assertToolRejected(await f.tool('os1_probe_return', callback(offer)));
      assertToolRejected(await f.tool('os1_probe_dispatched', acknowledgement(offer)));
      assertNoCapabilities(next, offer);
    }
    assert.deepEqual(f.snapshot(), before);
    assertToolRejected(await f.start());
  }
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  assertHTTPRejected(await f.request('/ops/cancel', { method: 'POST', body: {} }), 401);
  assertToolRejected(await f.tool('os1_probe_cancel'));
  assert.deepEqual(f.snapshot(), before);
});

test('queued TTL expiry is expired and never automatically re-offers', async () => {
  const f = fixture();
  const started = await f.start();
  f.clock.now = started.json.expires_at_ms;
  const reply = await f.result();
  assert.equal(reply.json.state, 'expired');
  assert.equal(reply.json.output, null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await f.tool('os1_probe_next');
    assert.equal(bridge(next).state, 'expired');
    assert.equal(bridge(next).request, undefined);
    assert.equal((await f.result()).json.state, 'expired');
  }
  assertToolRejected(await f.start());
});

test('offered TTL expiry is effects_uncertain, not retry permission, and rejects late return/ACK', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  f.clock.now = offer.expires_at_ms;
  const reply = await f.result();
  assert.equal(reply.json.state, 'effects_uncertain');
  const expiredBefore = f.snapshot();
  for (const [name, args] of [
    ['os1_probe_return', callback(offer)], ['os1_probe_dispatched', acknowledgement(offer)],
  ]) {
    const rejected = await f.tool(name, args);
    assertToolRejected(rejected);
    assertNoCapabilities(rejected, offer);
    assert.deepEqual(f.snapshot(), expiredBefore);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await f.tool('os1_probe_next');
    assert.equal(bridge(next).request, undefined);
    assertNoCapabilities(next, offer);
  }
  assert.equal((await f.result()).json.state, 'effects_uncertain');
  assertToolRejected(await f.start());
});

test('dispatched-but-unreturned timeout also retains uncertainty instead of re-dispatching', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  assertToolOK(await f.tool('os1_probe_dispatched', acknowledgement(offer)));
  f.clock.now = offer.expires_at_ms + 1;
  assert.equal((await f.result()).json.state, 'effects_uncertain');
  const next = await f.tool('os1_probe_next');
  assert.equal(bridge(next).request, undefined);
  assertNoCapabilities(next, offer);
});

test('restart with the same durable storage retains one-offer lock and callback capability hash', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  const offeredBefore = f.snapshot();
  f.restart();
  const next = await f.tool('os1_probe_next');
  assert.equal(bridge(next).state, 'busy');
  assert.equal(bridge(next).request, undefined);
  assertNoCapabilities(next, offer);
  assert.deepEqual(f.snapshot(), offeredBefore);
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  assert.equal((await f.result()).json.state, 'returned');
  const completedBefore = f.snapshot();
  f.restart();
  assertToolOK(await f.tool('os1_probe_return', callback(offer)));
  assert.deepEqual(f.snapshot(), completedBefore);
  assertToolRejected(await f.start());
});

test('invalid operator cancellation body cannot mutate active state', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  for (const body of [{ request_id: 'other-run' }, { target: 'production' }, [], null]) {
    assertHTTPRejected(await f.cancel(body));
    assert.deepEqual(f.snapshot(), before);
  }
});

test('malformed/unknown public callback calls never echo capabilities or operator key', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  const attempts = [
    await f.tool('os1_probe_return', callback(offer, { extra: OPERATOR_KEY })),
    await f.rpc('unknown/method', { return_token: offer.return_token, dispatch_token: offer.dispatch_token }),
    await f.tool('unknown_tool', { return_token: offer.return_token }),
    await f.rpc('resources/read', { uri: `https://example.invalid/${offer.return_token}` }),
  ];
  for (const reply of attempts) {
    assertToolRejected(reply);
    assertNoCapabilities(reply, offer);
  }
});

test('only trusted environment configuration selects the dedicated mailbox instance', async () => {
  const f = fixture({ instanceID: 'synthetic-run-001' });
  await f.start();
  const before = f.snapshot();
  assertToolRejected(await f.tool('os1_probe_next', { instance_id: 'other-mailbox' }));
  assertHTTPRejected(await f.request('/mcp?instance=other-mailbox', {
    method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'os1_probe_next', arguments: {} } },
  }), 404);
  assertHTTPRejected(await f.request('/ops/result?instance=other-mailbox', { auth: true }), 404);
  assert.deepEqual(f.snapshot(), before);
  assert.ok(f.names.length > 0);
  assert.ok(f.names.every((name) => name === 'synthetic-run-001'));
  for (const instanceID of ['', '../another', 'has spaces', 'x'.repeat(97), 123]) {
    const invalid = fixture({ instanceID });
    assertHTTPRejected(await invalid.request('/health'));
    assert.equal(invalid.names.length, 0, 'invalid configuration must reject before deriving a mailbox identity');
    assert.equal(invalid.map.size, 0);
  }
});

test('rate limit persists across restart, denies public requests, and resets only after its window', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  for (let attempt = 0; attempt < RATE_LIMIT; attempt++) {
    const reply = await f.rpc('ping');
    assertToolOK(reply);
  }
  assert.equal(f.map.get('rate').count, RATE_LIMIT);
  f.restart();
  assertHTTPRejected(await f.rpc('ping'), 429);
  assertHTTPRejected(await f.request('/health'), 429);
  assertHTTPRejected(await f.tool('os1_probe_next'), 429);
  assert.deepEqual(f.snapshot(), before, 'exhausting the public budget must not dispatch a task');
  assert.equal((await f.result()).json.state, 'queued', 'operator diagnostics remain available during throttling');
  f.clock.now += 59_999;
  assertHTTPRejected(await f.rpc('ping'), 429);
  f.clock.now += 1;
  assertToolOK(await f.rpc('ping'));
  assert.equal(f.map.get('rate').count, 1);
  assert.deepEqual(f.snapshot(), before);
});

test('method notifications and public health consume budget without creating probe state', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < RATE_LIMIT - 1; attempt++) {
    const reply = await f.rpc('tools/call', { name: 'os1_probe_next', arguments: {} }, { notification: true });
    assert.equal(reply.status, 202);
  }
  assert.equal((await f.request('/health')).status, 200);
  assertHTTPRejected(await f.rpc('tools/call', { name: 'os1_probe_next', arguments: {} }, { notification: true }), 429);
  assert.equal(f.snapshot().length, 0);
});

test('operator cancellation remains available after public rate exhaustion', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  for (let attempt = 1; attempt < RATE_LIMIT; attempt++) assertToolOK(await f.rpc('ping'));
  assertHTTPRejected(await f.tool('os1_probe_return', callback(offer)), 429);
  assert.equal((await f.cancel()).json.state, 'cancelled');
  assert.equal((await f.result()).json.state, 'cancelled');
  f.clock.now += 60_000;
  assertToolRejected(await f.tool('os1_probe_return', callback(offer)));
  assert.equal((await f.result()).json.state, 'cancelled');
});

test('the streaming byte limit rejects and cancels without relying on content-length', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(8000)));
      controller.enqueue(new TextEncoder().encode('x'.repeat(8000)));
      controller.enqueue(new TextEncoder().encode('x'.repeat(8000)));
    },
    cancel() { cancelled = true; },
  });
  const reply = await f.request('/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  assertHTTPRejected(reply, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(f.snapshot(), before);
});

test('body deadline rejects a stalled stream and makes cancellation best-effort', async (t) => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  let cancelled = false;
  const body = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.request('/mcp', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(BODY_TIMEOUT_MS);
  const reply = await pending;
  assertHTTPRejected(reply, 408);
  assert.equal(cancelled, true);
  assert.deepEqual(f.snapshot(), before);
});

test('declared body limits, unsupported content types and invalid UTF-8 reject before dispatch', async () => {
  const f = fixture();
  await f.start();
  const before = f.snapshot();
  assertHTTPRejected(await f.request('/mcp', { method: 'POST', body: '{}', headers: {
    'content-type': 'application/json', 'content-length': '16385',
  } }), 413);
  assertHTTPRejected(await f.request('/mcp', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), 415);
  assertHTTPRejected(await f.request('/mcp', { method: 'POST', body: new Uint8Array([0xff]),
    headers: { 'content-type': 'application/json' } }), 400);
  assert.deepEqual(f.snapshot(), before);
});

test('health exposes counts and state only, and idempotency does not double-count effects', async () => {
  const f = fixture();
  const offer = await activeOffer(f);
  await f.tool('os1_probe_dispatched', acknowledgement(offer));
  await f.tool('os1_probe_dispatched', acknowledgement(offer));
  await f.tool('os1_probe_return', callback(offer));
  await f.tool('os1_probe_return', callback(offer));
  const reply = await f.request('/health');
  assert.equal(reply.json.active_state, 'returned');
  assert.deepEqual(reply.json.counts, {
    starts: 1, offers: 1, acknowledgements: 1, returns: 1,
    cancellations: 0, expired: 0, uncertain: 0,
  });
  for (const name of ['request_id', 'request_sha256', 'prompt', 'output', 'return_token', 'dispatch_token']) {
    assert.equal(Object.hasOwn(reply.json, name), false);
  }
  assertNoCapabilities(reply, offer);
});
