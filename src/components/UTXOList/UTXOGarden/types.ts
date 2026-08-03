import type { CSSProperties } from 'react';
import type { UTXO } from '../../../types';

export interface UTXOGardenProps {
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  onToggleSelect?: (id: string) => void;
  currentFeeRate: number;
  showPrivacy: boolean;
  format: (sats: number) => string;
}

export interface UtxoGardenDotModel {
  id: string;
  size: number;
  style: CSSProperties;
  colorClass: string;
  isDisabled: boolean;
  isSelected: boolean;
  title: string;
  formattedAmount: string;
}

export interface CreateUtxoGardenDotModelArgs {
  utxo: UTXO;
  selectedUtxos: Set<string>;
  currentFeeRate: number;
  maxAmount: number;
  now: number;
  format: (sats: number) => string;
}
