/**
 * ReviewStep Component
 *
 * Final step of the transaction wizard.
 * Shows transaction summary and handles signing/broadcasting.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useSendTransaction } from '../../../contexts/send';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { createLogger } from '../../../utils/logger';
import type { TransactionData } from '../../../hooks/send/useSendTransactionActions';
import { isMultisigType } from '../../../types';
import type { Device } from '../../../types';
import { TransactionSummary } from './review/TransactionSummary';
import { SigningFlow } from './review/SigningFlow';
import { UsbSigning } from './review/UsbSigning';
import { QrSigning } from './review/QrSigning';
import { DraftActions } from './review/DraftActions';
import { useReviewAddressLookup } from './review/useReviewAddressLookup';
import { useReviewStepUploads } from './review/useReviewStepUploads';
import {
  buildReviewFlowData,
  canBroadcastReviewTransaction,
  getKnownAddressSet,
  getRequiredSignatures,
  getReviewAddressLabel,
  getReviewChangeAmount,
  getReviewTransactionTypeLabel,
  hasEnoughReviewSignatures,
} from './review/reviewStepData';

const log = createLogger('ReviewStep');

export interface ReviewStepProps {
  // Handlers from parent
  onSign?: () => void;
  onBroadcast?: () => void;
  onSaveDraft?: () => void;
  // Loading states
  signing?: boolean;
  broadcasting?: boolean;
  savingDraft?: boolean;
  // Additional props for signing UI
  txData?: TransactionData | null;
  unsignedPsbt?: string | null;
  signedDevices?: Set<string>;
  payjoinStatus?: 'idle' | 'attempting' | 'success' | 'failed';
  onDownloadPsbt?: () => void;
  onUploadSignedPsbt?: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onProcessQrSignedPsbt?: (signedPsbt: string, deviceId: string) => void;
  onBroadcastSigned?: () => Promise<boolean>;
  hardwareWallet?: { isConnected: boolean; device: unknown };
  // Draft mode - locks editing, shows draft info
  isDraftMode?: boolean;
}

export function ReviewStep({
  onSign,
  onBroadcast,
  onSaveDraft,
  signing = false,
  broadcasting = false,
  savingDraft = false,
  txData,
  unsignedPsbt,
  signedDevices = new Set(),
  payjoinStatus = 'idle',
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

  const { format } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null);
  const [qrSigningDevice, setQrSigningDevice] = useState<Device | null>(null);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const addressLookup = useReviewAddressLookup(state.outputs, txData);

  // Calculate change amount
  const changeAmount = useMemo(() => {
    return getReviewChangeAmount(state.outputs, selectedTotal, totalOutputAmount, estimatedFee);
  }, [selectedTotal, totalOutputAmount, estimatedFee, state.outputs]);

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
    });
  }, [state.outputs, state.selectedUTXOs, utxos, spendableUtxos, txData, selectedTotal, totalOutputAmount, estimatedFee, changeAmount, getAddressLabel]);

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

  return (
    <div className="space-y-6">
      <TransactionSummary
        state={state}
        flowData={flowData}
        txData={txData}
        payjoinStatus={payjoinStatus}
        changeAmount={changeAmount}
        selectedTotal={selectedTotal}
        estimatedFee={estimatedFee}
        totalOutputAmount={totalOutputAmount}
        txTypeLabel={txTypeLabel}
        isDraftMode={isDraftMode}
        format={format}
        goToStep={goToStep}
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
          signing={signing}
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
          signing={signing}
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
        onSign={onSign}
        onBroadcast={onBroadcast}
        onSaveDraft={onSaveDraft}
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
