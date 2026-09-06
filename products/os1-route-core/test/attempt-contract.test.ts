import { describe, it, expect } from 'vitest';
import { parseAttemptStart, attemptStartBytes, verifyAttemptStart } from '../src/attempt-contract';
import { canonicalResult } from '../src/crypto';
import type { Ticket } from '../src/contracts';
describe('execution start proof', () => {
  const ticket: Ticket = {execution_id:'3f7c2a82-3b21-4f39-9e3a-8dd9af83c79c',sequence:1,provider:'codex',
    action:'cx_56terra_medium',permission_profile:'read_only',expires_at:'2026-09-01T00:00:00.000Z',
    nonce:'n'.repeat(43),signature:'s'.repeat(86)};
  it('requires an exact schema and domain-separated registered-device signature', async () => {
    const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']) as CryptoKeyPair;
    const key = await crypto.subtle.exportKey('jwk',pair.publicKey);
    const signature = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,bytes)).toString('base64url');
    const value = {ticket,device_signature:await signature(attemptStartBytes(ticket))};
    expect(parseAttemptStart(value)).toEqual(value);
    expect(await verifyAttemptStart(value,key)).toBe(true);
    expect(await verifyAttemptStart({...value,ticket:{...ticket,sequence:2}},key)).toBe(false);
    expect(await verifyAttemptStart({...value,device_signature:await signature(canonicalResult({ticket,result_hash:'a'.repeat(64),artifact_ref:'r2://x',device_signature:''}))},key)).toBe(false);
    expect(() => parseAttemptStart({...value,execution_deadline:Date.now()+1e12})).toThrow();
  });
});
