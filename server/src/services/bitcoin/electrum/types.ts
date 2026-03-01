/**
 * Electrum Client Types & Zod Schemas
 *
 * Type definitions and validation schemas for Electrum protocol responses.
 * All Zod schemas are used to validate data received from Electrum servers
 * before it is used by the application.
 */

import { z } from 'zod';
import { createLogger } from '../../../utils/logger';

const log = createLogger('ELECTRUM');

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
 * Block headers subscribe response schema
 */
export const HeadersSubscribeSchema = z.object({
  height: z.number().int().min(0),
  hex: z.string(),
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
    throw new Error(`Invalid Electrum response for ${context}: ${result.error.issues[0]?.message}`);
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
  network?: 'mainnet' | 'testnet' | 'signet' | 'regtest'; // Bitcoin network (default: mainnet)
  allowSelfSignedCert?: boolean; // Optional: allow self-signed TLS certificates (default: false)
  connectionTimeoutMs?: number; // Optional: connection/handshake timeout (default: 10000ms)
  proxy?: ProxyConfig; // Optional: SOCKS5 proxy configuration (for Tor)
  requestTimeoutMs?: number; // Optional: per-request timeout (default: 30000ms, higher for Tor)
  batchRequestTimeoutMs?: number; // Optional: batch request timeout (default: 60000ms, higher for Tor)
}

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
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';

/**
 * Pending request tracking structure
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}
