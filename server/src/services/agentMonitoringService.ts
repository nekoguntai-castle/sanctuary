/**
 * Agent Monitoring Service
 *
 * Persists operational-wallet alert history for linked agents. The service is
 * observational only: it never signs, broadcasts, or moves funds.
 */

import type { Prisma, WalletAgent } from '../generated/prisma/client';
import { addressRepository, agentRepository, transactionRepository, utxoRepository } from '../repositories';
import type { TransactionNotification } from './notifications/channels/types';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import {
  buildDestinationMetadata,
  buildUnknownClassification,
  classifyOperationalSpendDestination,
  getUnknownDestinationHandlingMode,
  uniqueDestinationAddresses,
  type OperationalDestinationClassificationResult,
  type OperationalDestinationWallet,
  type OperationalTransactionEvaluation,
  type UnknownDestinationHandlingMode,
} from './agentMonitoring/destinationClassification';

export {
  classifyOperationalSpendDestination,
  type OperationalDestinationClassification,
  type OperationalDestinationClassificationResult,
  type OperationalDestinationOutput,
  type OperationalDestinationWallet,
  type OperationalTransactionDetails,
  type OperationalTransactionEvaluation,
  type UnknownDestinationHandlingMode,
} from './agentMonitoring/destinationClassification';

const log = createLogger('AGENT:MONITOR');
const DEFAULT_LOOKBACK_MINUTES = 60;
const DEFAULT_DEDUPE_MINUTES = 60;
// Transaction alerts should dedupe by txid across all future sync retries.
const TX_DEDUPE_EPOCH = new Date(0);

type AlertSeverity = 'info' | 'warning' | 'critical';

function positiveBigInt(value: bigint | null | undefined): bigint | null {
  return value !== null && value !== undefined && value > 0n ? value : null;
}

