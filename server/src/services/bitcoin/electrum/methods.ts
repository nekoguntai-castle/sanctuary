/**
 * Electrum Method Implementations
 *
 * High-level Electrum protocol methods: address history, balance,
 * UTXOs, transaction fetching/broadcasting, fee estimation,
 * subscriptions, and batch operations.
 *
 * These are implemented as standalone functions that take a
 * `requestFn` and `batchRequestFn` callback, keeping them
 * decoupled from the client class for testability.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import {
  AddressBalanceSchema,
  HistoryItemSchema,
  UtxoItemSchema,
  ServerVersionSchema,
  HeadersSubscribeSchema,
  validateResponse,
} from './types';
import type { TransactionDetails, BitcoinNetwork } from './types';

const log = createLogger('ELECTRUM');

// ==============================================================================
// NETWORK HELPERS
// ==============================================================================

/**
 * Get the bitcoinjs-lib network object for a given network name
 */
export function getNetworkLib(network: BitcoinNetwork): unknown {
  const bitcoin = require('bitcoinjs-lib');
  switch (network) {
    case 'testnet':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    case 'mainnet':
    default:
      return bitcoin.networks.bitcoin;
  }
}

/**
 * Convert Bitcoin address to Electrum scripthash.
 * Electrum uses reversed SHA256 hash of scriptPubKey.
 */
export function addressToScriptHash(address: string, network: BitcoinNetwork): string {
  const bitcoin = require('bitcoinjs-lib');

  // Decode address to get scriptPubKey (using the correct network)
  const script = bitcoin.address.toOutputScript(address, getNetworkLib(network));

  // SHA256 hash
  const hash = crypto.createHash('sha256').update(script).digest();

  // Reverse bytes for Electrum format
  const reversed = Buffer.from(hash).reverse();

  return reversed.toString('hex');
}

/**
 * Decode raw transaction hex to structured format
 */
export function decodeRawTransaction(rawTx: string, network: BitcoinNetwork): TransactionDetails {
  const bitcoin = require('bitcoinjs-lib');

  try {
    const tx = bitcoin.Transaction.fromHex(rawTx);

    // Build vout array with address info
    const vout = tx.outs.map((output: { script: Buffer; value: number }, index: number) => {
      let address: string | undefined;

      try {
        // Try to extract address from output script (using the correct network)
        address = bitcoin.address.fromOutputScript(output.script, getNetworkLib(network));
      } catch (_e) {
        // Some outputs (like OP_RETURN) don't have addresses
        log.debug('Could not extract address from output script (e.g., OP_RETURN)', { index });
      }

      return {
        value: output.value / 100000000, // Convert satoshis to BTC
        n: index,
        scriptPubKey: {
          hex: output.script.toString('hex'),
          address: address, // Single address for segwit
          addresses: address ? [address] : [], // Array for legacy compatibility
        },
      };
    });

    // Build vin array
    const vin = tx.ins.map((input: { hash: Buffer; index: number; sequence: number }) => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
      sequence: input.sequence,
    }));

    return {
      txid: tx.getId(),
      hash: tx.getHash().toString('hex'),
      version: tx.version,
      size: rawTx.length / 2,
      locktime: tx.locktime,
      vin,
      vout,
      hex: rawTx, // Include raw hex for RBF checking
    };
  } catch (error) {
    log.error('Failed to decode raw transaction', { error });
    throw new Error('Failed to decode transaction');
  }
}

// ==============================================================================
// REQUEST FUNCTION TYPES
// ==============================================================================

/** Function type for sending a single Electrum request */
export type RequestFn = (method: string, params?: unknown[]) => Promise<unknown>;

/** Function type for sending a batch of Electrum requests */
export type BatchRequestFn = (requests: Array<{ method: string; params: unknown[] }>) => Promise<unknown[]>;

// ==============================================================================
// SERVER METHODS
// ==============================================================================

/**
 * Get server version (should be called once per connection)
 */
export async function getServerVersion(
  requestFn: RequestFn
): Promise<{ server: string; protocol: string }> {
  const result = await requestFn('server.version', ['Sanctuary', '1.4']);
  const validated = validateResponse(ServerVersionSchema, result, 'getServerVersion');
  return {
    server: validated[0],
    protocol: validated[1],
  };
}

/**
 * Ping the server to keep connection alive.
 * Returns null on success (as per Electrum protocol).
 */
