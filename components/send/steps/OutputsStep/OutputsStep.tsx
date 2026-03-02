/**
 * OutputsStep Component
 *
 * Combined step for recipients, coin control, and fees.
 * All transaction composition happens here so max calculations are accurate.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { WizardNavigation } from '../../WizardNavigation';
import { useSendTransaction } from '../../../../contexts/send';
import { useCurrency } from '../../../../contexts/CurrencyContext';
import { parseBip21Uri } from '../../../../utils/bip21Parser';
import { validateAddress, addressMatchesNetwork } from '../../../../utils/validateAddress';
import { createLogger } from '../../../../utils/logger';
import { CoinControlPanel } from './CoinControlPanel';
import { FeePanel } from './FeePanel';
import { AdvancedOptionsPanel } from './AdvancedOptionsPanel';
import { useTransactionComposition } from './hooks/useTransactionComposition';
import { SummaryBar } from './sections/SummaryBar';
import { WarningsSection } from './sections/WarningsSection';
import { RecipientsSection } from './sections/RecipientsSection';

const log = createLogger('OutputsStep');

export function OutputsStep() {
  const {
    state,
    dispatch,
    wallet,
    utxos,
    spendableUtxos,
    addOutput,
    removeOutput,
    updateOutputAddress,
    updateOutputAmount,
    toggleSendMax,
    walletAddresses,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    toggleUtxo,
    selectAllUtxos,
    clearUtxoSelection,
    toggleCoinControl,
    fees,
    mempoolBlocks,
    queuedBlocksSummary,
    setFeeRate,
  } = useSendTransaction();

  const { unit, format, formatFiat } = useCurrency();

  // Panel expansion states
  const [coinControlExpanded, setCoinControlExpanded] = useState(state.showCoinControl);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // Video ref for QR scanning
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isConsolidation = state.transactionType === 'consolidation';
  const isSweep = state.transactionType === 'sweep';

  // Transaction composition hook (UTXO grouping, max calc, fee warnings, privacy)
  const {
    available,
    manuallyFrozen,
    draftLocked,
    effectiveAvailable,
    maxSendable,
    calculateMaxForOutput,
    remainingNeeded,
    feeWarnings,
    privacyAnalysis,
    utxoPrivacyMap,
  } = useTransactionComposition({
    walletId: wallet.id,
    utxos,
    spendableUtxos,
    showCoinControl: state.showCoinControl,
    selectedUTXOs: state.selectedUTXOs,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    feeRate: state.feeRate,
    fees,
    outputs: state.outputs,
  });

  // Auto-set consolidation address to first unused receive address if empty
  useEffect(() => {
    if (isConsolidation && state.outputs.length > 0 && !state.outputs[0].address && walletAddresses.length > 0) {
      const receiveAddresses = walletAddresses.filter(a => !a.isChange);
      if (receiveAddresses.length > 0) {
        const firstUnused = receiveAddresses.find(a => !a.used);
        const selectedAddress = firstUnused ? firstUnused.address : receiveAddresses[0].address;
        updateOutputAddress(0, selectedAddress);
      }
    }
  }, [isConsolidation, state.outputs, walletAddresses, updateOutputAddress]);

  // Handle address change with BIP21 parsing
  const handleAddressChange = useCallback((index: number, value: string) => {
    if (value.toLowerCase().startsWith('bitcoin:')) {
      try {
        const parsed = parseBip21Uri(value);
        if (!parsed) {
          updateOutputAddress(index, value);
          return;
        }

        updateOutputAddress(index, parsed.address);
        if (parsed.amount) {
          updateOutputAmount(index, parsed.amount.toString());
        }

        if (parsed.payjoinUrl) {
          const walletNetwork = (wallet.network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
          const addressMatches = addressMatchesNetwork(parsed.address, walletNetwork);

          if (addressMatches) {
            dispatch({ type: 'SET_PAYJOIN_URL', url: parsed.payjoinUrl });
          } else {
            dispatch({ type: 'SET_PAYJOIN_URL', url: null });
            log.warn('Payjoin disabled: Address network mismatch', {
              walletNetwork,
              message: 'Payjoin requires sender and receiver to be on the same network',
            });
          }
        }
        return;
      } catch {
        // Not a valid BIP21
      }
    }

    updateOutputAddress(index, value);

    if (index === 0 && state.payjoinUrl) {
      dispatch({ type: 'SET_PAYJOIN_URL', url: null });
    }
  }, [updateOutputAddress, updateOutputAmount, dispatch, state.payjoinUrl, wallet.network]);

  // Validate addresses on change
  useEffect(() => {
    const validationResults = state.outputs.map((output) => {
      if (!output.address.trim()) return null;
      return validateAddress(output.address);
    });

    dispatch({ type: 'SET_OUTPUTS_VALID', valid: validationResults });
  }, [state.outputs, dispatch]);

  // Handle QR scan
  const handleScanQR = useCallback((index: number) => {
    if (state.scanningOutputIndex === index) {
      dispatch({ type: 'SET_SCANNING_OUTPUT_INDEX', index: null });
    } else {
      dispatch({ type: 'SET_SCANNING_OUTPUT_INDEX', index });
    }
  }, [state.scanningOutputIndex, dispatch]);

  // Format amount for display
  const formatDisplayValue = useCallback((sats: number) => {
    if (unit === 'btc') {
      return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, '');
    }
    return sats.toString();
  }, [unit]);

  // Get display value for output
  const getDisplayValue = useCallback((output: typeof state.outputs[0]) => {
    if (output.displayValue !== undefined) {
      return output.displayValue;
    }
    if (!output.amount) return '';
    const sats = parseInt(output.amount, 10);
    if (isNaN(sats)) return output.amount;
    return formatDisplayValue(sats);
  }, [formatDisplayValue]);

  // Handle amount change
  const handleAmountChange = useCallback((index: number, displayValue: string, satsValue: string) => {
    let finalSats = satsValue;
    if (unit === 'btc' && displayValue) {
      const btcValue = parseFloat(displayValue);
      if (!isNaN(btcValue)) {
        finalSats = Math.round(btcValue * 100_000_000).toString();
      }
    }
    updateOutputAmount(index, finalSats, displayValue);
  }, [unit, updateOutputAmount]);

  // Handle amount blur
  const handleAmountBlur = useCallback((index: number) => {
    const output = state.outputs[index];
    if (output.displayValue !== undefined) {
      dispatch({
        type: 'UPDATE_OUTPUT',
        index,
        field: 'displayValue',
        value: undefined,
      });
    }
  }, [state.outputs, dispatch]);

  // Toggle coin control panel
  const handleToggleCoinControl = useCallback(() => {
    const newExpanded = !coinControlExpanded;
    setCoinControlExpanded(newExpanded);
    if (newExpanded && !state.showCoinControl) {
      toggleCoinControl();
    }
  }, [coinControlExpanded, state.showCoinControl, toggleCoinControl]);

  // Advanced options handlers
  const handleRbfChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_RBF_ENABLED', enabled });
  }, [dispatch]);

  const handleSubtractFeesChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_SUBTRACT_FEES', enabled });
  }, [dispatch]);

  const handleDecoysChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_USE_DECOYS', enabled });
  }, [dispatch]);

  const handleDecoyCountChange = useCallback((count: number) => {
    dispatch({ type: 'SET_DECOY_COUNT', count });
  }, [dispatch]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          {isConsolidation ? 'Consolidation' : isSweep ? 'Sweep' : 'Compose Transaction'}
        </h2>
        <p className="text-sm text-sanctuary-500 mt-1">
          {isConsolidation
            ? 'Select UTXOs to consolidate and destination'
            : isSweep
              ? 'Sweep all funds to a destination'
              : 'Configure your transaction'
          }
        </p>
      </div>

      <SummaryBar
        effectiveAvailable={effectiveAvailable}
        estimatedFee={estimatedFee}
        feeRate={state.feeRate}
        maxSendable={maxSendable}
        format={format}
      />

      <WarningsSection
        spendableCount={spendableUtxos.length}
        draftLocked={draftLocked}
        manuallyFrozen={manuallyFrozen}
        feeWarnings={feeWarnings}
      />

      <RecipientsSection
        outputs={state.outputs}
        outputsValid={state.outputsValid}
        transactionType={state.transactionType}
        scanningOutputIndex={state.scanningOutputIndex}
        payjoinUrl={state.payjoinUrl}
        payjoinStatus={state.payjoinStatus}
        walletAddresses={walletAddresses}
        unit={unit}
        videoRef={videoRef}
        canvasRef={canvasRef}
        onAddressChange={handleAddressChange}
        onAmountChange={handleAmountChange}
        onAmountBlur={handleAmountBlur}
        onRemove={removeOutput}
        onToggleSendMax={toggleSendMax}
        onScanQR={handleScanQR}
        onAddOutput={addOutput}
        getDisplayValue={getDisplayValue}
        calculateMaxForOutput={calculateMaxForOutput}
        formatDisplayValue={formatDisplayValue}
      />

      {/* Collapsible Panels */}
      <div className="space-y-2">
        <CoinControlPanel
          expanded={coinControlExpanded}
          showCoinControl={state.showCoinControl}
          selectedUTXOs={state.selectedUTXOs}
          available={available}
          manuallyFrozen={manuallyFrozen}
          draftLocked={draftLocked}
          remainingNeeded={remainingNeeded}
          privacyAnalysis={privacyAnalysis}
          utxoPrivacyMap={utxoPrivacyMap}
          onTogglePanel={handleToggleCoinControl}
          onSelectAll={selectAllUtxos}
          onClearSelection={clearUtxoSelection}
          onToggleCoinControl={toggleCoinControl}
          onToggleUtxo={toggleUtxo}
          format={format}
          formatFiat={formatFiat}
        />

        <FeePanel
          expanded={feeExpanded}
          feeRate={state.feeRate}
          estimatedFee={estimatedFee}
          fees={fees}
          mempoolBlocks={mempoolBlocks}
          queuedBlocksSummary={queuedBlocksSummary}
          onToggle={() => setFeeExpanded(!feeExpanded)}
          onSetFeeRate={setFeeRate}
          format={format}
        />

        <AdvancedOptionsPanel
          expanded={advancedExpanded}
          rbfEnabled={state.rbfEnabled}
          useDecoys={state.useDecoys}
          subtractFees={state.subtractFees}
          decoyCount={state.decoyCount}
          onToggle={() => setAdvancedExpanded(!advancedExpanded)}
          onRbfChange={handleRbfChange}
          onSubtractFeesChange={handleSubtractFeesChange}
          onDecoysChange={handleDecoysChange}
          onDecoyCountChange={handleDecoyCountChange}
        />
      </div>

      {/* Navigation */}
      <WizardNavigation />
    </div>
  );
}
