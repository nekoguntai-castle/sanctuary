/**
 * Final privacy boundary for downloadable support packages.
 *
 * Collector schemas provide the primary allowlist. This module then validates
 * the complete envelope, canonicalizes it, enforces byte limits, and scans the
 * exact bytes that would be returned to an administrator.
 */
import { z } from 'zod';
import {
  SUPPORT_PACKAGE_FAILURE_CODES,
  SUPPORT_PACKAGE_AUTHORITIES,
  SUPPORT_PACKAGE_SOURCE_KINDS,
  SUPPORT_PACKAGE_SOURCE_PROCESSES,
  type SupportPackage,
} from './types';

/** Hard limits keep diagnostics bounded before they cross the HTTP boundary. */
export const MAX_SUPPORT_PACKAGE_BYTES = 256 * 1024;
export const MAX_COLLECTOR_BYTES = 16 * 1024;

const boundedText = z.string().min(1).max(64);
const provenanceSchema = z.object({
  collectorProcess: z.literal('api'),
  sourceProcess: z.enum(SUPPORT_PACKAGE_SOURCE_PROCESSES),
  sourceKind: z.enum(SUPPORT_PACKAGE_SOURCE_KINDS),
  sampledAt: z.iso.datetime(),
  dataAsOf: z.iso.datetime(),
  observationWindow: z.literal('point_in_time'),
  authoritativeFor: z.array(z.enum(SUPPORT_PACKAGE_AUTHORITIES)).max(16),
  notAuthoritativeFor: z.array(z.enum(SUPPORT_PACKAGE_AUTHORITIES)).max(16),
}).strict();

const sectionBase = {
  durationMs: z.number().int().min(0).max(60_000),
  truncated: z.boolean(),
  droppedCount: z.number().int().min(0).max(1_000_000),
  provenance: provenanceSchema,
};

export const collectorFailureSchema = z.object({
  status: z.literal('error'),
  ...sectionBase,
  error: z.enum(SUPPORT_PACKAGE_FAILURE_CODES),
}).strict();

export const supportPackageMetaSchema = z.object({
  totalDurationMs: z.number().int().min(0).max(60_000),
  succeeded: z.array(boundedText).max(32),
  failed: z.array(boundedText).max(32),
}).strict();

/** Build the exact aggregate schema from the explicitly admitted collectors. */
export function buildSupportPackageSchema(collectorSchemas: Record<string, z.ZodType>) {
  const sections = Object.fromEntries(Object.entries(collectorSchemas).map(([name, schema]) => [
    name,
    z.union([
      z.object({ status: z.literal('ok'), ...sectionBase, data: schema }).strict(),
      collectorFailureSchema,
    ]).optional(),
  ]));

  return z.object({
    version: z.literal('2.0.0'),
    profile: z.literal('shareable_aggregate'),
    generatedAt: z.iso.datetime(),
    serverVersion: boundedText,
    collectors: z.object(sections).strict(),
    meta: supportPackageMetaSchema,
  }).strict();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
  );
}

// These patterns are intentionally conservative defense in depth. Exact,
// strict collector schemas are the primary false-positive control. Coverage
// includes BIP-173/BIP-350 Bech32 families, Base58Check P2PKH/P2SH addresses,
// BIP-32 extended keys plus common SLIP-132 prefixes, and 32-byte hex values.
// Key-name matching is deliberate: sensitive-domain field names indicate that
// a collector's allowlist needs privacy review even when a sample value is safe.
const FORBIDDEN_BYTE_PATTERNS = [
  /\b(?:https?|postgres(?:ql)?|redis):\/\/[^\s"/]+:[^\s"@]+@/i,
  /\b(?:xpub|xprv|tpub|tprv|ypub|yprv|zpub|zprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/,
  /\b(?:bc1|tb1|bcrt1)[ac-hj-np-z02-9]{20,}\b/i,
  /\b[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}\b/,
  /\b[a-f0-9]{64}\b/i,
  /(?:password|passphrase|secret|token|apiKey|privateKey|databaseUrl|redisUrl|walletId|userId|txid|jobId)/i,
];

const SENSITIVE_ENVIRONMENT_KEYS = [
  'BITCOIN_RPC_PASSWORD',
  'BITCOIN_RPC_USER',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'ENCRYPTION_SALT',
  'GATEWAY_SECRET',
  'JWT_SECRET',
  'LLM_EGRESS_PROXY_SECRET',
  'REDIS_URL',
] as const;

/**
 * Derive common encodings of current process secrets without retaining them.
 * Values are read for every generation so runtime secret changes are covered;
 * very short values are skipped because they cannot be matched precisely.
 */
function knownSensitiveEncodings(): string[] {
  const encoded = new Set<string>();
  for (const key of SENSITIVE_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (!value || value.length < 8) continue;
    encoded.add(value);
    encoded.add(encodeURIComponent(value));
    encoded.add(Buffer.from(value, 'utf8').toString('base64'));
    encoded.add(JSON.stringify(value).slice(1, -1));
  }
  return [...encoded];
}

/** Fixed-code failure raised when export cannot be proven privacy-safe. */
export class SupportPackagePrivacyError extends Error {}

/** Validate and serialize the exact bytes safe to send to the requester. */
export function serializeShareablePackage(pkg: SupportPackage): Buffer {
  let json: string;
  try {
    json = JSON.stringify(canonicalize(pkg));
  } catch {
    throw new SupportPackagePrivacyError('support_package_serialization_failed');
  }
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.byteLength > MAX_SUPPORT_PACKAGE_BYTES) {
    throw new SupportPackagePrivacyError('support_package_size_exceeded');
  }
  const containsForbiddenPattern = FORBIDDEN_BYTE_PATTERNS.some((pattern) => pattern.test(json));
  const containsKnownSecret = knownSensitiveEncodings().some((value) => json.includes(value));
  if (containsForbiddenPattern || containsKnownSecret) {
    throw new SupportPackagePrivacyError('support_package_privacy_policy_violation');
  }
  return bytes;
}