export async function ping(requestFn: RequestFn): Promise<null> {
  return requestFn('server.ping') as Promise<null>;
}

// ==============================================================================
// ADDRESS METHODS
// ==============================================================================

/**
 * Get address balance
 */
export async function getAddressBalance(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<{ confirmed: number; unconfirmed: number }> {
  const scriptHash = addressToScriptHash(address, network);
  const result = await requestFn('blockchain.scripthash.get_balance', [scriptHash]);
  return validateResponse(AddressBalanceSchema, result, `getAddressBalance(${address})`);
}

/**
 * Get address transaction history
 */
export async function getAddressHistory(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<Array<{ tx_hash: string; height: number }>> {
  const scriptHash = addressToScriptHash(address, network);
  const result = await requestFn('blockchain.scripthash.get_history', [scriptHash]);
  return validateResponse(z.array(HistoryItemSchema), result, `getAddressHistory(${address})`);
}

/**
 * Get address unspent outputs (UTXOs)
 */
export async function getAddressUTXOs(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>> {
  const scriptHash = addressToScriptHash(address, network);
  const result = await requestFn('blockchain.scripthash.listunspent', [scriptHash]);
  return validateResponse(z.array(UtxoItemSchema), result, `getAddressUTXOs(${address})`);
}

// ==============================================================================
// TRANSACTION METHODS
// ==============================================================================

/**
 * Get transaction details.
 * Always uses non-verbose mode and decodes locally to avoid error/retry overhead.
 */
export async function getTransaction(
  requestFn: RequestFn,
  txid: string,
  network: BitcoinNetwork
): Promise<TransactionDetails> {
  const rawTx = await requestFn('blockchain.transaction.get', [txid, false]);
  return decodeRawTransaction(rawTx as string, network);
}

/**
 * Broadcast transaction
 */
export async function broadcastTransaction(
  requestFn: RequestFn,
  rawTx: string
): Promise<string> {
  return requestFn('blockchain.transaction.broadcast', [rawTx]) as Promise<string>;
}

/**
 * Get fee estimate (in satoshis per byte)
 */
export async function estimateFee(
  requestFn: RequestFn,
  blocks: number = 6
): Promise<number> {
  const result = await requestFn('blockchain.estimatefee', [blocks]);
  // Convert from BTC/kB to sat/vB
  const satPerKb = (result as number) * 100000000;
  return Math.max(1, Math.round(satPerKb / 1000));
}

// ==============================================================================
// SUBSCRIPTION METHODS
// ==============================================================================

/**
 * Subscribe to address changes.
 * Returns the current status (hash of history) or null if no history.
 */
export async function subscribeAddress(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): Promise<string | null> {
  const scriptHash = addressToScriptHash(address, network);
  // Track the mapping so we can resolve address from notifications
  scriptHashToAddress.set(scriptHash, address);
  const result = await requestFn('blockchain.scripthash.subscribe', [scriptHash]);
  return result as string | null;
}

/**
 * Unsubscribe from address changes (clears local tracking only)
 */
export function unsubscribeAddress(
  address: string,
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): void {
  const scriptHash = addressToScriptHash(address, network);
  scriptHashToAddress.delete(scriptHash);
}

/**
 * Subscribe to new block headers.
 * Also returns current tip height.
 */
export async function subscribeHeaders(
  requestFn: RequestFn
): Promise<{ height: number; hex: string }> {
  const result = await requestFn('blockchain.headers.subscribe');
  return validateResponse(HeadersSubscribeSchema, result, 'subscribeHeaders');
}

/**
 * Get block header
 */
export async function getBlockHeader(
  requestFn: RequestFn,
  height: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electrum returns varying formats per server implementation
): Promise<any> {
  return requestFn('blockchain.block.header', [height]);
}

/**
 * Get current block height
 */
export async function getBlockHeight(
  requestFn: RequestFn
): Promise<number> {
  const headers = await requestFn('blockchain.headers.subscribe') as { height: number };
  return headers.height;
}

/**
 * Test if server supports verbose transaction responses.
 * Returns true if server returns parsed JSON with vin/vout fields.
 */
export async function testVerboseSupport(
  requestFn: RequestFn,
  testTxid?: string
): Promise<boolean> {
  try {
    // Use the genesis coinbase tx as a test - exists on all Bitcoin networks
    const txid = testTxid || '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

    // Try verbose request (second param = true)
    const result = await requestFn('blockchain.transaction.get', [txid, true]);

    // If we get an object with 'vin' or 'vout' fields, server supports verbose
    if (result && typeof result === 'object' && ((result as Record<string, unknown>).vin || (result as Record<string, unknown>).vout)) {
      return true;
    }

    // Got raw hex string - doesn't support verbose
    return false;
  } catch (_error) {
    // Request failed - server doesn't support verbose
    log.debug('Verbose transaction support test failed', { error: getErrorMessage(_error) });
    return false;
  }
}

// ==============================================================================
// BATCH METHODS
// ==============================================================================

/**
 * Batch: Subscribe to multiple addresses in a single RPC batch.
 * Returns a Map of address -> status (hash of history, or null if no history).
 */
export async function subscribeAddressBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): Promise<Map<string, string | null>> {
  if (addresses.length === 0) return new Map();

  // Prepare batch requests and track mappings
  const requests = addresses.map(address => {
    const scriptHash = addressToScriptHash(address, network);
    // Track the mapping so we can resolve address from notifications
    scriptHashToAddress.set(scriptHash, address);
    return {
      method: 'blockchain.scripthash.subscribe',
      params: [scriptHash],
    };
  });

  // Execute batch
  const results = await batchRequestFn(requests);

  // Map results back to addresses
  const resultMap = new Map<string, string | null>();
  for (let i = 0; i < addresses.length; i++) {
    resultMap.set(addresses[i], (results[i] as string | null) || null);
  }

  return resultMap;
}

/**
 * Batch: Get transaction history for multiple addresses in a single RPC batch.
 * Returns a Map of address -> history array.
 */
export async function getAddressHistoryBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork
): Promise<Map<string, Array<{ tx_hash: string; height: number }>>> {
  if (addresses.length === 0) return new Map();

  // Prepare batch requests
  const requests = addresses.map(address => ({
    method: 'blockchain.scripthash.get_history',
    params: [addressToScriptHash(address, network)],
  }));

  // Execute batch
  const results = await batchRequestFn(requests);

  // Map results back to addresses
  const resultMap = new Map<string, Array<{ tx_hash: string; height: number }>>();
  for (let i = 0; i < addresses.length; i++) {
    resultMap.set(addresses[i], (results[i] as Array<{ tx_hash: string; height: number }>) || []);
  }

  return resultMap;
}

/**
 * Batch: Get UTXOs for multiple addresses in a single RPC batch.
 * Returns a Map of address -> UTXO array.
 */
export async function getAddressUTXOsBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork
): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>> {
  if (addresses.length === 0) return new Map();

  // Prepare batch requests
  const requests = addresses.map(address => ({
    method: 'blockchain.scripthash.listunspent',
    params: [addressToScriptHash(address, network)],
  }));

  // Execute batch
  const results = await batchRequestFn(requests);

  // Map results back to addresses
  const resultMap = new Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>();
  for (let i = 0; i < addresses.length; i++) {
    resultMap.set(addresses[i], (results[i] as Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>) || []);
  }

  return resultMap;
}

