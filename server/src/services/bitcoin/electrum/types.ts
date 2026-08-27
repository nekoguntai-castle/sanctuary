/**
 * Electrum Client Types & Zod Schemas
 *
 * Type definitions and validation schemas for Electrum protocol responses.
 * All Zod schemas are used to validate data received from Electrum servers
 * before it is used by the application.
 */

import { z } from 'zod';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ELECTRUM:SVC');
const ELECTRUM_STATUS_PATTERN = /^[0-9a-f]{64}$/;

/** Untrusted Electrum payload failed its structural or semantic contract. */
export class ElectrumResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElectrumResponseValidationError';
  }
}

/** Electrum protocol limit for `blockchain.block.headers` responses. */
export const ELECTRUM_MAX_HEADERS_PER_REQUEST = 2016;
export const BITCOIN_BLOCK_HEADER_HEX_LENGTH = 160;

/** Parse the only two authoritative scripthash subscription status forms. */
export function parseElectrumSubscriptionStatus(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string' && ELECTRUM_STATUS_PATTERN.test(value)) return value;
  return undefined;
}

// ==============================================================================
// ZOD SCHEMAS FOR ELECTRUM RESPONSE VALIDATION
// ==============================================================================

/**
 * Electrum JSON-RPC response schema
 */
export const ElectrumResponseSchema = z.object({
  jsonrpc: z.string(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
  id: z.union([z.number(), z.null()]),
  method: z.string().optional(),
  params: z.array(z.unknown()).optional(),
});

/**
 * Address balance response schema
 */
export const AddressBalanceSchema = z.object({
  confirmed: z.number(),
  unconfirmed: z.number(),
});

/**
 * Address history item schema
 */
export const HistoryItemSchema = z.object({
  tx_hash: z.string().length(64),
  height: z.number(),
});

/**
 * UTXO item schema
 */
export const UtxoItemSchema = z.object({
  tx_hash: z.string().length(64),
  tx_pos: z.number().int().min(0),
  height: z.number(),
  value: z.number().int().min(0), // Satoshis
});

/**
 * Server version response schema (array format)
 */
export const ServerVersionSchema = z.tuple([z.string(), z.string()]);

/**
 * Server feature response schema.
 */
export const ServerFeaturesSchema = z.record(z.string(), z.unknown());

/**
 * A Bitcoin block header is exactly 80 bytes, so 160 hex characters. Pinning the
 * length matters because `Buffer.from(hex, 'hex')` truncates silently at the
 * first invalid pair, so an unconstrained string would hash to a valid-looking
 * digest of the wrong bytes.
 */
export const BlockHeaderHexSchema = z.string().regex(
  /^[0-9a-fA-F]{160}$/,
  'expected a 160-character hex block header (80 bytes)',
);

/**
 * Raw `blockchain.block.headers` response. The dynamic relationship between
 * `count` and `hex` is checked by the method because it also depends on the
 * exact range requested by the caller.
 */
export const BlockHeadersResponseSchema = z.object({
  count: z.number().int().min(0).max(ELECTRUM_MAX_HEADERS_PER_REQUEST),
  hex: z.string()
    .max(ELECTRUM_MAX_HEADERS_PER_REQUEST * BITCOIN_BLOCK_HEADER_HEX_LENGTH)
    .regex(/^[0-9a-fA-F]*$/, 'expected hexadecimal block headers'),
  max: z.number().int().min(1).max(ELECTRUM_MAX_HEADERS_PER_REQUEST).optional(),
}).strict();

/**
 * Block headers subscribe response schema.
 *
 * Startup now consumes the complete header through the same reconciliation
 * boundary as notifications, and a malformed response tears down/retries the
 * connection instead of leaving it permanently unsubscribed.
 */
export const HeadersSubscribeSchema = z.object({
  height: z.number().int().min(0),
  hex: BlockHeaderHexSchema,
});

/**
 * Header pushed by `blockchain.headers.subscribe`. Same payload as the subscribe
 * response, but it arrives unsolicited from a server we do not control AND is
 * consumed in full: the height feeds the process tip cache that confirmation
 * counts derive from, and the hex is hashed into the block identity used as a
 * confirmation job id. So it is validated strictly at the point of receipt.
 */
export const BlockHeaderNotificationSchema = z.object({
  height: z.number().int().min(0),
  hex: BlockHeaderHexSchema,
});

// ==============================================================================
// VALIDATION HELPER
// ==============================================================================

/**
 * Safe validation helper that logs warnings for invalid data
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    log.warn(`Electrum response validation failed: ${context}`, {
      errors: result.error.issues.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
      dataPreview: JSON.stringify(data).substring(0, 200),
    });
    // Throw to let caller handle - invalid data shouldn't be silently used
    throw new ElectrumResponseValidationError(
      `Invalid Electrum response for ${context}: ${result.error.issues[0]?.message}`,
    );
  }
  return result.data;
}

// ==============================================================================
// TYPESCRIPT INTERFACES
// ==============================================================================

/**
 * SOCKS5 proxy configuration (for Tor support)
 */
export interface ProxyConfig {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ElectrumResponse {
  jsonrpc: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
  id: number | null;
  method?: string;  // For subscription notifications
  params?: unknown[];   // For subscription notifications
}

export interface ElectrumRequest {
  jsonrpc: string;
  method: string;
  params: unknown[];
  id: number;
}

export interface ElectrumConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
  network?: BitcoinNetwork; // Bitcoin network (default: mainnet)
  allowSelfSignedCert?: boolean; // Optional: allow self-signed TLS certificates (default: false)
  connectionTimeoutMs?: number; // Optional: connection/handshake timeout (default: 10000ms)
  proxy?: ProxyConfig; // Optional: SOCKS5 proxy configuration (for Tor)
  requestTimeoutMs?: number; // Optional: per-request timeout (default: 30000ms, higher for Tor)
  batchRequestTimeoutMs?: number; // Optional: batch request timeout (default: 60000ms, higher for Tor)
}

export type ElectrumServerFeatures = Record<string, unknown>;

/**
 * Script public key info in transaction output
 */
export interface ScriptPubKey {
  hex: string;
  address?: string;
  addresses: string[];
}

/**
 * Previous output reference in transaction input (verbose mode)
 */
export interface PrevOut {
  value: number;
  scriptPubKey: ScriptPubKey;
}

/**
 * Transaction input from decoded raw transaction
 */
export interface TransactionInput {
  txid: string;
  vout: number;
  sequence: number;
  coinbase?: string; // For coinbase transactions
  scriptSig?: { hex: string; asm?: string };
  txinwitness?: string[];
  prevout?: PrevOut; // Available in verbose mode
}

/**
 * Transaction output from decoded raw transaction
 */
export interface TransactionOutput {
  value: number; // In BTC
  n: number;
  scriptPubKey: ScriptPubKey;
}

/**
 * Decoded transaction details
 */
export interface TransactionDetails {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize?: number;
  weight?: number;
  locktime: number;
  vin: TransactionInput[];
  vout: TransactionOutput[];
  hex: string;
  blockhash?: string;
  blockheight?: number;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

/** Bitcoin network type */
export type BitcoinNetwork = NetworkType;

/**
 * Pending request tracking structure
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  method?: string;
  params?: unknown[];
  cleanup?: () => void;
}
