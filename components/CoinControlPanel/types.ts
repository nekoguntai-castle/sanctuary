/**
 * CoinControlPanel Types
 *
 * Shared types and interfaces for coin control components.
 */

import type { UTXO, WalletScriptType } from '../../types';
import type { SpendPrivacyAnalysis, WalletPrivacyResponse, SelectionStrategy } from '../../src/api/transactions';
import type { UIStrategy } from '../StrategySelector';

export interface CoinControlPanelProps {
  walletId: string;
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  onToggleSelect: (utxoId: string) => void;
  onSetSelectedUtxos: (utxoIds: Set<string>) => void;
  feeRate: number;
  targetAmount: number; // Amount user wants to send (for UTXO selection)
  strategy?: UIStrategy;
  onStrategyChange?: (strategy: UIStrategy) => void;
  disabled?: boolean;
  className?: string;
}

// Re-export types that subcomponents need
export type { UTXO, WalletScriptType, SpendPrivacyAnalysis, WalletPrivacyResponse, SelectionStrategy, UIStrategy };
