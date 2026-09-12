import { describe, expect, it } from 'vitest';
import { GitHubVerifier } from '../../os1-auth-service/src/github-verifier';
import { authenticate } from '../src/gateway';
import { IdentityServiceUnavailable, RequestRejected } from '../src/errors';

const token = 'fixture-token-not-a-real-credential';
function harness(responses: Array<Response | Error>, maximum = 256) {
  let now = 1_800_000_000_000;
  const calls: RequestInit[] = [];
  const verifier = new GitHubVerifier((async (_url: unknown, init: RequestInit) => {
    calls.push(init);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw Error('unexpected upstream call');
    return next;
  }) as typeof fetch, () => now, maximum);
  return { verifier, calls, advance: (ms: number) => { now += ms; }, now: () => now };
}
const good = (id = 42) => Response.json({ id }, { headers: { etag: '"version-1"' } });

describe('bounded GitHub identity verification', () => {
  it('coalesces concurrent and serial polls without retaining a raw token', async () => {
    const h = harness([good()]);
    const results = await Promise.all(Array.from({ length: 100 }, () => h.verifier.verify(token)));
    expect(results.every(r => r.status === 200)).toBe(true);
    for (let i = 0; i < 100; i++) await h.verifier.verify(token);
    expect(h.calls.length).toBe(1);
    expect(JSON.stringify(h.verifier)).not.toContain(token);
    expect((h.calls[0].headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(h.calls[0].redirect).toBe('manual');
  });
  it('hard TTL does not slide; conditional 304 revalidates with GitHub', async () => {
    const h = harness([good(), new Response(null, { status: 304 })]);
    await h.verifier.verify(token);
    h.advance(59_999); await h.verifier.verify(token); expect(h.calls.length).toBe(1);
    h.advance(1); expect(await h.verifier.verify(token)).toEqual({ status: 200, subject: 'github:42' });
    expect(h.calls.length).toBe(2);
    expect((h.calls[1].headers as Record<string, string>)['if-none-match']).toBe('"version-1"');
  });
  it('does not authorize a revoked token or a cold 304', async () => {
    const h = harness([good(), new Response(null, { status: 401 }), new Response(null, { status: 304 })]);
    await h.verifier.verify(token); h.advance(60_000);
    expect(await h.verifier.verify(token)).toEqual({ status: 401 });
    expect((await h.verifier.verify(token)).status).toBe(503);
  });
  it('isolates different identities and bounds cache cardinality', async () => {
    const h = harness([good(1), good(2)], 2);
    expect(await h.verifier.verify(token)).toEqual({ status: 200, subject: 'github:1' });
    expect(await h.verifier.verify(token + 'other')).toEqual({ status: 200, subject: 'github:2' });
    expect((await h.verifier.verify(token + 'third')).status).toBe(503);
    expect(h.calls.length).toBe(2);
  });
  it('retains exact primary reset and makes no calls during cooldown', async () => {
    const h = harness([new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000360' } }), good()]);
    expect(await h.verifier.verify(token)).toEqual({ status: 429, retryAfter: 360 });
    h.advance(30_000);
    expect(await h.verifier.verify(token)).toEqual({ status: 429, retryAfter: 330 });
    expect(h.calls.length).toBe(1);
    h.advance(330_000); expect((await h.verifier.verify(token)).status).toBe(200);
  });
  it.each([
    new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
    new Response(null, { status: 403, headers: { 'retry-after': '120' } }),
    Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 }),
  ])('distinguishes primary/secondary quota from forbidden', async response => {
    const h = harness([response]);
    expect((await h.verifier.verify(token)).status).toBe(429);
  });
  it.each([new Error('network down'), new Response(null, { status: 500 }),
    new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid/' } }), new Response('not json'),
    Response.json({ id: true }), Response.json({ id: -1 }), new Response('x'.repeat(17000))])
    ('does not authorize malformed/transport replies or extend old success', async response => {
      const h = harness([good(), response]);
      await h.verifier.verify(token); h.advance(60_000);
      expect((await h.verifier.verify(token)).status).toBe(503);
      expect((await h.verifier.verify(token)).status).toBe(503);
      expect(h.calls.length).toBe(2);
    });
  it('genuine forbidden stays denied', async () => {
    const h = harness([Response.json({ message: 'Resource not accessible' }, { status: 403 })]);
    expect(await h.verifier.verify(token)).toEqual({ status: 401 });
  });
});

describe('gateway auth failure boundary', () => {
  function request() { return new Request('https://gateway/v1/executions', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-os1-device-id': 'fixture-device' }, body: '{}' }); }
  function env(status: number) { return { SERVICE_RESPONSE_BYTES: '4096',
    AUTH_SERVICE: { fetch: async () => Response.json({ error: 'identity_verification_unavailable' }, { status, headers: { 'retry-after': '360' } }) }
  } as unknown as Env; }
  it('propagates a throttle before parsing or starting any task', async () => {
    await expect(authenticate(request(), env(429))).rejects.toBeInstanceOf(IdentityServiceUnavailable);
    const error = await authenticate(request(), env(429)).catch(error => error);
    const response = error.response();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('360');
    expect(await response.json()).toEqual({ error: 'identity_verification_unavailable', retry_after_ms: 360000 });
  });
  it('propagates upstream unavailability, but genuine denials remain opaque', async () => {
    const error = await authenticate(request(), env(503)).catch(error => error);
    expect(error.response().status).toBe(503);
    await expect(authenticate(request(), env(401))).rejects.toBeInstanceOf(RequestRejected);
  });
});
