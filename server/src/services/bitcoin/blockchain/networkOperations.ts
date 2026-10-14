/**
 * Network Operations
 *
 * High-level blockchain network operations: broadcasting transactions,
 * fee estimation, transaction details, address monitoring, and address checking.
 */

import { getNodeClient } from '../nodeClient';
import type { TransactionDetails } from '../electrum';
import { ElectrumNoFeeEstimateError, ElectrumRpcError } from '../electrum/types';
import { validateAddress } from '../utils';
import type { BitcoinNetwork } from '../networks';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { FeeEstimates, CheckAddressResult } from './types';
import { BroadcastPreflightError, verifyElectrumBroadcastPreflight } from './broadcastPreflight';
import type { ValidatedBroadcastArtifact } from '../signingIntent/artifactValidation';

const log = createLogger('BITCOIN:SVC_BLOCKCHAIN');

/**
 * Broadcast a transaction to the selected network.
 *
 * `allowDefiniteRejection` is true only for a first claim: a resumed claim may
 * already have crossed the node boundary, so a rejection is never definite.
 */
export async function broadcastTransaction(
  artifact: ValidatedBroadcastArtifact,
  allowDefiniteRejection = false,
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  return broadcastAuthenticatedRawTransaction({
    rawTx: artifact.rawTx,
    network: artifact.network,
    expectedTxid: artifact.txid,
    replacement: Boolean(artifact.snapshot.transaction.replacementTxid),
    allowDefiniteRejection,
  });
}

export class DefiniteBroadcastRejectionError extends Error {}

/** Node policy/consensus rejections that a retry of the same bytes cannot change. */
const DEFINITE_REJECTION_FRAGMENTS = [
  'min relay fee not met',
  'mempool min fee not met',
  'insufficient fee',
  'dust',
  'txn-mempool-conflict',
  'non-mandatory-script-verify-flag',
  'mandatory-script-verify-flag',
  'non-final',
];

/** Node answers that are verdicts but not proof of rejection (the tx may be known or the parent racing). */
const AMBIGUOUS_VERDICT_FRAGMENTS = ['missingorspent', 'already in block chain', 'txn-already-known'];

const isDefiniteRejectionMessage = (message: string): boolean => {
  const text = message.toLowerCase();
  if (text.includes('bad-txns-') && !text.includes('bad-txns-inputs-missingorspent')) return true;
  return DEFINITE_REJECTION_FRAGMENTS.some(fragment => text.includes(fragment));
};

const isNodeVerdictMessage = (message: string): boolean => {
  const text = message.toLowerCase();
  return isDefiniteRejectionMessage(text) || AMBIGUOUS_VERDICT_FRAGMENTS.some(fragment => text.includes(fragment));
};

/** True only for an Electrum RPC answer carrying a definite policy/consensus rejection. */
export const isDefiniteNodeRejection = (error: unknown): boolean =>
  error instanceof ElectrumRpcError && isDefiniteRejectionMessage(error.message);

const withCause = (message: string, cause: unknown): Error => Object.assign(new Error(message), { cause });

/**
 * True when an "outcome is unknown" failure carries a node answer (a verdict
 * RPC error, or a preflight rejection built from node data) rather than a
 * transport/timeout failure. Only node-answered attempts count toward the
 * reconciler cap.
 */
export const isNodeAnsweredBroadcastFailure = (error: unknown): boolean => {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof ElectrumRpcError) return isNodeVerdictMessage(cause.message);
  if (cause instanceof BroadcastPreflightError) {
    return cause.reason === 'node_preflight_rejected' || cause.reason === 'invalid_raw_transaction';
  }
  return false;
};

export async function broadcastAuthenticatedRawTransaction(input: {
  rawTx: string;
  network: BitcoinNetwork;
  expectedTxid: string;
  replacement: boolean;
  allowDefiniteRejection?: boolean;
}): Promise<{ txid: string; broadcasted: boolean }> {
  const { rawTx, network, expectedTxid } = input;
  const allowDefiniteRejection = input.allowDefiniteRejection ?? false;
  const client = await getNodeClient(network);

  let preflight;
  try {
    preflight = await verifyElectrumBroadcastPreflight(
      client,
      rawTx,
      input.replacement,
    );
  } catch (error) {
    if (error instanceof BroadcastPreflightError) {
      log.warn('[BLOCKCHAIN] Broadcast preflight failed', {
        network, reason: error.reason, details: error.details,
      });
    }
    const message = getErrorMessage(error, 'Unknown error');
    throw allowDefiniteRejection
      ? new DefiniteBroadcastRejectionError(`Failed to broadcast transaction: ${message}`)
      : withCause(`Broadcast outcome is unknown: ${message}`, error);
  }
  log.debug('[BLOCKCHAIN] Broadcast preflight passed', {
    network, txid: preflight.txid, inputCount: preflight.inputCount,
  });

  try {
    const txid = await client.broadcastTransaction(rawTx);
    if (txid !== expectedTxid) {
      throw new Error(`Node returned unexpected txid ${txid}; expected ${expectedTxid}`);
    }
    return {
      txid,
      broadcasted: true,
    };
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error');
    if (allowDefiniteRejection && isDefiniteNodeRejection(error)) {
      throw new DefiniteBroadcastRejectionError(`Failed to broadcast transaction: ${message}`);
    }
    throw withCause(`Broadcast outcome is unknown: ${message}`, error);
  }
}

