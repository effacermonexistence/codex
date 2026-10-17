import type {
  DeviceRegistration,
  ResultRequest,
  Ticket,
  TicketUnsigned,
} from "./contracts";

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function canonicalRegistration(
  registration: Omit<DeviceRegistration, "signature">,
): Uint8Array {
  return encoder.encode(
    [
      "os1-device-register-v1",
      registration.device_id,
      String(registration.registered_at),
      registration.nonce,
      registration.p256_public_jwk.kty ?? "",
      registration.p256_public_jwk.crv ?? "",
      registration.p256_public_jwk.x ?? "",
      registration.p256_public_jwk.y ?? "",
    ].join("\n"),
  );
}

function pemBytes(pem: string, label: string): Uint8Array {
  const compact = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/gu, "");
  if (compact.length < 32) throw new Error("invalid key material");
  return Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
}

export function canonicalTicket(ticket: TicketUnsigned): Uint8Array {
  return encoder.encode(
    [
      "os1-ticket-v1",
      ticket.execution_id,
      String(ticket.sequence),
      ticket.provider,
      ticket.action,
      ticket.permission_profile,
      ticket.expires_at,
      ticket.nonce,
    ].join("\n"),
  );
}

export function canonicalResult(result: ResultRequest): Uint8Array {
  const base = [
    result.ticket.execution_id,
    String(result.ticket.sequence),
    result.ticket.nonce,
    result.result_hash,
    result.artifact_ref,
  ];
  // v2 signs the step's measured usage with the result, so a forwarded token
  // count is exactly what the device reported; v1 stays byte-identical.
  if (!result.usage) return encoder.encode(["os1-result-v1", ...base].join("\n"));
  const count = (value: number | null) => value === null ? "null" : String(value);
  return encoder.encode([
    "os1-result-v2", ...base,
    count(result.usage.input_tokens), count(result.usage.cache_tokens), count(result.usage.output_tokens),
  ].join("\n"));
}

export async function signTicket(
  unsigned: TicketUnsigned,
  privateKeyPem: string,
): Promise<Ticket> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKeyPem, "PRIVATE KEY"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    canonicalTicket(unsigned),
  );
  return { ...unsigned, signature: base64UrlEncode(new Uint8Array(signature)) };
}

export async function verifyTicket(
  ticket: Ticket,
  publicKeyPem: string,
): Promise<boolean> {
  const { signature, ...unsigned } = ticket;
  const key = await crypto.subtle.importKey(
    "spki",
    pemBytes(publicKeyPem, "PUBLIC KEY"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    base64UrlDecode(signature),
    canonicalTicket(unsigned),
  );
}

export async function verifyDeviceResult(
  result: ResultRequest,
  publicJwk: JsonWebKey,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(result.device_signature),
    canonicalResult(result),
  );
}

export async function verifyDeviceRegistration(
  registration: DeviceRegistration,
): Promise<boolean> {
  const { signature, ...unsigned } = registration;
  const key = await crypto.subtle.importKey(
    "jwk",
    registration.p256_public_jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(signature),
    canonicalRegistration(unsigned),
  );
}

export function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256HexBytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return crypto.subtle.timingSafeEqual(
    encoder.encode(left),
    encoder.encode(right),
  );
}
