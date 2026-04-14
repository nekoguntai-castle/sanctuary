/**
 * Bitcoin Utilities (Server)
 *
 * Helper functions for Bitcoin operations like address validation,
 * unit conversion, and transaction building.
 *
 * Re-exports shared utilities and adds server-specific functions
 * that require bitcoinjs-lib for cryptographic operations.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { INPUT_VBYTES, OUTPUT_VBYTES, OVERHEAD_VBYTES } from './constants';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

// Import and re-export shared utilities
import {
  satsToBTC,
  btcToSats,
  formatSats as sharedFormatSats,
  formatBTC as sharedFormatBTC,
  SATS_PER_BTC,
} from '../../../../shared/utils/bitcoin';
import type { NetworkType, AddressType } from '../../../../shared/constants/bitcoin';

export { satsToBTC, btcToSats, SATS_PER_BTC, NetworkType, AddressType };

const log = createLogger('BITCOIN:SVC_UTILS');

// Initialize ECC library for Taproot/P2TR support
// This is required by bitcoinjs-lib v6+ for bech32m address validation
bitcoin.initEccLib(ecc);

/**
 * Validate Bitcoin address
 */
export function validateAddress(
  address: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): { valid: boolean; error?: string } {
  try {
    const networkObj = getNetwork(network);
    bitcoin.address.toOutputScript(address, networkObj);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: getErrorMessage(error, 'Invalid Bitcoin address'),
    };
  }
}

/**
 * Get Bitcoin network object
 */
export function getNetwork(
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): bitcoin.Network {
  switch (network) {
    case 'testnet':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}

/**
 * Get address type
 */
export function getAddressType(address: string): string {
  if (!address || typeof address !== 'string') {
    return 'Invalid';
  }
  if (address.startsWith('bc1q') || address.startsWith('tb1q')) {
    return 'P2WPKH'; // Native SegWit (Bech32)
  } else if (address.startsWith('bc1p') || address.startsWith('tb1p')) {
    return 'P2TR'; // Taproot
  } else if (address.startsWith('3') || address.startsWith('2')) {
    return 'P2SH'; // Nested SegWit or Multisig
  } else if (address.startsWith('1') || address.startsWith('m') || address.startsWith('n')) {
    return 'P2PKH'; // Legacy
  } else {
    return 'Unknown';
  }
}

/**
 * Calculate transaction size (in vBytes)
 * Estimate based on input/output count
 */
export function estimateTransactionSize(
  inputCount: number,
  outputCount: number,
  scriptType: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot' = 'native_segwit'
): number {
  const inputSize = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  const size = OVERHEAD_VBYTES + inputCount * inputSize + outputCount * OUTPUT_VBYTES;
  return size;
}

/**
 * Calculate transaction fee
 */
export function calculateFee(sizeVBytes: number, feeRate: number): number {
  return Math.ceil(sizeVBytes * feeRate);
}

/**
 * Format satoshis for display
 * Re-exports shared utility
 */
export const formatSats = sharedFormatSats;

/**
 * Format BTC for display
 * Re-exports shared utility (without trim feature for backward compatibility)
 */
export function formatBTC(btc: number, decimals: number = 8): string {
  return sharedFormatBTC(btc, decimals, false);
}

/**
 * Parse transaction hex to get details
 */
export function parseTransaction(
  txHex: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  vsize: number;
  inputs: Array<{
    txid: string;
    vout: number;
    sequence: number;
  }>;
  outputs: Array<{
    value: number;
    scriptPubKey: string;
    address?: string;
  }>;
} {
  const networkObj = getNetwork(network);
  const tx = bitcoin.Transaction.fromHex(txHex);

  const inputs = tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
    sequence: input.sequence,
  }));

  const outputs = tx.outs.map((output) => {
    let address: string | undefined;
    try {
      address = bitcoin.address.fromOutputScript(output.script, networkObj);
    } catch (error) {
      log.debug('Transaction output has no standard address', { error: String(error) });
      // OP_RETURN and other non-address outputs are expected
    }

    return {
      value: Number(output.value),
      scriptPubKey: Buffer.from(output.script).toString('hex'),
      address,
    };
  });

  return {
    txid: tx.getId(),
    version: tx.version,
    locktime: tx.locktime,
    size: tx.byteLength(),
    weight: tx.weight(),
    vsize: tx.virtualSize(),
    inputs,
    outputs,
  };
}

/**
 * Create a payment transaction with RBF support
 */
export function createTransaction(
  inputs: Array<{
    txid: string;
    vout: number;
    value: number;
    scriptPubKey: string;
  }>,
  outputs: Array<{
    address: string;
    value: number;
  }>,
  feeRate: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    enableRBF?: boolean;
  } = {}
): {
  psbt: bitcoin.Psbt;
  fee: number;
  totalInput: number;
  totalOutput: number;
} {
  const network = options.network || 'mainnet';
  const enableRBF = options.enableRBF ?? true; // RBF enabled by default
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // RBF sequence value (0xfffffffd signals RBF)
  const sequence = enableRBF ? 0xfffffffd : 0xffffffff;

  // Add inputs
  let totalInput = 0;
  for (const input of inputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      sequence,
      witnessUtxo: {
        script: Buffer.from(input.scriptPubKey, 'hex'),
        value: BigInt(input.value),
      },
    });
    totalInput += input.value;
  }

  // Add outputs
  let totalOutput = 0;
  for (const output of outputs) {
    psbt.addOutput({
      address: output.address,
      value: BigInt(output.value),
    });
    totalOutput += output.value;
  }

  // Calculate fee
  const estimatedSize = estimateTransactionSize(inputs.length, outputs.length, 'native_segwit');
  const fee = calculateFee(estimatedSize, feeRate);

  return {
    psbt,
    fee,
    totalInput,
    totalOutput,
  };
}
