export type IdentityResult =
  | { status: 200; subject: string }
  | { status: 401 }
  | { status: 429 | 503; retryAfter: number };

type Entry = { subject?: string; etag?: string; validUntil: number; retainUntil: number;
  failure?: Extract<IdentityResult, { retryAfter: number }>; retryAt?: number };

/** Bounded per-isolate identity cache. No raw credential is retained in keys,
 * values or diagnostics; no repository permission is cached. Positive TTL is
 * hard (not sliding). Errors never authorize or extend a prior positive result. */
export class GitHubVerifier {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<IdentityResult>>();
  constructor(private readonly upstream: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now, private readonly maximum = 256) {}

  async verify(token: string): Promise<IdentityResult> {
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const now = this.now();
    for (const [key, value] of this.entries) if (value.retainUntil <= now) this.entries.delete(key);
    const prior = this.entries.get(fingerprint);
    if (prior?.failure && prior.retryAt! > now) {
      return { status: prior.failure.status, retryAfter: Math.max(1, Math.ceil((prior.retryAt! - now) / 1000)) };
    }
    if (prior?.subject && prior.validUntil > now) return { status: 200, subject: prior.subject };
    const inflight = this.pending.get(fingerprint);
    if (inflight) return inflight;
    if (!prior && this.entries.size >= this.maximum) return { status: 503, retryAfter: 5 };
    if (this.pending.size >= this.maximum) return { status: 503, retryAfter: 5 };
    const request = this.lookup(token, prior).then(result => {
      // Never evict active cooldowns to serve another identity. Refuse cache
      // growth at capacity; lack of cache capacity is not an authorization.
      if (this.entries.size < this.maximum || this.entries.has(fingerprint)) this.entries.set(fingerprint, result.entry);
      return result.result;
    }).finally(() => { this.pending.delete(fingerprint); });
    this.pending.set(fingerprint, request);
    return request;
  }

  private async lookup(token: string, prior?: Entry): Promise<{ result: IdentityResult; entry: Entry }> {
    const failure = (status: 429 | 503, retryAfter: number) => {
      const retryAt = this.now() + retryAfter * 1000;
      const result = { status, retryAfter } as const;
      return { result, entry: { validUntil: 0, retainUntil: retryAt, failure: result, retryAt } };
    };
    let response: Response;
    try {
      response = await this.upstream('https://api.github.com/user', {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
          'user-agent': 'OS-1-route-gateway', 'x-github-api-version': '2022-11-28',
          ...(prior?.etag && prior.subject ? { 'if-none-match': prior.etag } : {}) },
        // Workers supports manual/follow here. Never follow a redirect carrying
        // the Authorization header to a different origin; 3xx is unavailable.
        redirect: 'manual', signal: AbortSignal.timeout(5000)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.warn(JSON.stringify({ event: 'identity_upstream_unavailable', category: error instanceof Error ? error.name : 'unknown',
        redirectError: /redirect/i.test(message), receiverError: /invocation|receiver|this/i.test(message), timeoutError: /timeout|abort/i.test(message) }));
      return failure(503, 5);
    }
    if (response.status === 429 || (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
      await response.body?.cancel();
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const rawRetry = response.headers.get('retry-after') ?? '';
      const retry = /^\d+$/.test(rawRetry) ? Number(rawRetry) : (Date.parse(rawRetry) - this.now()) / 1000;
      const retryAfter = Math.ceil(Math.max(60, Number.isFinite(retry) ? retry : 0,
        Number.isFinite(reset) ? (reset - this.now()) / 1000 : 0));
      return failure(429, retryAfter);
    }
    if (response.status >= 500) { console.warn(JSON.stringify({ event: 'identity_upstream_http', status: response.status })); await response.body?.cancel(); return failure(503, 5); }
    if (response.status === 304) {
      if (!prior?.subject || !prior.etag) return failure(503, 5);
      const now = this.now();
      return { result: { status: 200, subject: prior.subject },
        entry: { subject: prior.subject, etag: prior.etag, validUntil: now + 60_000, retainUntil: now + 3_600_000 } };
    }
    if (response.status === 401 || response.status === 403) {
      // Secondary throttles can omit all rate headers. Inspect a bounded JSON
      // message before distinguishing a real denial; never publish that body.
      const body = await this.boundedBody(response);
      if (response.status === 403 && typeof body?.message === 'string' && /rate limit|abuse detection/i.test(body.message)) return failure(429, 60);
      return { result: { status: 401 }, entry: { validUntil: 0, retainUntil: 0 } };
    }
    if (response.status !== 200) { console.warn(JSON.stringify({ event: 'identity_upstream_http', status: response.status })); await response.body?.cancel(); return failure(503, 5); }
    const body = await this.boundedBody(response);
    if (!Number.isSafeInteger(body?.id) || Number(body?.id) <= 0) {
      console.warn(JSON.stringify({ event: 'identity_upstream_shape', decoded: body !== undefined, idType: typeof body?.id }));
      return failure(503, 5);
    }
    const subject = `github:${body!.id}`;
    const now = this.now();
    const etag = response.headers.get('etag');
    return { result: { status: 200, subject }, entry: { subject,
      ...(etag && etag.length <= 256 ? { etag } : {}), validUntil: now + 60_000, retainUntil: now + 3_600_000 } };
  }

  private async boundedBody(response: Response): Promise<Record<string, unknown> | undefined> {
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) { await reader.cancel(); return; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch { return; }
    finally { reader.releaseLock(); }
  }
}
