/**
 * Transaction Composition Hook
 *
 * Encapsulates UTXO grouping, max calculations, fee warnings, and privacy analysis.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { analyzeSpendPrivacy, getWalletPrivacy, type SpendPrivacyAnalysis, type UtxoPrivacyInfo } from '../../../../../src/api/transactions';
import type { UTXO } from '../../../../../types';
import { createLogger } from '../../../../../utils/logger';

const log = createLogger('TransactionComposition');

interface TransactionCompositionInput {
  walletId: string;
  utxos: UTXO[];
  spendableUtxos: UTXO[];
  showCoinControl: boolean;
  selectedUTXOs: Set<string>;
  selectedTotal: number;
  estimatedFee: number;
  totalOutputAmount: number;
  feeRate: number;
  fees: { hourFee?: number; minimumFee?: number } | null;
  outputs: Array<{ amount: string; sendMax: boolean }>;
}

export function useTransactionComposition(input: TransactionCompositionInput) {
  const {
    walletId,
    utxos,
    spendableUtxos,
    showCoinControl,
    selectedUTXOs,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    feeRate,
    fees,
    outputs,
  } = input;

  // Privacy analysis state
  const [privacyAnalysis, setPrivacyAnalysis] = useState<SpendPrivacyAnalysis | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [utxoPrivacyMap, setUtxoPrivacyMap] = useState<Map<string, UtxoPrivacyInfo>>(new Map());

  // Group UTXOs by status
  const { available, manuallyFrozen, draftLocked } = useMemo(() => {
    const available: UTXO[] = [];
    const manuallyFrozen: UTXO[] = [];
    const draftLocked: UTXO[] = [];

    for (const utxo of utxos) {
      if (utxo.spent) continue;
      if (utxo.frozen) {
        manuallyFrozen.push(utxo);
      } else if (utxo.lockedByDraftId || utxo.spendable === false) {
        draftLocked.push(utxo);
      } else {
        available.push(utxo);
      }
    }

    return { available, manuallyFrozen, draftLocked };
  }, [utxos]);

  // Calculate the effective available balance (respects coin control selection)
  const effectiveAvailable = useMemo(() => {
    if (showCoinControl && selectedUTXOs.size > 0) {
      return selectedTotal;
    }
    return spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
  }, [showCoinControl, selectedUTXOs.size, selectedTotal, spendableUtxos]);

  // Calculate max sendable (available minus fee)
  const maxSendable = useMemo(() => {
    return Math.max(0, effectiveAvailable - estimatedFee);
  }, [effectiveAvailable, estimatedFee]);

  // Calculate max for each output
  const calculateMaxForOutput = useCallback((index: number) => {
    const otherTotal = outputs.reduce((sum, o, i) => {
      if (i === index || o.sendMax) return sum;
      return sum + (parseInt(o.amount, 10) || 0);
    }, 0);

    return Math.max(0, effectiveAvailable - otherTotal - estimatedFee);
  }, [outputs, effectiveAvailable, estimatedFee]);

  // Calculate remaining balance needed
  const remainingNeeded = useMemo(() => {
    if (!showCoinControl || selectedUTXOs.size === 0) return 0;
    const needed = totalOutputAmount + estimatedFee;
    return Math.max(0, needed - selectedTotal);
  }, [showCoinControl, selectedUTXOs.size, totalOutputAmount, estimatedFee, selectedTotal]);

  // Fee warnings
  const feeWarnings = useMemo(() => {
    const warnings: string[] = [];

    // Warning 1: Fee is excessive relative to amount being sent (>10% of amount)
    if (totalOutputAmount > 0 && estimatedFee > 0) {
      const feePercentage = (estimatedFee / totalOutputAmount) * 100;
      if (feePercentage > 10) {
        warnings.push(`Fee is ${feePercentage.toFixed(1)}% of the amount being sent`);
      }
    }

    // Warning 2: Fee rate is much higher than slow estimate (>2x)
    if (fees && feeRate > 0) {
      const slowRate = fees.hourFee || fees.minimumFee || 1;
      if (feeRate > slowRate * 2) {
        warnings.push(`Fee rate (${feeRate} sat/vB) is ${(feeRate / slowRate).toFixed(1)}x the economy rate (${slowRate} sat/vB)`);
      }
    }

    return warnings;
  }, [totalOutputAmount, estimatedFee, fees, feeRate]);

  // Fetch UTXO privacy data for display
  useEffect(() => {
    const fetchUtxoPrivacy = async () => {
      try {
        const data = await getWalletPrivacy(walletId);
        const privacyMap = new Map<string, UtxoPrivacyInfo>();
        for (const utxo of data.utxos) {
          // Use txid:vout as key to match how UTXOs are identified in the UI
          const key = `${utxo.txid}:${utxo.vout}`;
          privacyMap.set(key, utxo);
        }
        setUtxoPrivacyMap(privacyMap);
      } catch (error) {
        log.debug('Optional wallet privacy data fetch failed', { error });
        // Silently fail - privacy data is optional
      }
    };
    fetchUtxoPrivacy();
  }, [walletId]);

  // Fetch privacy analysis when UTXOs are selected
  useEffect(() => {
    if (!showCoinControl || selectedUTXOs.size < 1) {
      setPrivacyAnalysis(null);
      return;
    }

    const fetchPrivacy = async () => {
      setPrivacyLoading(true);
      try {
        const utxoIds = Array.from(selectedUTXOs);
        const analysis = await analyzeSpendPrivacy(walletId, utxoIds);
        setPrivacyAnalysis(analysis);
      } catch (err) {
        // Silently fail - privacy analysis is optional
        setPrivacyAnalysis(null);
      } finally {
        setPrivacyLoading(false);
      }
    };

    // Debounce to avoid too many API calls
    const timeoutId = setTimeout(fetchPrivacy, 300);
    return () => clearTimeout(timeoutId);
  }, [showCoinControl, selectedUTXOs, walletId]);

  return {
    available,
    manuallyFrozen,
    draftLocked,
    effectiveAvailable,
    maxSendable,
    calculateMaxForOutput,
    remainingNeeded,
    feeWarnings,
    privacyAnalysis,
    privacyLoading,
    utxoPrivacyMap,
  };
}
