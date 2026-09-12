import { reject, ResultServiceUnavailable, IdentityServiceUnavailable } from "./errors";

export async function readBoundedJson(
  requestOrResponse: Request | Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentLength = Number(requestOrResponse.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) reject();
  const body = requestOrResponse.body;
  if (!body) reject();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) reject();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    reject();
  }
}

export async function bindingJson(
  binding: Fetcher,
  path: string,
  body: unknown,
  maximumResponseBytes: number,
  authorization?: string,
  resultDelivery = false,
  identityVerification = false,
): Promise<unknown> {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  let response: Response;
  try { response = await binding.fetch(`https://service.internal${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  }); } catch (error) {
    if (identityVerification) throw new IdentityServiceUnavailable(503, 5);
    if (resultDelivery) throw new ResultServiceUnavailable();
    throw error;
  }
  if (identityVerification && (response.status === 429 || response.status >= 500)) {
    const raw = response.headers.get('retry-after') ?? '5';
    const retry = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : 60;
    throw new IdentityServiceUnavailable(response.status === 429 ? 429 : 503, Math.max(1, retry));
  }
  if (resultDelivery && response.status >= 500) throw new ResultServiceUnavailable();
  if (!response.ok) reject();
  return readBoundedJson(response, maximumResponseBytes);
}
