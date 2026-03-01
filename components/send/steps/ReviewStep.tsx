/**
 * ReviewStep Component
 *
 * Final step of the transaction wizard.
 * Shows transaction summary and handles signing/broadcasting.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSendTransaction } from '../../../contexts/send';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { createLogger } from '../../../utils/logger';
import { lookupAddresses, type AddressLookupResult } from '../../../src/api/bitcoin';
import type { TransactionData } from '../../../hooks/useSendTransactionActions';
import { isMultisigType } from '../../../types';
import type { Device } from '../../../types';
import type { FlowInput, FlowOutput } from '../../TransactionFlowPreview';
import { TransactionSummary } from './review/TransactionSummary';
import { SigningFlow } from './review/SigningFlow';
import { UsbSigning } from './review/UsbSigning';
import { QrSigning } from './review/QrSigning';
import { DraftActions } from './review/DraftActions';

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
  error?: string | null;
  txData?: TransactionData | null;
  unsignedPsbt?: string | null;
  signedDevices?: Set<string>;
  payjoinStatus?: 'idle' | 'attempting' | 'success' | 'failed';
  onCreateTransaction?: () => Promise<TransactionData | null>;
  onDownloadPsbt?: () => void;
  onUploadSignedPsbt?: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  onSignWithDevice?: (device: Device) => Promise<boolean>;
  onMarkDeviceSigned?: (deviceId: string) => void;
  onProcessQrSignedPsbt?: (signedPsbt: string, deviceId: string) => void;
  onBroadcastSigned?: () => Promise<boolean>;
  hardwareWallet?: any;
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
  error,
  txData,
  unsignedPsbt,
  signedDevices = new Set(),
  payjoinStatus = 'idle',
  onCreateTransaction,
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

  const { format, formatFiat } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null);
  const [qrSigningDevice, setQrSigningDevice] = useState<Device | null>(null);
  const [uploadingDeviceId, setUploadingDeviceId] = useState<string | null>(null);
  const [addressLookup, setAddressLookup] = useState<Record<string, AddressLookupResult>>({});

  // Fetch wallet labels for output addresses (to detect internal transfers)
  useEffect(() => {
    const addresses = state.outputs
      .map(o => o.address)
      .filter(addr => addr && addr.length > 0);

    // Also include change/decoy addresses if available
    if (txData?.changeAddress) {
      addresses.push(txData.changeAddress);
    }
    if (txData?.decoyOutputs) {
      addresses.push(...txData.decoyOutputs.map(d => d.address));
    }

    if (addresses.length === 0) return;

    lookupAddresses(addresses)
      .then(response => {
        setAddressLookup(response.lookup);
      })
      .catch(err => {
        log.warn('Failed to lookup addresses', { error: String(err) });
      });
  }, [state.outputs, txData?.changeAddress, txData?.decoyOutputs]);

  // Calculate change amount
  const changeAmount = useMemo(() => {
    if (state.outputs.some(o => o.sendMax)) {
      return 0;
    }
    return Math.max(0, selectedTotal - totalOutputAmount - estimatedFee);
  }, [selectedTotal, totalOutputAmount, estimatedFee, state.outputs]);

  // Create a set of known wallet addresses for quick lookup
  const knownAddresses = useMemo(() => {
    return new Set(walletAddresses.map(wa => wa.address));
  }, [walletAddresses]);

  // Helper to get label for an address if it belongs to any wallet in the app
  const getAddressLabel = useCallback((address: string): string | undefined => {
    // First check if it's from the current (sending) wallet
    if (knownAddresses.has(address)) {
      return wallet.name;
    }
    // Then check if it belongs to another wallet (from the lookup)
    const lookupResult = addressLookup[address];
    if (lookupResult) {
      return lookupResult.walletName;
    }
    return undefined;
  }, [knownAddresses, wallet.name, addressLookup]);

  // Build flow visualization data
  const flowData = useMemo(() => {
    // Get selected UTXOs for inputs
    const selectedUtxoIds = state.selectedUTXOs;
    const inputUtxos = selectedUtxoIds.size > 0
      ? utxos.filter(u => selectedUtxoIds.has(`${u.txid}:${u.vout}`))
      : spendableUtxos;

    // Build inputs from actual txData if available, otherwise estimate from UTXOs
    const inputs: FlowInput[] = txData?.utxos
      ? txData.utxos.map(u => {
          // Use data from txData if available (draft mode includes address/amount)
          // Fall back to lookup from utxos array if needed
          const hasData = u.address && u.amount;
          const utxo = hasData ? null : utxos.find(ux => ux.txid === u.txid && ux.vout === u.vout);
          const address = u.address || utxo?.address || '';
          return {
            txid: u.txid,
            vout: u.vout,
            address,
            amount: u.amount || utxo?.amount || 0,
            label: getAddressLabel(address),
          };
        })
      : inputUtxos.map(u => ({
          txid: u.txid,
          vout: u.vout,
          address: u.address,
          amount: u.amount,
          label: getAddressLabel(u.address),
        }));

    // Build outputs - prefer txData.outputs (includes decoys) over state.outputs
    const outputs: FlowOutput[] = txData?.outputs && txData.outputs.length > 0
      ? txData.outputs.map(o => ({
          address: o.address,
          amount: o.amount,
          isChange: false,
          label: getAddressLabel(o.address),
        }))
      : state.outputs.map(o => ({
          address: o.address,
          amount: o.sendMax
            ? selectedTotal - (txData?.fee || estimatedFee)
            : parseInt(o.amount, 10) || 0,
          isChange: false,
          label: getAddressLabel(o.address),
        }));

    // Add decoy outputs if present (these are change outputs distributed for privacy)
    // Or add single change output if no decoys
    const actualChangeAmount = txData?.changeAmount ?? changeAmount;
    if (txData?.decoyOutputs && txData.decoyOutputs.length > 0) {
      txData.decoyOutputs.forEach(decoy => {
        outputs.push({
          address: decoy.address,
          amount: decoy.amount,
          isChange: true,
          label: getAddressLabel(decoy.address),
        });
      });
    } else if (actualChangeAmount > 0) {
      const changeAddr = txData?.changeAddress || 'Change address';
      outputs.push({
        address: changeAddr,
        amount: actualChangeAmount,
        isChange: true,
        label: getAddressLabel(changeAddr),
      });
    }

    const totalInput = txData?.totalInput ?? selectedTotal;
    const totalOutput = txData?.totalOutput ?? (totalOutputAmount + actualChangeAmount);
    const fee = txData?.fee ?? estimatedFee;

    return { inputs, outputs, totalInput, totalOutput, fee };
  }, [state.outputs, state.selectedUTXOs, utxos, spendableUtxos, txData, selectedTotal, totalOutputAmount, estimatedFee, changeAmount, getAddressLabel]);

  // Transaction type label
  const txTypeLabel = useMemo(() => {
    switch (state.transactionType) {
      case 'consolidation':
        return 'Consolidation';
      case 'sweep':
        return 'Sweep';
      default:
        return 'Standard Send';
    }
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
  const requiredSignatures = typeof wallet.quorum === 'object'
    ? wallet.quorum.m
    : wallet.quorum || 1;

  // Handle file upload (single-sig)
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onUploadSignedPsbt) {
      await onUploadSignedPsbt(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle per-device file upload (multisig)
  const handleDeviceFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, deviceId: string) => {
    const device = devices.find(d => d.id === deviceId);
    const fingerprint = device?.fingerprint;
    log.debug('handleDeviceFileUpload called', { deviceId, fingerprint, hasFile: !!event.target.files?.[0], hasCallback: !!onUploadSignedPsbt });
    const file = event.target.files?.[0];
    if (file && onUploadSignedPsbt) {
      log.debug('Calling onUploadSignedPsbt', { fileName: file.name, fileSize: file.size, fingerprint });
      setUploadingDeviceId(deviceId);
      try {
        // Pass deviceId and fingerprint to validate and track which device signed
        await onUploadSignedPsbt(file, deviceId, fingerprint);
        log.debug('onUploadSignedPsbt completed');
      } catch (err: unknown) {
        log.error('onUploadSignedPsbt failed', { error: err });
        // Show error to user
        if (err instanceof Error) {
          alert(err.message);
        }
      } finally {
        setUploadingDeviceId(null);
      }
    } else {
      log.debug('Upload skipped - no file or no callback');
    }
    // Reset input
    const inputRef = deviceFileInputRefs.current[deviceId];
    if (inputRef) {
      inputRef.value = '';
    }
  };

  // Check if we have enough signatures for multi-sig
  const hasEnoughSignatures = isMultiSig
    ? signedDevices.size >= requiredSignatures
    : signedDevices.size > 0 || (hardwareWallet?.isConnected && hardwareWallet?.device);

  // Can broadcast?
  const canBroadcast = txData && (hasEnoughSignatures || signedDevices.has('psbt-signed'));

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
