/**
 * Electrum Public API
 *
 * Public API method implementations that delegate to the methods module.
 * The class calls these functions, passing its request/batchRequest callbacks.
 *
 * Also contains getTransactionsBatch which is implemented inline (rather than
 * in the methods module) because it calls decodeRawTransaction which tests
 * spy on via (client as any).
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import * as methods from './methods';
import type { TransactionDetails, BitcoinNetwork } from './types';

const log = createLogger('ELECTRUM');

/** Callback type for single requests */
export type RequestFn = (method: string, params?: unknown[]) => Promise<unknown>;

/** Callback type for batch requests */
export type BatchRequestFn = (requests: Array<{ method: string; params: unknown[] }>) => Promise<unknown[]>;

/** Callback for decoding raw transactions (bound to the class instance for test spying) */
export type DecodeRawTxFn = (rawTx: string) => TransactionDetails;

/**
 * Get server version (results are cached in the class)
 */
export async function getServerVersion(
  requestFn: RequestFn
): Promise<{ server: string; protocol: string }> {
  return methods.getServerVersion(requestFn);
}

/**
 * Ping the server to keep connection alive
 */
export async function ping(requestFn: RequestFn): Promise<null> {
  return methods.ping(requestFn);
}

/**
 * Get address balance
 */
export async function getAddressBalance(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<{ confirmed: number; unconfirmed: number }> {
  return methods.getAddressBalance(requestFn, address, network);
}

/**
 * Get address transaction history
 */
export async function getAddressHistory(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<Array<{ tx_hash: string; height: number }>> {
  return methods.getAddressHistory(requestFn, address, network);
}

/**
 * Get address unspent outputs (UTXOs)
 */
export async function getAddressUTXOs(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork
): Promise<Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>> {
  return methods.getAddressUTXOs(requestFn, address, network);
}

/**
 * Get transaction details
 */
export async function getTransaction(
  requestFn: RequestFn,
  txid: string,
  network: BitcoinNetwork
): Promise<TransactionDetails> {
  return methods.getTransaction(requestFn, txid, network);
}

/**
 * Broadcast transaction
 */
export async function broadcastTransaction(
  requestFn: RequestFn,
  rawTx: string
): Promise<string> {
  return methods.broadcastTransaction(requestFn, rawTx);
}

/**
 * Get fee estimate (in satoshis per byte)
 */
export async function estimateFee(
  requestFn: RequestFn,
  blocks: number
): Promise<number> {
  return methods.estimateFee(requestFn, blocks);
}

/**
 * Subscribe to address changes
 */
export async function subscribeAddress(
  requestFn: RequestFn,
  address: string,
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): Promise<string | null> {
  return methods.subscribeAddress(requestFn, address, network, scriptHashToAddress);
}

/**
 * Unsubscribe from address changes (clears local tracking only)
 */
export function unsubscribeAddress(
  address: string,
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): void {
  methods.unsubscribeAddress(address, network, scriptHashToAddress);
}

/**
 * Batch: Subscribe to multiple addresses in a single RPC batch
 */
export async function subscribeAddressBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork,
  scriptHashToAddress: Map<string, string>
): Promise<Map<string, string | null>> {
  return methods.subscribeAddressBatch(batchRequestFn, addresses, network, scriptHashToAddress);
}

/**
 * Subscribe to new block headers
 */
export async function subscribeHeaders(
  requestFn: RequestFn
): Promise<{ height: number; hex: string }> {
  return methods.subscribeHeaders(requestFn);
}

/**
 * Get block header
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electrum returns varying formats per server implementation
export async function getBlockHeader(
  requestFn: RequestFn,
  height: number
): Promise<any> {
  return methods.getBlockHeader(requestFn, height);
}

/**
 * Get current block height
 */
export async function getBlockHeight(
  requestFn: RequestFn
): Promise<number> {
  return methods.getBlockHeight(requestFn);
}

/**
 * Test if server supports verbose transaction responses
 */
export async function testVerboseSupport(
  requestFn: RequestFn,
  testTxid?: string
): Promise<boolean> {
  return methods.testVerboseSupport(requestFn, testTxid);
}

/**
 * Batch: Get transaction history for multiple addresses
 */
export async function getAddressHistoryBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork
): Promise<Map<string, Array<{ tx_hash: string; height: number }>>> {
  return methods.getAddressHistoryBatch(batchRequestFn, addresses, network);
}

/**
 * Batch: Get UTXOs for multiple addresses
 */
export async function getAddressUTXOsBatch(
  batchRequestFn: BatchRequestFn,
  addresses: string[],
  network: BitcoinNetwork
): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>> {
  return methods.getAddressUTXOsBatch(batchRequestFn, addresses, network);
}

/**
 * Batch: Get multiple transactions in a single RPC batch.
 * Returns a Map of txid -> transaction data.
 *
 * Note: This method uses decodeRawTxFn callback because tests spy on
 * the class's decodeRawTransaction via (client as any).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches NodeClientInterface signature
export async function getTransactionsBatch(
  batchRequestFn: BatchRequestFn,
  decodeRawTxFn: DecodeRawTxFn,
  txids: string[]
): Promise<Map<string, any>> {
  if (txids.length === 0) return new Map();

  // Always use non-verbose mode since Blockstream (and other electrs) doesn't support verbose
  const useVerbose = false;

  const requests = txids.map(txid => ({
    method: 'blockchain.transaction.get',
    params: [txid, useVerbose] as unknown[],
  }));

  // Execute batch with retry for timeouts
  let results!: unknown[];
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      results = await batchRequestFn(requests);
      // Decode raw transactions since we're using non-verbose mode
      results = results.map(rawTx => decodeRawTxFn(rawTx as string));
      break;
    } catch (error) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches NodeClientInterface signature
  const resultMap = new Map<string, any>();
  for (let i = 0; i < txids.length; i++) {
    if (results[i]) {
      resultMap.set(txids[i], results[i]);
    }
  }

  return resultMap;
}
