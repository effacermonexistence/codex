import { GitHubVerifier } from './github-verifier';

const DEVICE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const identities = new GitHubVerifier();

function denied(): Response {
  return Response.json({ error: "denied" }, { status: 401 });
}

function parseDeviceId(value: unknown): string | null {
  return typeof value === "string" && DEVICE_ID.test(value) ? value : null;
}

async function readDeviceId(request: Request): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 512) return null;
  let value: unknown;
  try {
    value = await request.json<unknown>();
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  ) {
    return null;
  }
  return parseDeviceId((value as Record<string, unknown>).device_id);
}

async function verify(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]{20,8192})$/u)?.[1];
  const deviceId = await readDeviceId(request);
  if (!token || !deviceId) return denied();

  const identity = await identities.verify(token);
  if (identity.status === 401) return denied();
  if (identity.status !== 200) return Response.json({ error: 'identity_verification_unavailable' }, {
    status: identity.status, headers: { 'cache-control': 'no-store', 'retry-after': String(identity.retryAfter) }
  });
  return Response.json({ subject: identity.subject, device_id: deviceId }, { headers: { 'cache-control': 'no-store' } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.pathname !== "/verify") {
        return denied();
      }
      return await verify(request);
    } catch {
      return denied();
    }
  },
} satisfies ExportedHandler<Env>;
