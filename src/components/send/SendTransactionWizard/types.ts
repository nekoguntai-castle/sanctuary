import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
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
  /** The draft's stored recipient, which draft creation bound to the signing intent. */
  recipient?: string;
  selectedUtxoIds: string[];
  inputPaths?: string[];
  decoyOutputs?: Array<{ address: string; amount: number }>;
  signingContext?: PsbtSigningContext;
}

export interface SendWizardActionHandlerProps {
  walletId: string;
  actions: UseSendTransactionActionsResult;
  hardwareWallet: UseHardwareWalletReturn;
}
