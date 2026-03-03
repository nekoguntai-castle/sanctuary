/**
 * Treasury Autopilot Evaluator
 *
 * Core evaluation logic that ties fee monitoring and UTXO health together.
 * Checks stability (2 consecutive hits) and cooldowns to avoid notification spam.
 */

import { getRedisClient, isRedisConnected } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { walletLog } from '../../websocket/notifications';
import { getLatestFeeSnapshot } from './feeMonitor';
import { getUtxoHealthProfile } from './utxoHealth';
import { getEnabledAutopilotWallets } from './settings';
import { notificationChannelRegistry } from '../notifications/channels';
import type { WalletAutopilotSettings, ConsolidationSuggestion, UtxoHealthProfile } from './types';

const log = createLogger('AUTOPILOT:EVAL');

/** Stability key tracks consecutive condition-met count (TTL: 30 min) */
const STABILITY_KEY_PREFIX = 'autopilot:stability:';
const STABILITY_TTL_S = 30 * 60;
/** Required consecutive hits before sending notification */
const STABILITY_THRESHOLD = 2;

/** Cooldown key prevents spam (TTL: user's cooldownHours) */
const COOLDOWN_KEY_PREFIX = 'autopilot:cooldown:';

/**
 * Evaluate a single wallet against its autopilot settings.
 * Returns a suggestion if conditions are met, null otherwise.
 */
export async function evaluateWallet(
  walletId: string,
  walletName: string,
  settings: WalletAutopilotSettings
): Promise<ConsolidationSuggestion | null> {
  // 1. Check fee condition
  const feeSnapshot = await getLatestFeeSnapshot();
  if (!feeSnapshot) {
    log.debug('No fee data available yet', { walletId });
    return null;
  }

  if (feeSnapshot.economy > settings.maxFeeRate) {
    log.debug('Fee too high for consolidation', {
      walletId,
      economy: feeSnapshot.economy,
      maxFeeRate: settings.maxFeeRate,
    });
    return null;
  }

  // 2. Check UTXO health
  const health = await getUtxoHealthProfile(walletId, settings.dustThreshold);

  if (health.totalUtxos < settings.minUtxoCount) {
    log.debug('Not enough UTXOs to suggest consolidation', {
      walletId,
      totalUtxos: health.totalUtxos,
      minUtxoCount: settings.minUtxoCount,
    });
    return null;
  }

  // 3. Build suggestion
  const reason = buildReason(feeSnapshot.economy, settings.maxFeeRate, health);
  const estimatedSavings = estimateSavings(health, feeSnapshot.economy);

  return {
    walletId,
    walletName,
    feeRate: feeSnapshot.economy,
    utxoHealth: health,
    estimatedSavings,
    reason,
  };
}

/**
 * Check if the wallet has met stability criteria (2 consecutive evaluations)
 * and is not in cooldown.
 */
async function checkStabilityAndCooldown(
  walletId: string,
  cooldownHours: number
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return false;

  // Check cooldown first
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${walletId}`;
  const inCooldown = await redis.exists(cooldownKey);
  if (inCooldown) {
    log.debug('Wallet in cooldown', { walletId });
    return false;
  }

  // Increment stability counter
  const stabilityKey = `${STABILITY_KEY_PREFIX}${walletId}`;
  const count = await redis.incr(stabilityKey);
  await redis.expire(stabilityKey, STABILITY_TTL_S);

  if (count < STABILITY_THRESHOLD) {
    log.debug('Stability check not met yet', { walletId, count, required: STABILITY_THRESHOLD });
    return false;
  }

  return true;
}

/**
 * Set cooldown for a wallet after notification is sent
 */
async function setCooldown(walletId: string, cooldownHours: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return;

  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${walletId}`;
  const ttlSeconds = cooldownHours * 3600;
  await redis.set(cooldownKey, '1', 'EX', ttlSeconds);

  // Reset stability counter
  const stabilityKey = `${STABILITY_KEY_PREFIX}${walletId}`;
  await redis.del(stabilityKey);
}

/**
 * Reset stability counter when conditions are no longer met
 */