function positiveInt(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && value > 0 ? value : null;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function getDedupeSince(agent: WalletAgent): Date {
  return minutesAgo(positiveInt(agent.alertDedupeMinutes) ?? DEFAULT_DEDUPE_MINUTES);
}

function outgoingAmount(tx: TransactionNotification): bigint {
  return tx.amount < 0n ? -tx.amount : tx.amount;
}

async function createAlertIfNotDuplicate(agent: WalletAgent, candidate: AlertCandidate): Promise<void> {
  const since = candidate.dedupeSince ?? getDedupeSince(agent);
  await agentRepository.createAlertIfNotDuplicate({
    agentId: agent.id,
    /* v8 ignore start -- wallet-scoped alert candidates normally include walletId */
    walletId: candidate.walletId ?? null,
    /* v8 ignore stop */
    type: candidate.type,
    severity: candidate.severity,
    txid: candidate.txid ?? null,
    amountSats: candidate.amountSats ?? null,
    feeSats: candidate.feeSats ?? null,
    thresholdSats: candidate.thresholdSats ?? null,
    observedCount: candidate.observedCount ?? null,
    reasonCode: candidate.reasonCode ?? null,
    message: candidate.message,
    dedupeKey: candidate.dedupeKey,
    /* v8 ignore start -- metadata is optional enrichment for alert payloads */
    metadata: candidate.metadata ?? null,
    /* v8 ignore stop */
  }, since);
}

function buildTransactionAlertCandidates(
  agent: WalletAgent,
  walletId: string,
  tx: TransactionNotification,
  result: OperationalDestinationClassificationResult,
  handlingMode: UnknownDestinationHandlingMode,
  policy: { shouldNotify: boolean; shouldPause: boolean }
): AlertCandidate[] {
  const amount = outgoingAmount(tx);
  const fee = tx.feeSats ?? null;
  const candidates: AlertCandidate[] = [];
  const largeSpendThreshold = positiveBigInt(agent.largeOperationalSpendSats);
  const largeFeeThreshold = positiveBigInt(agent.largeOperationalFeeSats);
  const destinationMetadata = buildDestinationMetadata(result, handlingMode, policy);

  if (result.classification === 'unknown_destination') {
    candidates.push({
      type: 'operational_destination_unknown',
      severity: policy.shouldPause ? 'critical' : 'warning',
      walletId,
      txid: tx.txid,
      amountSats: amount,
      feeSats: fee,
      reasonCode: 'unknown_destination',
      message: `Agent ${agent.name} spent ${amount.toString()} sats from its operational wallet, but the destination could not be classified from transaction outputs or counterparty metadata.`,
      dedupeKey: `agent:${agent.id}:destination_unknown:${tx.txid}`,
      dedupeSince: TX_DEDUPE_EPOCH,
      metadata: destinationMetadata,
    });
  }

  if (largeSpendThreshold && amount >= largeSpendThreshold) {
    candidates.push({
      type: 'large_operational_spend',
      severity: 'critical',
      walletId,
      txid: tx.txid,
      amountSats: amount,
      thresholdSats: largeSpendThreshold,
      message: `Agent ${agent.name} spent ${amount.toString()} sats from its operational wallet, meeting or exceeding the configured large-spend threshold.`,
      dedupeKey: `agent:${agent.id}:large_spend:${tx.txid}`,
      dedupeSince: TX_DEDUPE_EPOCH,
      metadata: { ...destinationMetadata, thresholdSats: largeSpendThreshold.toString() },
    });
  }

  if (largeFeeThreshold && fee !== null && fee >= largeFeeThreshold) {
    candidates.push({
      type: 'large_operational_fee',
      severity: 'warning',
      walletId,
      txid: tx.txid,
      feeSats: fee,
      thresholdSats: largeFeeThreshold,
      message: `Agent ${agent.name} paid a ${fee.toString()} sat operational wallet fee, meeting or exceeding the configured fee threshold.`,
      dedupeKey: `agent:${agent.id}:large_fee:${tx.txid}`,
      dedupeSince: TX_DEDUPE_EPOCH,
      metadata: { ...destinationMetadata, thresholdSats: largeFeeThreshold.toString() },
    });
  }

  return candidates;
}

async function loadDestinationClassifications(
  walletId: string,
  transactions: TransactionNotification[]
): Promise<Map<string, OperationalDestinationClassificationResult>> {
  const txids = Array.from(new Set(transactions.map(tx => tx.txid)));
  const details = await transactionRepository.findByWalletIdAndTxids(walletId, txids, {
    txid: true,
    type: true,
    counterpartyAddress: true,
    outputs: {
      orderBy: { outputIndex: 'asc' },
      select: {
        address: true,
        amount: true,
        isOurs: true,
      },
    },
  });

  const knownAddresses = uniqueDestinationAddresses(details.flatMap(detail => [
    detail.counterpartyAddress,
    ...detail.outputs.map(output => output.address),
  ]));
  const knownWalletRows = await addressRepository.findWalletSummariesByAddresses(knownAddresses);
  const knownWalletsByAddress = new Map<string, OperationalDestinationWallet>(
    knownWalletRows.map(row => [
      row.address,
      { walletId: row.wallet.id, walletName: row.wallet.name },
    ])
  );
  const detailsByTxid = new Map(details.map(detail => [detail.txid, detail]));

  return new Map(transactions.map((tx) => {
    const detail = detailsByTxid.get(tx.txid);
    return [
      tx.txid,
      classifyOperationalSpendDestination(walletId, detail ?? {
        txid: tx.txid,
        type: tx.type,
        counterpartyAddress: null,
        outputs: null,
      }, knownWalletsByAddress),
    ];
  }));
}

function buildBalanceAlertCandidates(
  agent: WalletAgent,
  walletId: string,
  balance: bigint
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const lowBalanceThreshold = positiveBigInt(agent.minOperationalBalanceSats);
  const highBalanceThreshold = positiveBigInt(agent.maxOperationalBalanceSats);

  if (lowBalanceThreshold && balance < lowBalanceThreshold) {
    candidates.push({
      type: 'operational_balance_low',
      severity: 'warning',
      walletId,
      amountSats: balance,
      thresholdSats: lowBalanceThreshold,
      message: `Agent ${agent.name} operational wallet balance is ${balance.toString()} sats, below the configured refill threshold.`,
      dedupeKey: `agent:${agent.id}:balance_low:${walletId}`,
      metadata: { balanceSats: balance.toString(), thresholdSats: lowBalanceThreshold.toString() },
    });
  }

  if (highBalanceThreshold && balance > highBalanceThreshold) {
    candidates.push({
      type: 'operational_balance_high',
      severity: 'warning',
      walletId,
      amountSats: balance,
      thresholdSats: highBalanceThreshold,
      message: `Agent ${agent.name} operational wallet balance is ${balance.toString()} sats, above the configured balance cap.`,
      dedupeKey: `agent:${agent.id}:balance_high:${walletId}`,
      metadata: { balanceSats: balance.toString(), thresholdSats: highBalanceThreshold.toString() },
    });
  }

  return candidates;
}

/**
 * Best-effort monitoring hook for outgoing operational-wallet transactions.
 * Alert persistence errors are logged and never propagated to callers.
 */
export async function evaluateOperationalTransactionAlerts(
  walletId: string,
  transactions: TransactionNotification[],
  agentsForWallet?: WalletAgent[]
): Promise<OperationalTransactionEvaluation[]> {
  const sentTransactions = transactions.filter(tx => tx.type === 'sent');
  if (sentTransactions.length === 0) return [];

  const evaluations: OperationalTransactionEvaluation[] = [];

  try {
    const agents = agentsForWallet ?? await agentRepository.findActiveAgentsByOperationalWalletId(walletId);
    /* v8 ignore next -- callers skip monitoring for wallets without active agents */
    if (agents.length === 0) return [];

    const balance = await utxoRepository.getUnspentBalance(walletId);
    const classificationsByTxid = await loadDestinationClassifications(walletId, sentTransactions);
    const alertWrites: Promise<void>[] = [];

    for (const agent of agents) {
      for (const tx of sentTransactions) {
        /* v8 ignore next -- loadDestinationClassifications creates an entry for every sent txid */
        const classification = classificationsByTxid.get(tx.txid) ?? buildUnknownClassification(0, 'missing_details');
        const handlingMode = getUnknownDestinationHandlingMode(agent);
        const shouldNotify = agent.notifyOnOperationalSpend;
        const shouldPause = classification.classification === 'unknown_destination' && agent.pauseOnUnexpectedSpend;
        const metadata = buildDestinationMetadata(classification, handlingMode, { shouldNotify, shouldPause });

        evaluations.push({
          agentId: agent.id,
          agentName: agent.name,
          txid: tx.txid,
          destinationClassification: classification.classification,
          unknownDestinationHandlingMode: handlingMode,
          shouldNotify,
          shouldPause,
          metadata,
        });

        for (const candidate of buildTransactionAlertCandidates(
          agent,
          walletId,
          tx,
          classification,
          handlingMode,
          { shouldNotify, shouldPause }
        )) {
          alertWrites.push(createAlertIfNotDuplicate(agent, candidate));
        }
      }

      for (const candidate of buildBalanceAlertCandidates(agent, walletId, balance)) {
        alertWrites.push(createAlertIfNotDuplicate(agent, candidate));
      }
    }

    await Promise.all(alertWrites);
  } catch (error) {
    log.warn('Failed to evaluate operational transaction alerts', {
      walletId,
      error: getErrorMessage(error),
    });
  }

  return evaluations;
}

/**
 * Best-effort monitoring hook for rejected funding attempts.
 * Alert persistence errors are logged and never propagated to callers.
 */
export async function evaluateRejectedFundingAttemptAlert(
  agentId: string,
  reasonCode?: string | null
): Promise<void> {
  try {
    const agent = await agentRepository.findAgentById(agentId);
    if (!agent || agent.revokedAt || agent.status === 'revoked') return;

    const threshold = positiveInt(agent.repeatedFailureThreshold);
    if (!threshold) return;

    const lookbackMinutes = positiveInt(agent.repeatedFailureLookbackMinutes) ?? DEFAULT_LOOKBACK_MINUTES;
    const since = minutesAgo(lookbackMinutes);
    const rejectedCount = await agentRepository.countRejectedFundingAttemptsSince(agentId, since);
    if (rejectedCount < threshold) return;

    await createAlertIfNotDuplicate(agent, {
      type: 'repeated_funding_failures',
      severity: 'warning',
      walletId: agent.fundingWalletId,
      observedCount: rejectedCount,
      reasonCode: reasonCode ?? null,
      message: `Agent ${agent.name} has ${rejectedCount} rejected funding attempts in the last ${lookbackMinutes} minutes.`,
      dedupeKey: `agent:${agent.id}:repeated_failures:${lookbackMinutes}:${threshold}`,
      metadata: {
        lookbackMinutes,
        threshold,
        rejectedCount,
      },
    });
  } catch (error) {
    log.warn('Failed to evaluate rejected funding attempt alert', {
      agentId,
      error: getErrorMessage(error),
    });
  }
}

export const agentMonitoringService = {
  classifyOperationalSpendDestination,
  evaluateOperationalTransactionAlerts,
  evaluateRejectedFundingAttemptAlert,
};

interface AlertCandidate {
  type: string;
  severity: AlertSeverity;
  walletId?: string | null;
  txid?: string | null;
  amountSats?: bigint | null;
  feeSats?: bigint | null;
  thresholdSats?: bigint | null;
  observedCount?: number | null;
  reasonCode?: string | null;
  message: string;
  dedupeKey: string;
  metadata?: Prisma.InputJsonObject;
  dedupeSince?: Date;
}
