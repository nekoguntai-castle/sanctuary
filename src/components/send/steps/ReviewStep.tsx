/**
 * ReviewStep Component
 *
 * Final step of the transaction wizard.
 * Shows transaction summary and handles signing/broadcasting.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSendTransaction } from '../../../contexts/send';
import { usePriceFreeFormatter } from '../../../contexts/CurrencyContext';
import { createLogger } from '../../../utils/logger';
import type { ApprovalAction, TransactionData } from '../../../hooks/send/types';
import { isMultisigType } from '../../../types';
import type { Device } from '../../../types';
import { TransactionSummary } from './review/TransactionSummary';
import { SigningFlow } from './review/SigningFlow';
import { UsbSigning } from './review/UsbSigning';
import { QrSigning } from './review/QrSigning';
import { DraftActions } from './review/DraftActions';
import { PayjoinProposalPanel, PayjoinRoundOneNotice } from './review/PayjoinProposalPanel';
import { isPayjoinCandidate, isPayjoinStatusIn } from '../../../hooks/send/usePayjoin';
import { useReviewAddressLookup } from './review/useReviewAddressLookup';
import { useReviewStepUploads } from './review/useReviewStepUploads';
import type { PayjoinAttemptStatus } from '../../../contexts/send/types';
import {
  buildReviewFlowData,
  canBroadcastReviewTransaction,
  getKnownAddressSet,
  getRequiredSignatures,
  getReviewAddressLabel,
  getReviewChangeAmount,
  getReviewTransactionTypeLabel,
  getReviewApprovalMode,
  hasEnoughReviewSignatures,
} from './review/reviewStepData';

const log = createLogger('ReviewStep');

export interface ReviewStepProps {
  // Handlers from parent
  onSign?: () => void;
  onBroadcast?: () => void;
  // Also backs "Submit for approval": the server creates the draft pending when an
  // approval policy holds the spend, and the draft list shows "Awaiting approval".
  onSaveDraft?: () => void;
  approvalAction?: ApprovalAction;
  // Loading states
  signing?: boolean;
  broadcasting?: boolean;
  savingDraft?: boolean;
  // Additional props for signing UI
  txData?: TransactionData | null;
  unsignedPsbt?: string | null;
  signedDevices?: Set<string>;
  payjoinStatus?: PayjoinAttemptStatus;
  // Payjoin round two: no USB signing, plus the original the proposal replaces
  payjoinUsbBlocked?: boolean;
  payjoinOriginalTxData?: TransactionData | null;
  onSendWithoutPayjoin?: () => Promise<boolean>;
  onDownloadPsbt?: () => void;
  onUploadSignedPsbt?: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onProcessQrSignedPsbt?: (signedPsbt: string, deviceId: string) => Promise<void>;
  onBroadcastSigned?: () => Promise<boolean>;
  hardwareWallet?: { isConnected: boolean; device: unknown };
  // Draft mode - locks editing, shows draft info
  isDraftMode?: boolean;
}

export function ReviewStep({
  onSign,
  onBroadcast,
  onSaveDraft,
  approvalAction = null,
  signing = false,
  broadcasting = false,
  savingDraft = false,
  txData,
  unsignedPsbt,
  signedDevices = new Set(),
  payjoinStatus = 'idle',
  payjoinUsbBlocked = false,
  payjoinOriginalTxData = null,
  onSendWithoutPayjoin,
  onDownloadPsbt,
  onUploadSignedPsbt,
  onSignWithDevice,
  onMarkDeviceSigned,
  onProcessQrSignedPsbt,
  onBroadcastSigned,
  hardwareWallet,
  isDraftMode = false,
}: ReviewStepProps) {
  const {
    state,
    wallet,
    devices,
    utxos,
    spendableUtxos,
    walletAddresses,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    goToStep,
    prevStep,
    isReadyToSign,
  } = useSendTransaction();

  const { format } = usePriceFreeFormatter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null);
  const [qrSigningDevice, setQrSigningDevice] = useState<Device | null>(null);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const addressLookup = useReviewAddressLookup(state.outputs, txData);

  // Calculate change amount
  const changeAmount = useMemo(() => {
    return getReviewChangeAmount(state.outputs, selectedTotal, totalOutputAmount, estimatedFee, txData);
  }, [selectedTotal, totalOutputAmount, estimatedFee, state.outputs, txData]);

  // Create a set of known wallet addresses for quick lookup
  const knownAddresses = useMemo(() => {
    return getKnownAddressSet(walletAddresses);
  }, [walletAddresses]);

  // Helper to get label for an address if it belongs to any wallet in the app
  const getAddressLabel = useCallback((address: string): string | undefined => {
    return getReviewAddressLabel(address, knownAddresses, wallet.name, addressLookup);
  }, [knownAddresses, wallet.name, addressLookup]);

  // Build flow visualization data
  const flowData = useMemo(() => {
    return buildReviewFlowData({
      state,
      utxos,
      spendableUtxos,
      txData,
      selectedTotal,
      totalOutputAmount,
      estimatedFee,
      changeAmount,
      getAddressLabel,
      payjoinStatus,
      payjoinOriginalTxData,
      network: wallet.network,
    });
  }, [state.outputs, state.selectedUTXOs, utxos, spendableUtxos, txData, selectedTotal, totalOutputAmount, estimatedFee, changeAmount, getAddressLabel, payjoinStatus, payjoinOriginalTxData, wallet.network]);

  // Transaction type label
  const txTypeLabel = useMemo(() => {
    return getReviewTransactionTypeLabel(state.transactionType);
  }, [state.transactionType]);

  // Check if multi-sig
  const isMultiSig = isMultisigType(wallet.type);

  // Debug logging
  log.debug('Review step state', {
    walletType: wallet.type,
    isMultiSig,
    hasTxData: !!txData,
    devicesCount: devices.length,
    devices: devices.map(d => ({ id: d.id, type: d.type, label: d.label })),
    walletAddressesCount: walletAddresses.length,
    isDraftMode,
  });

  // Get required signatures
  const requiredSignatures = getRequiredSignatures(wallet.quorum);
  const { handleFileUpload, handleDeviceFileUpload } = useReviewStepUploads({
    devices,
    onUploadSignedPsbt,
    fileInputRef,
    deviceFileInputRefs,
    setUploadingDeviceId,
  });

  // Check if we have enough signatures for multi-sig
  const hasEnoughSignatures = hasEnoughReviewSignatures(
    isMultiSig,
    signedDevices,
    requiredSignatures,
    hardwareWallet
  );

  // Can broadcast?
  const canBroadcast = canBroadcastReviewTransaction(txData, hasEnoughSignatures, signedDevices);

  // A broadcast already in flight must lock the signing controls too. Broadcast and
  // signing now own separate ownership slots (useSendOperationOwner), so a stray click
  // can no longer tear down the broadcast's lease directly — but the controls still need
  // to stay disabled: re-signing a transaction that is already being broadcast is not a
  // valid user action while the server call is outstanding.
  const signingControlsBusy = signing || broadcasting;
  const approvalMode = getReviewApprovalMode(approvalAction, txData, state.draftId, isDraftMode);
  const showPayjoinNotice = payjoinStatus === 'idle' && isPayjoinCandidate({ state, wallet, txData: txData ?? null });

  return (
    <div className="space-y-6">
      <TransactionSummary
        state={state}
        flowData={flowData}
        txData={txData}
        payjoinStatus={payjoinStatus}
        payjoinOriginalTxData={payjoinOriginalTxData}
        changeAmount={changeAmount}
        selectedTotal={selectedTotal}
        estimatedFee={estimatedFee}
        totalOutputAmount={totalOutputAmount}
        txTypeLabel={txTypeLabel}
        isDraftMode={isDraftMode}
        format={format}
        goToStep={goToStep}
        interactionLocked={signing || broadcasting || savingDraft}
      />

      <PayjoinRoundOneNotice visible={showPayjoinNotice} />

      <PayjoinProposalPanel
        status={payjoinStatus}
        originalTxData={payjoinOriginalTxData}
        proposalTxData={txData ?? null}
        busy={signingControlsBusy}
        format={format}
        onSignPayjoin={onDownloadPsbt}
        onSendWithoutPayjoin={onSendWithoutPayjoin}
      />

      {/* Multi-sig Signing Panel */}
      {isMultiSig && devices.length > 0 && (
        <SigningFlow
          devices={devices}
          signedDevices={signedDevices}
          requiredSignatures={requiredSignatures}
          unsignedPsbt={unsignedPsbt}
          signingDeviceId={signingDeviceId}
          uploadingDeviceId={uploadingDeviceId}
          signing={signingControlsBusy}
          onSignWithDevice={onSignWithDevice}
          onMarkDeviceSigned={onMarkDeviceSigned}
          onDownloadPsbt={onDownloadPsbt}
          onDeviceFileUpload={handleDeviceFileUpload}
          setSigningDeviceId={setSigningDeviceId}
          setQrSigningDevice={setQrSigningDevice}
          deviceFileInputRefs={deviceFileInputRefs}
        />
      )}

      {/* Signing panel for single-sig */}
      {!isMultiSig && (txData || unsignedPsbt) && (
        <UsbSigning
          devices={devices}
          signedDevices={signedDevices}
          unsignedPsbt={unsignedPsbt}
          signingDeviceId={signingDeviceId}
          signing={signingControlsBusy}
          usbLocked={payjoinUsbBlocked}
          onSignWithDevice={onSignWithDevice}
          onDownloadPsbt={onDownloadPsbt}
          onFileUpload={handleFileUpload}
          setSigningDeviceId={setSigningDeviceId}
          setQrSigningDevice={setQrSigningDevice}
          fileInputRef={fileInputRef}
        />
      )}

      <DraftActions
        isMultiSig={isMultiSig}
        isDraftMode={isDraftMode}
        isReadyToSign={isReadyToSign}
        canBroadcast={!!canBroadcast}
        txData={txData}
        signing={signing}
        broadcasting={broadcasting}
        savingDraft={savingDraft}
        saveDraftLocked={isPayjoinStatusIn('draftLocked', payjoinStatus)}
        onSign={onSign}
        onBroadcast={onBroadcast}
        onSaveDraft={onSaveDraft}
        approvalMode={approvalMode}
        onBroadcastSigned={onBroadcastSigned}
        prevStep={prevStep}
      />

      {/* QR Signing Modal */}
      <QrSigning
        qrSigningDevice={qrSigningDevice}
        unsignedPsbt={unsignedPsbt}
        onProcessQrSignedPsbt={onProcessQrSignedPsbt}
        setQrSigningDevice={setQrSigningDevice}
      />
    </div>
  );
}
