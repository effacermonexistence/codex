import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubVerifier } from '../../os1-auth-service/src/github-verifier';
import { IdentityServiceUnavailable, RequestRejected } from '../src/errors';
import { bindingJson } from '../src/io';

// Fixture-only credentials and an injected upstream: no network or auth cache.
const token = 'fixture-deadline-token-not-a-real-credential';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void operation().then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

function authBinding(verifier: GitHubVerifier, overheadMS = 200): Fetcher {
  return { fetch: async (_url: unknown, init: RequestInit) => abortable(init.signal!, async () => {
    await delay(overheadMS);
    const identity = await verifier.verify(token);
    if (identity.status === 200) return Response.json({ subject: identity.subject, device_id: 'fixture-device' });
    if (identity.status === 401) return Response.json({ error: 'denied' }, { status: 401 });
    return Response.json({ error: 'identity_verification_unavailable' }, {
      status: identity.status, headers: { 'retry-after': String(identity.retryAfter) },
    });
  }) } as unknown as Fetcher;
}

function identity(binding: Fetcher) {
  return bindingJson(binding, '/verify', { device_id: 'fixture-device' }, 4096,
    `Bearer ${token}`, false, true);
}

describe('nested identity deadline budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Node's native AbortSignal.timeout is not driven by Vitest's fake clock.
    // Preserve abort semantics while making the exact configured budget testable.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('fixture deadline', 'TimeoutError')), ms);
      return controller.signal;
    });
    vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(32).buffer);
  });
  afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });

  function slowValidIdentity() {
    const upstream = vi.fn(async (_url: unknown, init: RequestInit) => abortable(init.signal!, async () => {
      await delay(4900);
      return Response.json({ id: 42 });
    }));
    return { verifier: new GitHubVerifier(upstream as typeof fetch), upstream };
  }

  it('control: legacy outer 5s aborts a valid 4.9s lookup after service overhead', async () => {
    const h = slowValidIdentity();
    const pending = authBinding(h.verifier).fetch('https://service.internal/verify', {
      method: 'POST', signal: AbortSignal.timeout(5000),
    }).then(() => 'unexpected authorization', error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeInstanceOf(DOMException);
    expect((await pending).name).toBe('TimeoutError');
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });

  it('allows the same valid nested lookup to finish without an outer deadline race', async () => {
    const h = slowValidIdentity();
    const pending = identity(authBinding(h.verifier)).catch(error => error);
    await vi.advanceTimersByTimeAsync(5100);
    expect(await pending).toEqual({ subject: 'github:42', device_id: 'fixture-device' });
    expect(h.upstream).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AbortSignal.timeout).mock.calls.map(call => call[0])).toEqual([8000, 5000]);
  });

  it('retains the inner 5s bound and fails closed instead of extending an expired identity', async () => {
    let calls = 0;
    const verifier = new GitHubVerifier((async (_url: unknown, init: RequestInit) => {
      if (++calls === 1) return Response.json({ id: 42 });
      return abortable(init.signal!, () => new Promise<Response>(() => {}));
    }) as typeof fetch);
    expect(await verifier.verify(token)).toEqual({ status: 200, subject: 'github:42' });
    await vi.advanceTimersByTimeAsync(60_000);
    const pending = identity(authBinding(verifier)).catch(error => error);
    await vi.advanceTimersByTimeAsync(5200);
    const error = await pending;
    expect(error).toBeInstanceOf(IdentityServiceUnavailable);
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBe(5);
    expect((await verifier.verify(token)).status).toBe(503);
    expect(calls).toBe(2);
  });

  it('bounds an unresponsive identity binding at 8s and preserves typed unavailability', async () => {
    const never = { fetch: async (_url: unknown, init: RequestInit) =>
      abortable(init.signal!, () => new Promise<Response>(() => {})) } as unknown as Fetcher;
    const pending = identity(never).catch(error => error);
    await vi.advanceTimersByTimeAsync(7999);
    let settled = false; void pending.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error).toBeInstanceOf(IdentityServiceUnavailable);
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBe(5);
  });

  it('keeps every nonidentity binding at the existing 5s deadline', async () => {
    const binding = { fetch: async (_url: unknown, init: RequestInit) =>
      abortable(init.signal!, () => new Promise<Response>(() => {})) } as unknown as Fetcher;
    const pending = bindingJson(binding, '/authorize-profile', {}, 4096).catch(error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeInstanceOf(DOMException);
    expect(await pending).not.toBeInstanceOf(IdentityServiceUnavailable);
    expect(vi.mocked(AbortSignal.timeout).mock.calls.map(call => call[0])).toEqual([5000]);
  });

  it('does not weaken genuine identity denials', async () => {
    const binding = { fetch: async () => Response.json({ error: 'denied' }, { status: 401 }) } as unknown as Fetcher;
    await expect(identity(binding)).rejects.toBeInstanceOf(RequestRejected);
  });

  it('preserves exact upstream cooldowns and never treats throttling as permission', async () => {
    const binding = { fetch: async () => Response.json({ error: 'identity_verification_unavailable' }, {
      status: 429, headers: { 'retry-after': '360' },
    }) } as unknown as Fetcher;
    const error = await identity(binding).catch(error => error);
    expect(error).toBeInstanceOf(IdentityServiceUnavailable);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(360);
  });
});
