import type { UseHardwareWalletReturn } from '../../../hooks/useHardwareWallet';
import type { UseSendTransactionActionsResult } from '../../../hooks/send/useSendTransactionActions';

export interface DraftTransactionData {
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
  actions: UseSendTransactionActionsResult;
  hardwareWallet: UseHardwareWalletReturn;
}
