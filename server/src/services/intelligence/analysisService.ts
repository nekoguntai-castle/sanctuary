/**
 * Analysis Service
 *
 * Orchestrates the 5 analysis pipelines for Treasury Intelligence.
 * Gathers sanitized wallet data, sends to AI proxy for analysis,
 * persists insights, and dispatches notifications.
 */

import { getRedisClient, isRedisConnected } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getAIConfig, syncConfigToContainer, getContainerUrl } from '../ai/config';
import { intelligenceRepository } from '../../repositories/intelligenceRepository';
import { getEnabledIntelligenceWallets } from './settings';
import { notificationChannelRegistry } from '../notifications/channels';
import type { InsightType, AnalysisResult, AnalysisContext } from './types';
import type { CreateInsightInput } from '../../repositories/intelligenceRepository';

const log = createLogger('INTELLIGENCE:SVC_ANALYSIS');

const AI_CONTAINER_URL = getContainerUrl();

/** Redis key prefix for deduplication (TTL-based) */
const DEDUP_KEY_PREFIX = 'intelligence:dedup:';
/** Default cooldown between identical insight types per wallet (6 hours) */
const DEFAULT_COOLDOWN_SECONDS = 6 * 3600;
/** Insight default expiry (48 hours) */
const DEFAULT_EXPIRY_MS = 48 * 3600 * 1000;

/**
 * Run all analysis pipelines for all opted-in wallets.
 * Main entry point called by the recurring worker job.
 */
export async function runAnalysisPipelines(): Promise<void> {
  try {
    const config = await getAIConfig();
    if (!config.enabled || !config.endpoint || !config.model) {
      log.debug('AI not configured, skipping analysis');
      return;
    }

    // Sync config to AI container
    await syncConfigToContainer(config);

    // Check Ollama compatibility
    const ollamaCheck = await checkOllamaCompatible();
    if (!ollamaCheck) {
      log.debug('Endpoint is not Ollama-compatible, skipping analysis');
      return;
    }

    const enabledWallets = await getEnabledIntelligenceWallets();
    if (enabledWallets.length === 0) {
      log.debug('No wallets with intelligence enabled');
      return;
    }

    log.info('Running intelligence analysis', { walletCount: enabledWallets.length });

    for (const { walletId, walletName, settings } of enabledWallets) {
      try {
        for (const type of settings.typeFilter) {
          await runPipeline(walletId, walletName, type);
        }
      } catch (error) {
        log.error('Error analyzing wallet', { walletId, error: getErrorMessage(error) });
      }
    }
  } catch (error) {
    log.error('Error in runAnalysisPipelines', { error: getErrorMessage(error) });
  }
}

/**
 * Run a single analysis pipeline for a wallet.
 */
async function runPipeline(
  walletId: string,
  walletName: string,
  type: InsightType
): Promise<void> {
  // Check deduplication
  if (await isDeduplicated(walletId, type)) {
    log.debug('Skipping deduplicated analysis', { walletId, type });
    return;
  }

  // Gather context based on type
  const context = await gatherContext(walletId, type);
  if (!context) {
    log.debug('No context available for analysis', { walletId, type });
    return;
  }

  // Call AI proxy for analysis
  const result = await callAnalysis(type, context);
  if (!result) {
    log.debug('No analysis result', { walletId, type });
    return;
  }

  // Persist insight
  const input: CreateInsightInput = {
    walletId,
    type,
    severity: result.severity,
    title: result.title,
    summary: result.summary,
    analysis: result.analysis,
    data: context as any,
    expiresAt: new Date(Date.now() + DEFAULT_EXPIRY_MS),
  };

  const insight = await intelligenceRepository.createInsight(input);
  log.info('Created insight', { id: insight.id, walletId, type, severity: result.severity });

  // Set dedup key
  await setDedup(walletId, type);

  // Dispatch notification
  try {
    await notificationChannelRegistry.notifyInsight(walletId, {
      id: insight.id,
      type,
      severity: result.severity,
      title: result.title,
      summary: result.summary,
      walletName,
    });
  } catch (error) {
    log.error('Failed to dispatch insight notification', { insightId: insight.id, error: getErrorMessage(error) });
  }
}

/**
 * Gather sanitized context data for a specific analysis type.
 */
