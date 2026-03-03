/**
 * Treasury Autopilot
 *
 * Monitors mempool fee conditions and UTXO health, then notifies
 * wallet users when conditions are optimal for consolidation.
 *
 * Phase 1: Monitoring + notifications only.
 */

export type {
  WalletAutopilotSettings,
  AutopilotConfig,
  FeeSnapshot,
  UtxoHealthProfile,
  ConsolidationSuggestion,
} from './types';

export { DEFAULT_AUTOPILOT_SETTINGS } from './types';

export {
  getWalletAutopilotSettings,
  updateWalletAutopilotSettings,
  getEnabledAutopilotWallets,
} from './settings';

export { recordFeeSnapshot, getRecentFees, getLatestFeeSnapshot, isFeeLow } from './feeMonitor';

export { getUtxoHealthProfile } from './utxoHealth';

export { evaluateWallet, evaluateAllWallets } from './evaluator';
