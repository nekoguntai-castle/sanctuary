import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const DIAGNOSTICS_TIMESTAMP_HEADER = 'x-sanctuary-timestamp';
export const DIAGNOSTICS_NONCE_HEADER = 'x-sanctuary-nonce';
export const DIAGNOSTICS_SIGNATURE_HEADER = 'x-sanctuary-signature';

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface DiagnosticsAuthHeaders {
  timestamp: string;
  nonce: string;
  signature: string;
}

export interface ReplayGuard {
  accept(nonce: string, nowMs: number): boolean;
}

function bodyDigest(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function canonicalMessage(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  // Bind every security-relevant request component so a valid signature cannot
  // be replayed against another method, route, timestamp, nonce, or body. Newline
  // separation is unambiguous here: method/path are fixed by the internal client,
  // timestamps are integers, nonces exclude separators, and the body is a hex digest.
  return [method.toUpperCase(), path, timestamp, nonce, bodyDigest(body)].join('\n');
}

function signatureFor(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalMessage(method, path, timestamp, nonce, body), 'utf8')
    .digest('hex');
}

export function signDiagnosticsRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  nowMs = Date.now(),
  nonce = randomBytes(16).toString('hex'),
): DiagnosticsAuthHeaders {
  const timestamp = String(nowMs);
  return {
    timestamp,
    nonce,
    signature: signatureFor(secret, method, path, timestamp, nonce, body),
  };
}

/**
 * Verify a request without throwing. The caller must reuse one process-local
 * replay guard and choose a freshness window that covers only expected clock skew.
 */
export function verifyDiagnosticsRequest(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  headers: Partial<DiagnosticsAuthHeaders>;
  nowMs: number;
  freshnessWindowMs: number;
  replayGuard: ReplayGuard;
}): boolean {
  const { timestamp, nonce, signature } = input.headers;
  if (!timestamp || !nonce || !signature) return false;
  if (!NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) return false;

  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt)) return false;
  if (Math.abs(input.nowMs - signedAt) > input.freshnessWindowMs) return false;

  const expected = signatureFor(
    input.secret,
    input.method,
    input.path,
    timestamp,
    nonce,
    input.body,
  );
  const suppliedBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  // SIGNATURE_PATTERN fixes the supplied value at 32 bytes, matching SHA-256;
  // preserve that invariant if the accepted signature encoding ever changes.
  if (!timingSafeEqual(suppliedBytes, expectedBytes)) return false;

  return input.replayGuard.accept(nonce, input.nowMs);
}
