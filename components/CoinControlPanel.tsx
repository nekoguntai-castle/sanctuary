/**
 * CoinControlPanel Component
 *
 * Re-export from the refactored module for backwards compatibility.
 * The component has been split into smaller, focused modules:
 *
 * @see ./CoinControlPanel/CoinControlPanel.tsx - Main orchestrator
 * @see ./CoinControlPanel/UtxoRow.tsx - Individual UTXO row
 * @see ./CoinControlPanel/utils.ts - Dust/spend cost calculations
 * @see ./CoinControlPanel/types.ts - Shared types
 */

export { CoinControlPanel } from './CoinControlPanel/index';
