/**
 * Shared per-user eligibility for AI insight notifications.
 *
 * Pure (it imports only intelligence constants and types) so the Telegram and
 * push channels apply the same intelligence-enabled / severity / type rules
 * and cannot diverge.
 */

import { INSIGHT_SEVERITY_VALUES, type WalletIntelligenceSettings } from '../../intelligence/types';

export type InsightWalletSettings = Partial<WalletIntelligenceSettings>;

export const INSIGHT_TYPE_LABELS: Record<string, string> = {
  utxo_health: 'UTXO Health',
  fee_timing: 'Fee Timing',
  anomaly: 'Anomaly Detection',
  tax: 'Tax Intelligence',
  consolidation: 'Consolidation Strategy',
};

const SEVERITY_ORDER: readonly string[] = INSIGHT_SEVERITY_VALUES;

/**
 * Return the user's per-wallet intelligence settings when the insight passes
 * the enabled flag and the severity/type filters, otherwise `null`. Channel
 * toggles (`notifyTelegram`, `notifyPush`) are left to the caller.
 */
export function eligibleInsightWalletSettings(
  preferences: unknown,
  walletId: string,
  insight: { severity: string; type: string }
): InsightWalletSettings | null {
  const prefs = preferences as Record<string, any> | null;
  const walletSettings = prefs?.intelligence?.wallets?.[walletId] as InsightWalletSettings | undefined;
  if (!walletSettings?.enabled) return null;

  const filterLevel = SEVERITY_ORDER.indexOf(walletSettings.severityFilter || 'info');
  const insightLevel = SEVERITY_ORDER.indexOf(insight.severity);
  if (insightLevel < filterLevel) return null;

  if (walletSettings.typeFilter && !(walletSettings.typeFilter as readonly string[]).includes(insight.type)) return null;

  return walletSettings;
}