async function resetStability(walletId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return;

  const stabilityKey = `${STABILITY_KEY_PREFIX}${walletId}`;
  await redis.del(stabilityKey);
}

/**
 * Evaluate all wallets with autopilot enabled.
 * Main entry point called by the recurring worker job.
 */
export async function evaluateAllWallets(): Promise<void> {
  try {
    const enabledWallets = await getEnabledAutopilotWallets();

    if (enabledWallets.length === 0) {
      log.debug('No wallets with autopilot enabled');
      return;
    }

    log.debug('Evaluating wallets for consolidation', { count: enabledWallets.length });

    for (const { walletId, walletName, settings } of enabledWallets) {
      try {
        const suggestion = await evaluateWallet(walletId, walletName, settings);

        if (!suggestion) {
          await resetStability(walletId);
          continue;
        }

        // Check stability + cooldown
        const shouldNotify = await checkStabilityAndCooldown(walletId, settings.cooldownHours);
        if (!shouldNotify) continue;

        // Send notification
        await sendConsolidationNotification(suggestion, settings);
        await setCooldown(walletId, settings.cooldownHours);

        log.info('Sent consolidation suggestion', {
          walletId,
          walletName,
          feeRate: suggestion.feeRate,
          utxoCount: suggestion.utxoHealth.totalUtxos,
          dustCount: suggestion.utxoHealth.dustCount,
        });
      } catch (error) {
        log.error('Error evaluating wallet', {
          walletId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    log.error('Error in evaluateAllWallets', { error: getErrorMessage(error) });
  }
}

/**
 * Send consolidation notification via enabled channels and log to wallet.
 */
async function sendConsolidationNotification(
  suggestion: ConsolidationSuggestion,
  settings: WalletAutopilotSettings
): Promise<void> {
  const { walletId, walletName, feeRate, utxoHealth, reason } = suggestion;

  // Log to wallet system log
  walletLog(walletId, 'info', 'AUTOPILOT', reason, {
    feeRate,
    totalUtxos: utxoHealth.totalUtxos,
    dustCount: utxoHealth.dustCount,
    estimatedSavings: suggestion.estimatedSavings,
  });

  // Dispatch via notification channel registry
  const channels = notificationChannelRegistry.getAll();

  for (const channel of channels) {
    // Respect user's per-channel preferences
    if (channel.id === 'telegram' && !settings.notifyTelegram) continue;
    if (channel.id === 'push' && !settings.notifyPush) continue;

    if (channel.notifyConsolidationSuggestion) {
      try {
        await channel.notifyConsolidationSuggestion(walletId, suggestion);
      } catch (error) {
        log.error(`Failed to send consolidation notification via ${channel.id}`, {
          walletId,
          error: getErrorMessage(error),
        });
      }
    }
  }
}

/**
 * Build a human-readable reason string.
 */
function buildReason(feeRate: number, maxFeeRate: number, health: UtxoHealthProfile): string {
  const parts: string[] = [];
  parts.push(`Fees are low (${feeRate} sat/vB, threshold: ${maxFeeRate})`);

  if (health.dustCount > 0) {
    parts.push(`${health.dustCount} dust UTXOs found`);
  }
  parts.push(`${health.totalUtxos} total UTXOs could be consolidated`);

  return parts.join('. ') + '.';
}

/**
 * Estimate savings from consolidation.
 * Compares cost of spending UTXOs individually at a higher fee
 * vs consolidating now while fees are low.
 */
function estimateSavings(health: UtxoHealthProfile, currentFeeRate: number): string {
  // Rough estimate: each input is ~68 vB for native SegWit
  const inputVbytes = 68;
  // Assume median fee of 20 sat/vB as the "typical" rate
  const typicalFeeRate = 20;

  const costAtTypical = health.totalUtxos * inputVbytes * typicalFeeRate;
  const costNow = health.totalUtxos * inputVbytes * currentFeeRate;
  const savings = costAtTypical - costNow;

  if (savings <= 0) return 'minimal savings';

  if (savings >= 100_000) {
    return `~${(savings / 100_000_000).toFixed(4)} BTC in potential fee savings`;
  }
  return `~${savings.toLocaleString()} sats in potential fee savings`;
}
