// Isolated synthetic transport diagnostic. No OS1/customer state, inference,
// credentials, filesystem, network egress, planner, or automatic replay.
export const PROBE_PROMPT = '1+1';
export const RESOURCE_URI = 'ui://os1/native-chat-probe';
export const MAX_BODY_BYTES = 16_384;
export const PROBE_TTL_MS = 600_000;
export const BODY_TIMEOUT_MS = 5_000;
export const RATE_LIMIT = 120;
const DEFAULT_INSTANCE = 'os1-native-chat-probe-20261011a';
const INSTANCE = /^[A-Za-z0-9_-]{1,96}$/;
const RECORD_KEY = 'probe';
const COUNTS_KEY = 'counts';
const RATE_KEY = 'rate';
const ID = /^probe-[a-f0-9]{48}$/;
const HASH = /^[a-f0-9]{64}$/;
const ACTIVE = new Set(['queued', 'offered', 'dispatched']);
const encoder = new TextEncoder();
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const string = max => ({type:'string', minLength:1, maxLength:max});
const annotations = (readOnly, idempotent = false) => ({readOnlyHint:readOnly, destructiveHint:false, idempotentHint:idempotent, openWorldHint:false});
const flags = () => ({probe_only:true, production_available:false, native_host_verified:false,
  host_authentication_verified:false, usage_accounting_verified:false, host_mode:'NOT_EXPOSED',
  model:'NOT_EXPOSED', effort:'NOT_EXPOSED', quota:'NOT_EXPOSED'});
export const TOOL_DEFINITIONS = [
  {name:'os1_probe_open', description:'Open the fixed synthetic native Chat probe. Opening is not dispatch or native execution proof.',
    inputSchema:object({}), annotations:annotations(true, true), outputSchema:{type:'object'},
    _meta:{ui:{resourceUri:RESOURCE_URI, visibility:['model','app']},
      'openai/ui':{entrypoints:[{type:'global'}]}, 'openai/outputTemplate':RESOURCE_URI}},
  {name:'os1_probe_next', description:'App-only: offer the one operator-authorized synthetic request once. Never retry or substitute another provider.',
    inputSchema:object({}), annotations:annotations(false), outputSchema:{type:'object'}, _meta:{ui:{visibility:['app']}}},
  {name:'os1_probe_dispatched', description:'App-only: record message submission acknowledgement, not a model answer.',
    inputSchema:object({request_id:string(54), dispatch_token:string(64)}), annotations:annotations(false, true),
    outputSchema:{type:'object'}, _meta:{ui:{visibility:['app']}}},
  {name:'os1_probe_return', description:'Return only the actual answer 2 for the exact synthetic 1+1 request, copying its request_id, request_sha256 and return_token. No metadata or other content.',
    inputSchema:object({request_id:string(54), request_sha256:string(64), return_token:string(64), output:{type:'string', const:'2'}}),
    annotations:annotations(false, true), outputSchema:{type:'object'}, _meta:{ui:{visibility:['model']}}},
];

class ProbeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const requireThat = (ok, code, status) => { if (!ok) throw new ProbeError(code, status); };
function shape(value, required = [], optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function empty(value) { return shape(value); }
function json(value, status = 200) {
  return Response.json(value, {status, headers:{'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
}
function safeFailure(error) {
  return json({error:error instanceof ProbeError ? error.code : 'probe_operation_failed'},
    error instanceof ProbeError ? error.status : 500);
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
// Compare fixed-size digests without a content-dependent early exit. This is
// capability verification, not proof of a ChatGPT account or host identity.
async function equalDigest(actual, expected) {
  if (typeof actual !== 'string' || !HASH.test(actual) || typeof expected !== 'string' || !HASH.test(expected)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
async function operatorAuthorized(request, env) {
  const expected = env.PROBE_OPERATOR_KEY;
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([!-~]{32,512})$/)?.[1];
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 512 || !supplied) return false;
  return equalDigest(await digest(supplied), await digest(expected));
}

async function boundedJSON(request, {emptyAllowed = false} = {}) {
  const length = request.headers.get('content-length');
  requireThat(length === null || /^\d+$/.test(length) && Number(length) <= MAX_BODY_BYTES,
    'request_too_large', 413);
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  requireThat(type === 'application/json' || emptyAllowed && !type, 'json_content_type_required', 415);
  const reader = request.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ProbeError('body_read_timeout', 408)), BODY_TIMEOUT_MS);
    });
    try {
      while (true) {
        const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES) throw new ProbeError('request_too_large', 413);
        chunks.push(part.value);
      }
    } catch (error) {
      // Cancellation is best-effort and never awaited past the body deadline.
      void reader.cancel().catch(() => {}); throw error;
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }
  if (size === 0 && emptyAllowed) return {};
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    return JSON.parse(text);
  } catch { throw new ProbeError('invalid_json'); }
}
function protocolResult(id, result) { return {jsonrpc:'2.0', id, result}; }
function protocolError(id, code, message) { return {jsonrpc:'2.0', id, error:{code, message}}; }
function visible(value) { return {content:[{type:'text', text:JSON.stringify(value)}], structuredContent:value}; }
function widget(value) { return {...visible({state:value.state, ...flags()}), _meta:{bridge:value}}; }
function publicRecord(row) {
  if (!row) return {state:'idle', ...flags()};
  return {state:row.state, request_id:row.request_id, request_sha256:row.request_sha256, prompt:PROBE_PROMPT,
    created_at_ms:row.created_at_ms, expires_at_ms:row.expires_at_ms, offered_at_ms:row.offered_at_ms,
    dispatched_at_ms:row.dispatched_at_ms, returned_at_ms:row.returned_at_ms, terminal_at_ms:row.terminal_at_ms,
    output:row.output, output_sha256:row.output_sha256,
    dispatch_acknowledged:row.dispatched_at_ms !== null, ...flags()};
}
function initialCounts() { return {starts:0, offers:0, acknowledgements:0, returns:0, cancellations:0, expired:0, uncertain:0}; }