/** Per-target fallback used both for a single missing Electrum estimate and,
 * via `DEFAULT_FEE_ESTIMATES`, for a genuine failure across every target. */
const FEE_ESTIMATE_TARGETS: ReadonlyArray<{
  tier: keyof FeeEstimates;
  blocks: number;
  fallback: number;
}> = [
  { tier: 'fastest', blocks: 1, fallback: 20 },
  { tier: 'halfHour', blocks: 3, fallback: 15 },
  { tier: 'hour', blocks: 6, fallback: 10 },
  { tier: 'economy', blocks: 12, fallback: 5 },
];

const DEFAULT_FEE_ESTIMATES: FeeEstimates = {
  fastest: 20,
  halfHour: 15,
  hour: 10,
  economy: 5,
};

/**
 * Get fee estimates for different confirmation targets.
 *
 * Electrum servers routinely have no estimate for some confirmation targets
 * (thin mempools, regtest, or a far target like the ~144-block horizon), and
 * `estimateFee()` signals that with `ElectrumNoFeeEstimateError` rather than
 * a fee rate. That is expected and routine, not a transport failure: each
 * target is resolved independently so one missing estimate substitutes only
 * that tier's documented fallback, instead of discarding every other tier's
 * live estimate. A genuine failure (a thrown error that is not
 * `ElectrumNoFeeEstimateError`, e.g. a connection drop) still falls back to
 * the full default schedule and is logged at error level, exactly as before.
 */
export async function getFeeEstimates(network: BitcoinNetwork): Promise<FeeEstimates> {
  const client = await getNodeClient(network);

  try {
    const settled = await Promise.allSettled(
      FEE_ESTIMATE_TARGETS.map(target => client.estimateFee(target.blocks)),
    );

    const estimates = {} as FeeEstimates;
    for (let i = 0; i < FEE_ESTIMATE_TARGETS.length; i++) {
      const { tier, blocks, fallback } = FEE_ESTIMATE_TARGETS[i];
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        estimates[tier] = Math.max(1, outcome.value);
        continue;
      }
      if (outcome.reason instanceof ElectrumNoFeeEstimateError) {
        log.warn('[BLOCKCHAIN] No Electrum fee estimate for target; using its fallback', {
          network, blocks, tier, fallback,
        });
        estimates[tier] = fallback;
        continue;
      }
      // Genuine transport/other failure: preserve the existing full-fallback
      // behavior by routing it through the catch block below.
      throw outcome.reason;
    }
    return estimates;
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get fee estimates', { error: getErrorMessage(error) });
    // Return sensible defaults if fee estimation fails
    return { ...DEFAULT_FEE_ESTIMATES };
  }
}

/**
 * Get transaction details from blockchain
 */
export async function getTransactionDetails(
  txid: string,
  network: BitcoinNetwork
): Promise<TransactionDetails> {
  const client = await getNodeClient(network);

  return client.getTransaction(txid, true);
}

/**
 * Validate and check if address is used
 */
export async function checkAddress(
  address: string,
  network: BitcoinNetwork = 'mainnet'
): Promise<CheckAddressResult> {
  // First validate format
  const validation = validateAddress(address, network);
  if (!validation.valid) {
    return validation;
  }

  // Check blockchain
  const client = await getNodeClient(network);

  try {
    if (!client.isConnected()) {
      await client.connect();
    }

    const [balance, history] = await Promise.all([
      client.getAddressBalance(address),
      client.getAddressHistory(address),
    ]);

    return {
      valid: true,
      balance: balance.confirmed + balance.unconfirmed,
      transactionCount: history.length,
    };
  } catch (error) {
    return {
      valid: true, // Address format is valid even if we can't check blockchain
      error: 'Could not check address on blockchain',
    };
  }
}
