/**
 * SendTransactionWizard Component
 *
 * Main orchestrator for the transaction wizard.
 * Wraps everything in the SendTransactionProvider and renders the current step.
 */

import { useMemo } from 'react';
import { SendTransactionProvider, useSendTransaction } from '../../contexts/send';
import { useSendTransactionActions } from '../../hooks/send/useSendTransactionActions';
import { useHardwareWallet } from '../../hooks/useHardwareWallet';
import { createLogger } from '../../utils/logger';
import { isMultisigType } from '../../types';
import type { Wallet, UTXO, Device, FeeEstimate } from '../../types';
import type { BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';
import type { SerializableTransactionState, WalletAddress } from '../../contexts/send/types';
import { createDraftInitialTxData } from './SendTransactionWizard/draftTransactionData';
import { WizardShell } from './SendTransactionWizard/WizardShell';
import { WizardStepContent } from './SendTransactionWizard/WizardStepContent';
import { useReviewStepTransactionLifecycle } from './SendTransactionWizard/useReviewStepTransactionLifecycle';
import { useSendWizardActionHandlers } from './SendTransactionWizard/useSendWizardActionHandlers';
import type { DraftTransactionData } from './SendTransactionWizard/types';

export type { DraftTransactionData } from './SendTransactionWizard/types';

const log = createLogger('SendTxWizard');

interface WizardContentProps {
  walletId: string;
  draftTxData?: DraftTransactionData;
  onCancel: () => void;
}

function WizardContent({
  walletId,
  draftTxData,
  onCancel,
}: WizardContentProps) {
  const { currentStep, wallet, state, isReadyToSign, utxos } = useSendTransaction();
  const hardwareWallet = useHardwareWallet();

  log.debug('WizardContent state', {
    isDraftMode: state.isDraftMode,
    hasUnsignedPsbt: !!state.unsignedPsbt,
    unsignedPsbtLength: state.unsignedPsbt?.length,
    hasDraftTxData: !!draftTxData,
    currentStep,
  });

  const draftInitialTxData = useMemo(() => {
    return createDraftInitialTxData({ draftTxData, state, utxos });
  }, [draftTxData, state, utxos]);

  const actions = useSendTransactionActions({
    walletId,
    wallet,
    state,
    initialPsbt: state.isDraftMode ? state.unsignedPsbt : undefined,
    initialTxData: draftInitialTxData || undefined,
  });

  useReviewStepTransactionLifecycle({
    actions,
    currentStep,
    isDraftMode: state.isDraftMode,
    isReadyToSign,
  });

  const {
    handleSign,
    handleSignAndBroadcast,
    handleSaveDraft,
  } = useSendWizardActionHandlers({ actions, hardwareWallet });

  const isMultiSig = isMultisigType(wallet.type);
  const effectiveTxData = state.isDraftMode ? draftInitialTxData : actions.txData;
  const unsignedPsbt = state.isDraftMode ? state.unsignedPsbt : actions.unsignedPsbt;

  return (
    <WizardShell
      currentStep={currentStep}
      error={actions.error}
      onCancel={onCancel}
      onClearError={actions.clearError}
      walletName={wallet.name}
    >
      <WizardStepContent
        actions={actions}
        currentStep={currentStep}
        effectiveTxData={effectiveTxData}
        hardwareWallet={hardwareWallet}
        isDraftMode={state.isDraftMode}
        isMultiSig={isMultiSig}
        onSaveDraft={handleSaveDraft}
        onSign={handleSign}
        onSignAndBroadcast={handleSignAndBroadcast}
        unsignedPsbt={unsignedPsbt}
      />
    </WizardShell>
  );
}

export interface SendTransactionWizardProps {
  wallet: Wallet;
  devices: Device[];
  utxos: UTXO[];
  walletAddresses: WalletAddress[];
  fees: FeeEstimate | null;
  mempoolBlocks?: BlockData[];
  queuedBlocksSummary?: QueuedBlocksSummary | null;
  initialState?: Partial<SerializableTransactionState>;
  draftTxData?: DraftTransactionData;
  calculateFee?: (numInputs: number, numOutputs: number, rate: number) => number;
  onCancel: () => void;
}

export function SendTransactionWizard({
  wallet,
  devices,
  utxos,
  walletAddresses,
  fees,
  mempoolBlocks = [],
  queuedBlocksSummary = null,
  initialState,
  draftTxData,
  calculateFee,
  onCancel,
}: SendTransactionWizardProps) {
  return (
    <SendTransactionProvider
      wallet={wallet}
      devices={devices}
      utxos={utxos}
      walletAddresses={walletAddresses}
      fees={fees}
      mempoolBlocks={mempoolBlocks}
      queuedBlocksSummary={queuedBlocksSummary}
      initialState={initialState}
      calculateFee={calculateFee}
    >
      <WizardContent
        walletId={wallet.id}
        draftTxData={draftTxData}
        onCancel={onCancel}
      />
    </SendTransactionProvider>
  );
}
