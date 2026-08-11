import type { UseHardwareWalletReturn } from '../../../hooks/useHardwareWallet';
import type { UseSendTransactionActionsResult } from '../../../hooks/send/useSendTransactionActions';

export interface DraftTransactionData {
  intentId?: string;
  intentDigest?: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount: number;
  selectedUtxoIds: string[];
  inputPaths?: string[];
}

export interface SendWizardActionHandlerProps {
  walletId: string;
  actions: UseSendTransactionActionsResult;
  hardwareWallet: UseHardwareWalletReturn;
}