export class NativeChatProbe {
  constructor(ctx, env, {now = () => Date.now()} = {}) { this.ctx = ctx; this.env = env; this.now = now; }
  time() { const value = this.now(); requireThat(Number.isSafeInteger(value) && value >= 0, 'clock_invalid'); return value; }
  async transaction(action) {
    return this.ctx.storage.transaction(async storage => {
      const now = this.time();
      let row = await storage.get(RECORD_KEY);
      const counts = await storage.get(COUNTS_KEY) ?? initialCounts();
      if (row && ACTIVE.has(row.state) && row.expires_at_ms <= now) {
        row.state = row.state === 'queued' ? 'expired' : 'effects_uncertain';
        row.terminal_at_ms = now;
        counts[row.state === 'expired' ? 'expired' : 'uncertain']++;
        await storage.put(RECORD_KEY, row); await storage.put(COUNTS_KEY, counts);
      }
      return action({storage, now, row, counts});
    });
  }
  async rate() {
    return this.ctx.storage.transaction(async storage => {
      const now = this.time();
      let value = await storage.get(RATE_KEY);
      if (!value || now >= value.started_at_ms + 60_000 || now < value.started_at_ms) value = {started_at_ms:now, count:0};
      requireThat(value.count < RATE_LIMIT, 'probe_rate_limited', 429);
      value.count++;
      await storage.put(RATE_KEY, value);
      return {allowed:true};
    });
  }
  async start() {
    return this.transaction(async ({storage, now, row, counts}) => {
      // One run total per instance. Terminal evidence and tombstones survive;
      // a fresh run requires an explicitly selected new operator instance.
      requireThat(!row, 'probe_already_exists', 409);
      const next = {schema:1, request_id:'probe-' + randomHex(24), request_sha256:await digest(PROBE_PROMPT),
        created_at_ms:now, expires_at_ms:now + PROBE_TTL_MS, state:'queued', offered_at_ms:null,
        dispatched_at_ms:null, returned_at_ms:null, terminal_at_ms:null,
        return_hash:null, dispatch_hash:null, output:null, output_sha256:null};
      counts.starts++;
      await storage.put(RECORD_KEY, next); await storage.put(COUNTS_KEY, counts);
      return publicRecord(next);
    });
  }
  async result() { return this.transaction(({row}) => publicRecord(row)); }
  async cancel() {
    return this.transaction(async ({storage, now, row, counts}) => {
      if (!row || !ACTIVE.has(row.state)) return {...publicRecord(row), idempotent:true};
      row.state = 'cancelled'; row.terminal_at_ms = now; counts.cancellations++;
      await storage.put(RECORD_KEY, row); await storage.put(COUNTS_KEY, counts);
      return publicRecord(row);
    });
  }
  async health() {
    return this.transaction(({row, counts}) => ({state:'probe_only', active_state:row?.state ?? 'idle', counts, ...flags()}));
  }
  async next() {
    return this.transaction(async ({storage, now, row, counts}) => {
      // A terminal tombstone is not an empty mailbox. Preserve it so native
      // observers stop instead of repeatedly polling an expired/completed run.
      if (!row || !ACTIVE.has(row.state)) return {state:row?.state ?? 'idle'};
      if (row.state !== 'queued') return {state:'busy', request_id:row.request_id};
      const returnToken = randomHex(32), dispatchToken = randomHex(32);
      row.state = 'offered'; row.offered_at_ms = now;
      row.return_hash = await digest(returnToken); row.dispatch_hash = await digest(dispatchToken);
      counts.offers++;
      await storage.put(RECORD_KEY, row); await storage.put(COUNTS_KEY, counts);
      return {state:'offered', request:{request_id:row.request_id, request_sha256:row.request_sha256,
        prompt:PROBE_PROMPT, return_token:returnToken, dispatch_token:dispatchToken,
        created_at_ms:row.created_at_ms, expires_at_ms:row.expires_at_ms}};
    });
  }
  async dispatched(args) {
    requireThat(shape(args, ['request_id','dispatch_token']) && ID.test(args.request_id) && HASH.test(args.dispatch_token), 'tool_arguments_invalid');
    return this.transaction(async ({storage, now, row, counts}) => {
      requireThat(row?.request_id === args.request_id && await equalDigest(await digest(args.dispatch_token), row.dispatch_hash), 'binding_invalid');
      if (row.state === 'dispatched' || row.state === 'returned') return {...publicRecord(row), idempotent:true};
      requireThat(row.state === 'offered', 'probe_not_active');
      row.state = 'dispatched'; row.dispatched_at_ms = now; counts.acknowledgements++;
      await storage.put(RECORD_KEY, row); await storage.put(COUNTS_KEY, counts);
      return publicRecord(row);
    });
  }
  async returned(args) {
    requireThat(shape(args, ['request_id','request_sha256','return_token','output']) &&
      ID.test(args.request_id) && HASH.test(args.request_sha256) && HASH.test(args.return_token) && args.output === '2', 'tool_arguments_invalid');
    return this.transaction(async ({storage, now, row, counts}) => {
      requireThat(row?.request_id === args.request_id && row.request_sha256 === args.request_sha256 &&
        await equalDigest(await digest(args.return_token), row.return_hash), 'binding_invalid');
      if (row.state === 'returned') return {...publicRecord(row), idempotent:true};
      requireThat(row.state === 'offered' || row.state === 'dispatched', 'probe_not_active');
      row.state = 'returned'; row.returned_at_ms = now; row.terminal_at_ms = now;
      row.output = '2'; row.output_sha256 = await digest('2'); counts.returns++;
      await storage.put(RECORD_KEY, row); await storage.put(COUNTS_KEY, counts);
      return publicRecord(row);
    });
  }
  async tool(params) {
    try {
      requireThat(shape(params, ['name'], ['arguments','_meta']) && typeof params.name === 'string', 'tool_arguments_invalid');
      const args = Object.hasOwn(params, 'arguments') ? params.arguments : {};
      switch (params.name) {
        case 'os1_probe_next': requireThat(empty(args), 'tool_arguments_invalid'); return widget(await this.next());
        case 'os1_probe_dispatched': return widget(await this.dispatched(args));
        case 'os1_probe_return': return visible(await this.returned(args));
        default: throw new ProbeError('tool_not_allowed');
      }
    } catch (error) {
      return {isError:true, content:[{type:'text', text:error instanceof ProbeError ? error.code : 'probe_operation_failed'}]};
    }
  }
  async fetch(request) {
    try {
      const url = new URL(request.url); requireThat(url.search === '', 'route_not_allowed', 404);
      if (url.pathname === '/health' && request.method === 'GET') { await this.rate(); return json(await this.health()); }
      if (['/ops/start','/ops/result','/ops/cancel'].includes(url.pathname)) {
        requireThat(await operatorAuthorized(request, this.env), 'operator_authorization_required', 401);
        if (url.pathname === '/ops/result') {
          requireThat(request.method === 'GET', 'method_not_allowed', 405);
          requireThat(request.body === null, 'operator_arguments_invalid'); return json(await this.result());
        }
        requireThat(request.method === 'POST', 'method_not_allowed', 405);
        requireThat(empty(await boundedJSON(request, {emptyAllowed:true})), 'operator_arguments_invalid');
        return json(await (url.pathname === '/ops/start' ? this.start() : this.cancel()));
      }
      if (url.pathname === '/tool' && request.method === 'POST') {
        const message = await boundedJSON(request);
        requireThat(shape(message, ['id','params']), 'rpc_shape_invalid');
        return json(protocolResult(message.id, await this.tool(message.params)));
      }
      if (url.pathname === '/rate' && request.method === 'POST' && request.body === null) return json(await this.rate());
      throw new ProbeError('route_not_allowed', 404);
    } catch (error) { return safeFailure(error); }
  }
}

