/**
 * Treasury Autopilot Types
 *
 * Type definitions for the autopilot consolidation monitoring system.
 */

export interface WalletAutopilotSettings {
  enabled: boolean;
  /** Max fee rate (sats/vB) threshold to trigger suggestion */
  maxFeeRate: number;
  /** Minimum UTXO count before suggesting consolidation */
  minUtxoCount: number;
  /** UTXOs below this value (sats) are considered dust */
  dustThreshold: number;
  /** Hours between notifications for the same wallet */
  cooldownHours: number;
  /** Send via Telegram channel */
  notifyTelegram: boolean;
  /** Send via push channel */
  notifyPush: boolean;
}

export interface AutopilotConfig {
  wallets: Record<string, WalletAutopilotSettings>;
}

export interface FeeSnapshot {
  timestamp: number;
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}

export interface UtxoHealthProfile {
  totalUtxos: number;
  /** UTXOs below dustThreshold */
  dustCount: number;
  /** Total sats in dust UTXOs */
  dustValue: bigint;
  totalValue: bigint;
  avgUtxoSize: bigint;
  smallestUtxo: bigint;
  largestUtxo: bigint;
}

export interface ConsolidationSuggestion {
  walletId: string;
  walletName: string;
  /** Current economy fee rate */
  feeRate: number;
  utxoHealth: UtxoHealthProfile;
  /** Human-readable savings estimate */
  estimatedSavings: string;
  /** Why now is a good time */
  reason: string;
}

export const DEFAULT_AUTOPILOT_SETTINGS: WalletAutopilotSettings = {
  enabled: false,
  maxFeeRate: 5,
  minUtxoCount: 10,
  dustThreshold: 10_000,
  cooldownHours: 24,
  notifyTelegram: true,
  notifyPush: true,
};
