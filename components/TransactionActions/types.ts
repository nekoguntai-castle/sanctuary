import type { RBFCheckResult } from '../../src/api/bitcoin';

export interface TransactionActionsProps {
  txid: string;
  walletId: string;
  confirmed: boolean;
  isReceived: boolean;
  onActionComplete?: () => void;
}

export interface TransactionActionState {
  error: string | null;
  loading: boolean;
  newFeeRate: number;
  processing: boolean;
  rbfStatus: RBFCheckResult | null;
  showCPFPModal: boolean;
  showRBFModal: boolean;
  success: string | null;
  targetFeeRate: number;
}

export interface TransactionActionHandlers {
  closeCPFPModal: () => void;
  closeRBFModal: () => void;
  handleCPFP: () => Promise<void>;
  handleRBF: () => Promise<void>;
  openCPFPModal: () => void;
  openRBFModal: () => void;
  setNewFeeRate: (feeRate: number) => void;
  setTargetFeeRate: (feeRate: number) => void;
}