function validID(value) { return typeof value === 'string' && value.length <= 128 || Number.isSafeInteger(value); }
function paramsFor(message) {
  const value = Object.hasOwn(message, 'params') ? message.params : {};
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'rpc_params_invalid');
  // Standard MCP transport metadata is not a business argument, resource
  // selector, account authorization or probe capability. Native hosts attach
  // it to resource reads as well as tool calls. Validate its container, then
  // discard it before the unchanged exact per-method argument checks.
  if (Object.hasOwn(value, '_meta')) {
    const meta = value._meta;
    requireThat(meta !== null && typeof meta === 'object' && !Array.isArray(meta), 'rpc_meta_invalid');
    if (Object.hasOwn(meta, 'progressToken')) {
      requireThat(typeof meta.progressToken === 'string' || Number.isFinite(meta.progressToken), 'rpc_meta_invalid');
    }
  }
  const {_meta, ...businessParams} = value;
  return businessParams;
}
export function createProbeWorker({appHTML = ''} = {}) {
  requireThat(typeof appHTML === 'string' && encoder.encode(appHTML).byteLength <= 1_000_000, 'resource_invalid');
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url); requireThat(url.search === '', 'route_not_allowed', 404);
        const instance = env.PROBE_INSTANCE_ID ?? DEFAULT_INSTANCE;
        requireThat(typeof instance === 'string' && INSTANCE.test(instance), 'instance_invalid');
        const stub = () => env.NATIVE_PROBE.get(env.NATIVE_PROBE.idFromName(instance));
        if (url.pathname === '/health' && request.method === 'GET' || ['/ops/start','/ops/result','/ops/cancel'].includes(url.pathname)) {
          return await stub().fetch(request);
        }
        requireThat(url.pathname === '/mcp', 'route_not_allowed', 404);
        requireThat(request.method === 'POST', 'method_not_allowed', 405);
        const message = await boundedJSON(request);
        requireThat(shape(message, ['jsonrpc','method'], ['id','params']) && message.jsonrpc === '2.0' &&
          typeof message.method === 'string' && (message.id === undefined || validID(message.id)), 'rpc_shape_invalid');
        const limit = await stub().fetch(new Request('https://probe.internal/rate', {method:'POST'}));
        if (!limit.ok) return limit;
        // Notifications never execute tools, allocate a run, or consume an offer.
        if (message.id === undefined) return new Response(null, {status:202, headers:{'Cache-Control':'no-store'}});
        const params = paramsFor(message);
        let result;
        switch (message.method) {
          case 'initialize':
            requireThat(shape(params, [], ['protocolVersion','capabilities','clientInfo']), 'rpc_params_invalid');
            result = {protocolVersion:'2025-06-18', capabilities:{tools:{listChanged:false}, resources:{listChanged:false, subscribe:false}},
              serverInfo:{name:'os1-native-chat-synthetic-probe', version:'0.1.0'},
              instructions:'Synthetic 1+1 transport probe only. A matching os1_probe_return callback is a diagnostic receipt, not host authentication, ordinary Chat mode, model, quota, quality or OS1 production proof. No fallback or retry.'};
            break;
          case 'ping': requireThat(empty(params), 'rpc_params_invalid'); result = {}; break;
          case 'tools/list': requireThat(empty(params), 'rpc_params_invalid'); result = {tools:TOOL_DEFINITIONS}; break;
          case 'resources/list':
            requireThat(empty(params), 'rpc_params_invalid');
            result = {resources:[{uri:RESOURCE_URI, name:'OS1 native Chat synthetic probe', mimeType:'text/html;profile=mcp-app'}]}; break;
          case 'resources/read':
            requireThat(shape(params, ['uri']) && params.uri === RESOURCE_URI && appHTML.length > 0, 'resource_not_allowed');
            result = {contents:[{uri:RESOURCE_URI, mimeType:'text/html;profile=mcp-app', text:appHTML,
              _meta:{ui:{csp:{connectDomains:[], resourceDomains:[]}},
                'openai/ui':{availableDisplayModes:['inline','fullscreen'], preferredDisplayMode:'fullscreen'},
                'openai/widgetDescription':'Fixed synthetic 1+1 native message/callback probe. No production or authentication claim.'}}]}; break;
          case 'tools/call':
            if (params.name === 'os1_probe_open') {
              requireThat(shape(params, ['name'], ['arguments','_meta']) &&
                empty(Object.hasOwn(params, 'arguments') ? params.arguments : {}), 'tool_arguments_invalid');
              result = {...visible({state:'component_requested', ...flags()}), _meta:{'openai/outputTemplate':RESOURCE_URI}}; break;
            }
            return await stub().fetch(new Request('https://probe.internal/tool', {method:'POST', headers:{'Content-Type':'application/json'},
              body:JSON.stringify({id:message.id, params})}));
          default: return json(protocolError(message.id, -32601, 'Method not allowed'));
        }
        return json(protocolResult(message.id, result));
      } catch (error) { return safeFailure(error); }
    },
  };
}

// Root's static HTML entry module calls the factory and re-exports the DO.
export default createProbeWorker();
