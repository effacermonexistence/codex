export class IdentityServiceUnavailable extends Error {
  constructor(readonly status: 429 | 503, readonly retryAfter: number) {
    super('identity verification unavailable'); this.name = 'IdentityServiceUnavailable';
  }
  response(): Response {
    return Response.json({ error: 'identity_verification_unavailable', retry_after_ms: this.retryAfter * 1000 },
      { status: this.status, headers: { 'cache-control': 'no-store', 'retry-after': String(this.retryAfter) } });
  }
}

export class RequestRejected extends Error {
  constructor() {
    super("request rejected");
    this.name = "RequestRejected";
  }
}

export function reject(): never {
  throw new RequestRejected();
}

export class ResultServiceUnavailable extends Error {
  constructor() { super("result service unavailable"); this.name = "ResultServiceUnavailable"; }
}
