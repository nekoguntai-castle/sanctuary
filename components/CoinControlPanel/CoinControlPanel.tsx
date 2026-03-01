/**
 * Coin Control Panel Component
 *
 * Main container for all coin control functionality with progressive disclosure.
 * Default state: Collapsed with minimal info "Coin Control (Auto)" or "Coin Control (3 selected)"
 * Expanded state: Full control with strategies, privacy scores, dust warnings, UTXO list
 *
 * Key UX Principle: Hidden for base users, powerful for advanced users
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronUp, Sliders, AlertTriangle, Loader2 } from 'lucide-react';
import type { WalletPrivacyResponse, SpendPrivacyAnalysis } from '../../src/api/transactions';
import { StrategySelector } from '../StrategySelector';
import type { UIStrategy } from '../StrategySelector';
import SpendPrivacyCard from '../SpendPrivacyCard';
import { useCurrency } from '../../contexts/CurrencyContext';
import * as transactionsApi from '../../src/api/transactions';
import { createLogger } from '../../utils/logger';
import type { CoinControlPanelProps } from './types';
import { strategyToApiStrategy } from './utils';
import { UtxoRow } from './UtxoRow';

const log = createLogger('CoinControl');

export const CoinControlPanel: React.FC<CoinControlPanelProps> = ({
  walletId,
  utxos,
  selectedUtxos,
  onToggleSelect,
  onSetSelectedUtxos,
  feeRate,
  targetAmount,
  strategy = 'auto',
  onStrategyChange,
  disabled = false,
  className = '',
}) => {
  const { format } = useCurrency();
  const [isExpanded, setIsExpanded] = useState(false);
  const [privacyData, setPrivacyData] = useState<WalletPrivacyResponse | null>(null);
  const [spendAnalysis, setSpendAnalysis] = useState<SpendPrivacyAnalysis | null>(null);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);

  // Refs for debounce and request tracking
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdRef = useRef<number>(0);

  // Calculate selected total
  const selectedTotal = useMemo(() => {
    return utxos
      .filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
      .reduce((acc, u) => acc + u.amount, 0);
  }, [utxos, selectedUtxos]);

  // Create privacy map for quick lookup
  const privacyMap = useMemo(() => {
    if (!privacyData) return new Map();
    return new Map(privacyData.utxos.map(p => [`${p.txid}:${p.vout}`, p]));
  }, [privacyData]);

  // Fetch wallet privacy data when panel expands
  useEffect(() => {
    let mounted = true;

    const fetchPrivacyData = async () => {
      if (isExpanded && !privacyData && !loadingPrivacy) {
        setLoadingPrivacy(true);
        try {
          const data = await transactionsApi.getWalletPrivacy(walletId);
          if (!mounted) return;
          setPrivacyData(data);
        } catch (err) {
          log.error('Failed to fetch wallet privacy', { error: err });
        } finally {
          if (mounted) setLoadingPrivacy(false);
        }
      }
    };
    fetchPrivacyData();

    return () => {
      mounted = false;
    };
  }, [isExpanded, walletId, privacyData, loadingPrivacy]);

  // Debounced spend analysis when selection changes
  useEffect(() => {
    if (!isExpanded || selectedUtxos.size === 0) {
      setSpendAnalysis(null);
      return;
    }

    // Clear any existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setLoadingAnalysis(true);

    // Increment request ID to track the latest request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      const utxoIds = Array.from(selectedUtxos);

      try {
        const analysis = await transactionsApi.analyzeSpendPrivacy(walletId, utxoIds);
        // Only update state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setSpendAnalysis(analysis);
        }
      } catch (err) {
        // Only log/handle error if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          log.error('Failed to analyze spend privacy', { error: err });
        }
      } finally {
        // Only update loading state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setLoadingAnalysis(false);
        }
      }
    }, 300); // Debounce 300ms

    // Cleanup function - clear timeout and increment request ID to invalidate in-flight requests
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      // Increment request ID to mark any in-flight requests as stale
      requestIdRef.current += 1;
    };
  }, [isExpanded, selectedUtxos, walletId]);

  // Handle strategy change - calls API for non-manual strategies
  const handleStrategyChange = useCallback(async (newStrategy: UIStrategy) => {
    if (disabled || loadingStrategy) return;

    // Expand panel when switching away from auto
    if (newStrategy !== 'auto' && !isExpanded) {
      setIsExpanded(true);
    }

    onStrategyChange?.(newStrategy);
    setStrategyError(null);

    // Manual strategy = clear selection and let user pick
    if (newStrategy === 'manual') {
      // Don't clear - user is taking over manual control
      return;
    }

    // For auto strategies, call the API to select UTXOs
    const apiStrategy = strategyToApiStrategy[newStrategy];
    if (!apiStrategy) return;

    // Need a target amount to select UTXOs
    if (targetAmount <= 0) {
      // Clear any existing selection - strategy will select when amount is entered
      onSetSelectedUtxos(new Set());
      return;
    }

    setLoadingStrategy(true);
    try {
      const result = await transactionsApi.selectUtxos(walletId, {
        amount: targetAmount,
        feeRate: feeRate || 1,
        strategy: apiStrategy,
      });

      // Convert selected UTXOs to Set of IDs
      const selectedIds = new Set(
        result.selected.map(u => `${u.txid}:${u.vout}`)
      );
      onSetSelectedUtxos(selectedIds);

      log.info('Strategy auto-selected UTXOs', {
        strategy: newStrategy,
        apiStrategy,
        count: result.selected.length,
        total: result.totalAmount,
      });
    } catch (err) {
      log.error('Failed to auto-select UTXOs', { error: err });
      setStrategyError(err instanceof Error ? err.message : 'Selection failed');
    } finally {
      setLoadingStrategy(false);
    }
  }, [disabled, loadingStrategy, isExpanded, onStrategyChange, walletId, targetAmount, feeRate, onSetSelectedUtxos]);

  // Handle manual UTXO toggle (only callable in manual mode)
  const handleManualToggle = useCallback((utxoId: string) => {
    onToggleSelect(utxoId);
  }, [onToggleSelect]);

  // Summary text for collapsed state
  const summaryText = useMemo(() => {
    if (selectedUtxos.size > 0) {
      return `${selectedUtxos.size} selected`;
    }
    return strategy === 'auto' ? 'Auto' : strategy.charAt(0).toUpperCase() + strategy.slice(1);
  }, [selectedUtxos.size, strategy]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Collapsible Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => !disabled && setIsExpanded(!isExpanded)}
          disabled={disabled}
          className={`flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <Sliders className="w-4 h-4 mr-2" />
          Coin Control ({summaryText})
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 ml-1" />
          ) : (
            <ChevronDown className="w-4 h-4 ml-1" />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-4 animate-fade-in">
          {/* Strategy Selector */}
          <StrategySelector
            strategy={strategy}
            onStrategyChange={handleStrategyChange}
            disabled={disabled || loadingStrategy}
          />

          {/* Loading indicator for strategy selection */}
          {loadingStrategy && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-sanctuary-50 dark:bg-sanctuary-800/50 text-sanctuary-600 dark:text-sanctuary-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Selecting optimal UTXOs...</span>
            </div>
          )}

          {/* Strategy error */}
          {strategyError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">{strategyError}</span>
            </div>
          )}

          {/* Spend Privacy Card (when UTXOs selected) */}
          {spendAnalysis && selectedUtxos.size > 0 && (
            <SpendPrivacyCard analysis={spendAnalysis} />
          )}

          {/* UTXO List */}
          <div className={`surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden ${disabled ? 'opacity-60' : ''}`}>
            <div className="p-4 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-center">
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {disabled ? 'Selected Inputs (locked)' : strategy === 'manual' ? 'Select Inputs' : 'Inputs (auto-selected)'}
              </span>
              <span className="text-xs text-sanctuary-500">
                {selectedUtxos.size} selected
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {utxos.map(utxo => {
                const id = `${utxo.txid}:${utxo.vout}`;
                const isSelected = selectedUtxos.has(id);
                const isLocked = !!utxo.lockedByDraftId;
                // Disable selection when not in manual mode (strategy controls selection)
                const isDisabled = utxo.frozen || isLocked || disabled || strategy !== 'manual';
                const privacyInfo = privacyMap.get(id);

                return (
                  <UtxoRow
                    key={id}
                    utxo={utxo}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    feeRate={feeRate}
                    strategy={strategy}
                    privacyInfo={privacyInfo}
                    onToggle={handleManualToggle}
                  />
                );
              })}
            </div>
          </div>

          {/* Selection Summary Footer */}
          {selectedUtxos.size > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl surface-muted border border-sanctuary-200 dark:border-sanctuary-700">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  Selected Total:
                </span>
                <span className="text-sm font-bold text-sanctuary-900 dark:text-sanctuary-100">
                  {format(selectedTotal)}
                </span>
              </div>
              <div className="text-xs text-sanctuary-500">
                {selectedUtxos.size} UTXO{selectedUtxos.size !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {/* Warning if insufficient funds */}
          {selectedUtxos.size > 0 && selectedTotal === 0 && (
            <div className="flex items-center p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
              <span className="text-sm">
                Selected inputs have zero balance or are unspendable.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
