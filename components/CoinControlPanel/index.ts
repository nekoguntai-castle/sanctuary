/**
 * CoinControlPanel Component Module
 *
 * Refactored CoinControlPanel component split into:
 * - CoinControlPanel (main orchestrator with state, effects, strategy handling)
 * - UtxoRow (individual UTXO row with selection, badges, and status)
 * - utils (dust calculation, spend cost, strategy mapping)
 * - types (shared interfaces and type re-exports)
 */

// Main component
export { CoinControlPanel } from './CoinControlPanel';

// Subcomponents
export { UtxoRow } from './UtxoRow';

// Utilities
export { calculateDustThreshold, isDustUtxo, getSpendCost, strategyToApiStrategy, INPUT_VBYTES } from './utils';

// Types
export type { CoinControlPanelProps } from './types';