async function gatherContext(
  walletId: string,
  type: InsightType
): Promise<AnalysisContext | null> {
  try {
    const context: AnalysisContext = {};

    switch (type) {
      case 'utxo_health': {
        const { getUtxoHealthProfile } = await import('../autopilot/utxoHealth');
        const health = await getUtxoHealthProfile(walletId, 10_000);
        if (health.totalUtxos === 0) return null;
        context.utxoHealth = {
          totalUtxos: health.totalUtxos,
          dustCount: health.dustCount,
          dustValueSats: Number(health.dustValue),
          totalValueSats: Number(health.totalValue),
          avgUtxoSizeSats: Number(health.avgUtxoSize),
          consolidationCandidates: health.consolidationCandidates,
        };
        break;
      }

      case 'fee_timing': {
        const { getRecentFees, getLatestFeeSnapshot } = await import('../autopilot/feeMonitor');
        const snapshots = await getRecentFees(1440);
        const latest = await getLatestFeeSnapshot();
        if (!latest || snapshots.length < 6) return null;

        context.feeHistory = {
          currentEconomy: latest.economy,
          currentFastest: latest.fastest,
          snapshotCount: snapshots.length,
          avgEconomy24h: Math.round(snapshots.reduce((s, f) => s + f.economy, 0) / snapshots.length),
          minEconomy24h: Math.min(...snapshots.map(s => s.economy)),
          maxEconomy24h: Math.max(...snapshots.map(s => s.economy)),
        };
        break;
      }

      case 'anomaly': {
        const velocity = await intelligenceRepository.getTransactionVelocity(walletId, 90);
        const velocity1d = await intelligenceRepository.getTransactionVelocity(walletId, 1);
        if (velocity.length === 0) return null;

        context.spendingVelocity = {
          last24h: { count: velocity1d[0]?.count ?? 0, totalSats: Number(velocity1d[0]?.totalSats ?? 0) },
          last90d: { count: velocity[0]?.count ?? 0, totalSats: Number(velocity[0]?.totalSats ?? 0) },
          avgDailyCount: (velocity[0]?.count ?? 0) / 90,
          avgDailySpend: Number(velocity[0]?.totalSats ?? 0) / 90,
        };
        break;
      }

      case 'tax': {
        const distribution = await intelligenceRepository.getUtxoAgeDistribution(walletId);
        if (distribution.shortTerm.count === 0 && distribution.longTerm.count === 0) return null;

        context.utxoAgeProfile = {
          shortTermCount: distribution.shortTerm.count,
          shortTermSats: Number(distribution.shortTerm.totalSats),
          longTermCount: distribution.longTerm.count,
          longTermSats: Number(distribution.longTerm.totalSats),
          thresholdDays: 365,
        };
        break;
      }

      case 'consolidation': {
        // Combines UTXO health + fee data
        const { getUtxoHealthProfile } = await import('../autopilot/utxoHealth');
        const { getLatestFeeSnapshot, getRecentFees } = await import('../autopilot/feeMonitor');

        const health = await getUtxoHealthProfile(walletId, 10_000);
        const latest = await getLatestFeeSnapshot();
        const snapshots = await getRecentFees(1440);

        if (health.totalUtxos < 5) return null;

        context.utxoHealth = {
          totalUtxos: health.totalUtxos,
          dustCount: health.dustCount,
          consolidationCandidates: health.consolidationCandidates,
          totalValueSats: Number(health.totalValue),
        };
        context.feeHistory = {
          currentEconomy: latest?.economy ?? null,
          avgEconomy24h: snapshots.length > 0
            ? Math.round(snapshots.reduce((s, f) => s + f.economy, 0) / snapshots.length)
            : null,
        };
        break;
      }
    }

    return context;
  } catch (error) {
    log.error('Failed to gather context', { walletId, type, error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Call AI proxy's /analyze endpoint.
 */
async function callAnalysis(
  type: InsightType,
  context: AnalysisContext
): Promise<AnalysisResult | null> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, context }),
      signal: AbortSignal.timeout(130000),
    });

    if (!response.ok) {
      log.error('AI analysis request failed', { status: response.status });
      return null;
    }

    const result = await response.json() as AnalysisResult;
    if (!result.title || !result.summary) {
      log.error('Invalid analysis response', { type });
      return null;
    }

    return result;
  } catch (error) {
    log.error('AI analysis error', { type, error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Check if the configured endpoint is Ollama-compatible.
 */
async function checkOllamaCompatible(): Promise<boolean> {
  try {
    const response = await fetch(`${AI_CONTAINER_URL}/check-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return false;

    const result = await response.json() as { compatible: boolean };
    return result.compatible;
  } catch {
    return false;
  }
}

/**
 * Check if an insight of this type was recently generated for this wallet.
 */
async function isDeduplicated(walletId: string, type: InsightType): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return false;

  const key = `${DEDUP_KEY_PREFIX}${walletId}:${type}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

/**
 * Set deduplication key after generating an insight.
 */
async function setDedup(walletId: string, type: InsightType): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return;

  const key = `${DEDUP_KEY_PREFIX}${walletId}:${type}`;
  await redis.set(key, '1', 'EX', DEFAULT_COOLDOWN_SECONDS);
}

/**
 * Get intelligence status: checks if all prerequisites are met.
 */
export async function getIntelligenceStatus() {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return { available: false, ollamaConfigured: false, reason: 'ai_not_configured' };
  }

  // Sync config to container
  await syncConfigToContainer(config);

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/check-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { available: false, ollamaConfigured: false, reason: 'ai_container_unreachable' };
    }

    const result = await response.json() as { compatible: boolean; endpointType?: string; reason?: string };

    if (!result.compatible) {
      return { available: false, ollamaConfigured: false, reason: result.reason || 'ollama_required' };
    }

    return {
      available: true,
      ollamaConfigured: true,
      endpointType: result.endpointType,
    };
  } catch {
    return { available: false, ollamaConfigured: false, reason: 'ai_container_unreachable' };
  }
}
