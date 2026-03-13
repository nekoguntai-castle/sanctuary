/**
 * SendTransactionWizard Component
 *
 * Main orchestrator for the transaction wizard.
 * Wraps everything in the SendTransactionProvider and renders the current step.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import { SendTransactionProvider, useSendTransaction } from '../../contexts/send';
import { useSendTransactionActions } from '../../hooks/send/useSendTransactionActions';
import { useHardwareWallet } from '../../hooks/useHardwareWallet';
import { createLogger } from '../../utils/logger';
import { WizardNavigation } from './WizardNavigation';
import {
  TypeSelection,
  OutputsStep,
  ReviewStep,
} from './steps';
import { isMultisigType } from '../../types';
import type { Wallet, UTXO, Device, FeeEstimate } from '../../types';
import type { BlockData, QueuedBlocksSummary } from '../../src/api/bitcoin';
import type { SerializableTransactionState, WalletAddress } from '../../contexts/send/types';

const log = createLogger('SendTxWizard');

// ============================================================================
// WIZARD CONTENT (INNER COMPONENT)
// ============================================================================

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

  // Debug logging for draft mode
  log.debug('WizardContent state', {
    isDraftMode: state.isDraftMode,
    hasUnsignedPsbt: !!state.unsignedPsbt,
    unsignedPsbtLength: state.unsignedPsbt?.length,
    hasDraftTxData: !!draftTxData,
    currentStep,
  });

  // For draft mode, construct initial txData from draft data
  // This is computed before the actions hook so we can pass it as initial values
  const draftInitialTxData = useMemo(() => {
    if (!state.isDraftMode || !draftTxData || !state.unsignedPsbt) {
      return null;
    }

    log.debug('Computing draft initial txData', {
      isDraftMode: state.isDraftMode,
      hasDraftTxData: !!draftTxData,
      hasUnsignedPsbt: !!state.unsignedPsbt,
      unsignedPsbtLength: state.unsignedPsbt?.length,
    });

    // Construct TransactionData from draft
    // Look up full UTXO data including amounts from the utxos prop
    const utxoList = draftTxData.selectedUtxoIds.map(id => {
      const [txid, voutStr] = id.split(':');
      const vout = parseInt(voutStr, 10);
      const fullUtxo = utxos.find(u => u.txid === txid && u.vout === vout);
      return {
        txid,
        vout,
        address: fullUtxo?.address || '',
        amount: fullUtxo?.amount || 0,
      };
    });

    // Use stored outputs from state (includes decoys if saved properly)
    const outputList = state.outputs.map(o => ({
      address: o.address,
      amount: parseInt(o.amount, 10) || 0,
    }));

    return {
      psbtBase64: state.unsignedPsbt,
      fee: draftTxData.fee,
      totalInput: draftTxData.totalInput,
      totalOutput: draftTxData.totalOutput,
      changeAmount: draftTxData.changeAmount,
      changeAddress: draftTxData.changeAddress,
      effectiveAmount: draftTxData.effectiveAmount,
      utxos: utxoList,
      outputs: outputList,
      inputPaths: draftTxData.inputPaths,
    };
  }, [state.isDraftMode, draftTxData, state.unsignedPsbt, state.outputs, utxos]);

  // Transaction actions hook - pass initial values for draft mode
  const actions = useSendTransactionActions({
    walletId,
    wallet,
    state,
    initialPsbt: state.isDraftMode ? state.unsignedPsbt : undefined,
    initialTxData: draftInitialTxData || undefined,
  });

  // Effective txData - use draft data or actions data
  const effectiveTxData = state.isDraftMode ? draftInitialTxData : actions.txData;

  // Reset transaction data when navigating away from review step
  // This ensures the transaction is re-created with updated settings when returning
  const prevStepRef = React.useRef(currentStep);
  useEffect(() => {
    if (prevStepRef.current === 'review' && currentStep !== 'review' && !state.isDraftMode) {
      actions.reset();
    }
    prevStepRef.current = currentStep;
  }, [currentStep, state.isDraftMode, actions]);

  // Auto-create transaction when entering review step (not for draft mode)
  // Don't retry if there's already an error (prevents infinite loop on API failure)
  useEffect(() => {
    if (currentStep === 'review' && !state.isDraftMode && !actions.txData && !actions.isCreating && !actions.error && isReadyToSign) {
      actions.createTransaction();
    }
  }, [currentStep, state.isDraftMode, actions.txData, actions.isCreating, actions.error, isReadyToSign]);

  // Handle sign & broadcast (single-sig flow)
  const handleSignAndBroadcast = useCallback(async () => {
    log.debug('handleSignAndBroadcast called', {
      hasSignedRawTx: !!actions.signedRawTx,
      signedRawTxPreview: actions.signedRawTx ? actions.signedRawTx.substring(0, 50) + '...' : null
    });

    // If we already have a signed raw tx from Trezor, just broadcast it
    if (actions.signedRawTx) {
      log.info('Broadcasting with signedRawTx');
      await actions.broadcastTransaction(undefined, actions.signedRawTx);
      return;
    }

    // First create the transaction if not already created
    let txData = actions.txData;
    if (!txData) {
      txData = await actions.createTransaction();
      if (!txData) return;
    }

    // If hardware wallet is connected, sign with it
    if (hardwareWallet.isConnected && hardwareWallet.device) {
      const signResult = await hardwareWallet.signPSBT(txData.psbtBase64);
      if (signResult.psbt || signResult.rawTx) {
        await actions.broadcastTransaction(signResult.psbt, signResult.rawTx);
      }
      return;
    }

    // If any device has signed (USB or file upload) and we have a signed PSBT, broadcast it
    if (actions.signedDevices.size > 0 && actions.unsignedPsbt) {
      await actions.broadcastTransaction(actions.unsignedPsbt);
      return;
    }

    // No signing method available - create the PSBT for download
    // User will need to download, sign externally, and upload
    if (!actions.unsignedPsbt) {
      await actions.createTransaction();
    }
  }, [actions, hardwareWallet]);

  // Handle sign for multi-sig (just sign, don't broadcast)
  const handleSign = useCallback(async () => {
    // For multi-sig, just create the PSBT if not created
    if (!actions.txData) {
      await actions.createTransaction();
    }
    // User will then download PSBT or sign via hardware wallet
  }, [actions]);

  // Handle save draft
  const handleSaveDraft = useCallback(async () => {
    await actions.saveDraft();
  }, [actions]);

  // Check if multi-sig
  const isMultiSig = isMultisigType(wallet.type);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 'type':
        return <TypeSelection />;
      case 'outputs':
        return <OutputsStep />;
      case 'review':
        return (
          <ReviewStep
            onSign={isMultiSig ? handleSign : undefined}
            onBroadcast={!isMultiSig ? handleSignAndBroadcast : undefined}
            onSaveDraft={state.isDraftMode ? undefined : handleSaveDraft}
            signing={actions.isSigning}
            broadcasting={actions.isBroadcasting || actions.isCreating}
            savingDraft={actions.isSavingDraft}
            // Pass additional props for signing UI
            txData={effectiveTxData}
            unsignedPsbt={state.isDraftMode ? state.unsignedPsbt : actions.unsignedPsbt}
            signedDevices={actions.signedDevices}
            payjoinStatus={actions.payjoinStatus}
            onDownloadPsbt={actions.downloadPsbt}
            onUploadSignedPsbt={actions.uploadSignedPsbt}
            onSignWithDevice={actions.signWithDevice}
            onMarkDeviceSigned={actions.markDeviceSigned}
            onProcessQrSignedPsbt={actions.processQrSignedPsbt}
            onBroadcastSigned={() => actions.broadcastTransaction()}
            hardwareWallet={hardwareWallet}
            isDraftMode={state.isDraftMode}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header with cancel button */}
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <h1 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          Send from {wallet.name}
        </h1>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>

      {/* Error display */}
      {actions.error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{actions.error}</p>
          <button
            onClick={actions.clearError}
            className="text-xs text-red-600 dark:text-red-400 underline mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step Navigation */}
      {currentStep !== 'review' && (
        <div className="mb-8">
          <WizardNavigation hideButtons />
        </div>
      )}

      {/* Step Content */}
      <div className="surface-elevated rounded-2xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
        {renderStep()}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WIZARD COMPONENT
// ============================================================================

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

export interface SendTransactionWizardProps {
  // Required wallet data
  wallet: Wallet;
  devices: Device[];
  utxos: UTXO[];
  walletAddresses: WalletAddress[];

  // Fee data
  fees: FeeEstimate | null;
  mempoolBlocks?: BlockData[];
  queuedBlocksSummary?: QueuedBlocksSummary | null;

  // Optional initial state (for resuming drafts)
  initialState?: Partial<SerializableTransactionState>;

  // Draft transaction data (for locked PSBT viewing)
  draftTxData?: DraftTransactionData;

  // Fee calculation function
  calculateFee?: (numInputs: number, numOutputs: number, rate: number) => number;

  // Callbacks
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
