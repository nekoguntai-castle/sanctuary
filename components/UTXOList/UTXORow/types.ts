import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';

export interface UTXORowProps {
  utxo: UTXO;
  isSelected: boolean;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleFreeze: (txid: string, vout: number) => void;
  onShowPrivacyDetail: (id: string) => void;
  privacyInfo?: UtxoPrivacyInfo;
  showPrivacy: boolean;
  currentFeeRate: number;
  network: string;
  explorerUrl: string;
  format: (sats: number) => string;
}

export type UtxoRowVisualState = 'frozen' | 'locked' | 'dust' | 'selected' | 'default';

export interface UtxoRowModel {
  id: string;
  utxo: UTXO;
  isFrozen: boolean;
  isLocked: boolean;
  isDisabled: boolean;
  isDust: boolean;
  isSelected: boolean;
  spendCost: number;
  visualState: UtxoRowVisualState;
  rowClassName: string;
  amountClassName: string;
  selectionClassName: string;
  lockedDraftLabel: string;
}

export interface CreateUtxoRowModelArgs {
  utxo: UTXO;
  isSelected: boolean;
  currentFeeRate: number;
}