/**
 * Batch: Get multiple transactions in a single RPC batch.
 * Returns a Map of txid -> transaction data.
 */
export async function getTransactionsBatch(
  batchRequestFn: BatchRequestFn,
  txids: string[],
  network: BitcoinNetwork,
  batchRequestTimeoutMs: number
): Promise<Map<string, TransactionDetails>> {
  if (txids.length === 0) return new Map();

  // Always use non-verbose mode since Blockstream (and other electrs) doesn't support verbose
  // This avoids the verbose error and retry overhead
  const useVerbose = false;

  // Prepare batch requests
  const requests = txids.map(txid => ({
    method: 'blockchain.transaction.get',
    params: [txid, useVerbose],
  }));

  // Execute batch with retry for timeouts
  let results!: unknown[];
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      results = await batchRequestFn(requests);
      // Decode raw transactions since we're using non-verbose mode
      results = results.map(rawTx => decodeRawTransaction(rawTx as string, network));
      break;
    } catch (error) {
      // If timeout, retry after delay
      if (getErrorMessage(error).includes('timeout')) {
        log.warn(`Batch transaction fetch timeout, attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
      }
      throw error;
    }
  }

  // Map results back to txids
  const resultMap = new Map<string, TransactionDetails>();
  for (let i = 0; i < txids.length; i++) {
    if (results[i]) {
      resultMap.set(txids[i], results[i] as TransactionDetails);
    }
  }

  return resultMap;
}
