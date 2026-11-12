import { TypeSelection, OutputsStep, ReviewStep } from '../steps';
import type { WizardStep } from '../../../contexts/send';
import type { TransactionData, UseSendTransactionActionsResult } from '../../../hooks/send/useSendTransactionActions';

interface WizardStepContentProps {
  actions: UseSendTransactionActionsResult;
  currentStep: WizardStep;
  effectiveTxData: TransactionData | null;
  isDraftMode: boolean;
  isMultiSig: boolean;
  onSaveDraft: () => void;
  onSign: () => void;
  onSignAndBroadcast: () => void;
  unsignedPsbt: string | null;
}

function renderReviewStep({
  actions,
  effectiveTxData,
  isDraftMode,
  isMultiSig,
  onSaveDraft,
  onSign,
  onSignAndBroadcast,
  unsignedPsbt,
}: Omit<WizardStepContentProps, 'currentStep'>) {
  return (
    <ReviewStep
      onSign={isMultiSig ? onSign : undefined}
      onBroadcast={!isMultiSig ? onSignAndBroadcast : undefined}
      onSaveDraft={isDraftMode ? undefined : onSaveDraft}
      approvalAction={actions.approvalAction}
      signing={actions.isSigning}
      broadcasting={actions.isBroadcasting || actions.isCreating || actions.isPayjoinBusy}
      savingDraft={actions.isSavingDraft}
      txData={effectiveTxData}
      unsignedPsbt={unsignedPsbt}
      signedDevices={actions.signedDevices}
      payjoinStatus={actions.payjoinStatus}
      payjoinUsbBlocked={actions.payjoinUsbBlocked}
      payjoinOriginalTxData={actions.payjoinOriginalTxData}
      onSendWithoutPayjoin={actions.sendWithoutPayjoin}
      onDownloadPsbt={actions.downloadPsbt}
      onUploadSignedPsbt={actions.uploadSignedPsbt}
      onSignWithDevice={actions.signWithDevice}
      onMarkDeviceSigned={actions.markDeviceSigned}
      onProcessQrSignedPsbt={actions.processQrSignedPsbt}
      onBroadcastSigned={() => actions.broadcastTransaction()}
      isDraftMode={isDraftMode}
    />
  );
}

export function WizardStepContent(props: WizardStepContentProps) {
  switch (props.currentStep) {
    case 'type':
      return <TypeSelection />;
    case 'outputs':
      return <OutputsStep />;
    case 'review':
      return renderReviewStep(props);
    default:
      return null;
  }
}
