/**
 * UTXO Row Component
 *
 * Renders a single UTXO row in the coin control panel with selection checkbox,
 * amount, dust warning, privacy badge, status indicators, and age display.
 */

import React from 'react';
import { Check, Lock, FileText } from 'lucide-react';
import type { UTXO } from '../../types';
import { DustWarningBadge } from '../DustWarningBadge';
import { PrivacyBadge } from '../PrivacyBadge';
import { useCurrency } from '../../contexts/CurrencyContext';
import { calculateUTXOAge, getAgeCategoryColor } from '../../utils/utxoAge';
import { isDustUtxo, getSpendCost } from './utils';

type PrivacyGrade = 'excellent' | 'good' | 'fair' | 'poor';

interface UtxoPrivacyInfo {
  score: {
    score: number;
    grade: PrivacyGrade;
  };
}

interface UtxoRowProps {
  utxo: UTXO;
  isSelected: boolean;
  isDisabled: boolean;
  feeRate: number;
  strategy: string;
  privacyInfo?: UtxoPrivacyInfo;
  onToggle: (utxoId: string) => void;
}

export const UtxoRow: React.FC<UtxoRowProps> = ({
  utxo,
  isSelected,
  isDisabled,
  feeRate,
  strategy,
  privacyInfo,
  onToggle,
}) => {
  const { format } = useCurrency();
  const id = `${utxo.txid}:${utxo.vout}`;
  const isLocked = !!utxo.lockedByDraftId;
  const isDust = !utxo.frozen && !isLocked && isDustUtxo(utxo, feeRate);
  const spendCost = isDust ? getSpendCost(utxo, feeRate) : 0;

  // Striped pattern for frozen UTXOs
  const frozenStyle = utxo.frozen ? {
    backgroundImage: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      rgba(190,18,60,0.08) 4px,
      rgba(190,18,60,0.08) 8px
    )`
  } : {};

  // Striped pattern for locked UTXOs
  const lockedStyle = isLocked && !utxo.frozen ? {
    backgroundImage: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      rgba(6,182,212,0.08) 4px,
      rgba(6,182,212,0.08) 8px
    )`
  } : {};

  return (
    <div
      onClick={() => !isDisabled && onToggle(id)}
      style={{...frozenStyle, ...lockedStyle}}
      className={`p-4 flex items-center justify-between border-b border-sanctuary-50 dark:border-sanctuary-800 last:border-0 transition-colors ${
        isSelected
          ? 'bg-amber-50 dark:bg-amber-900/10'
          : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
      } ${
        utxo.frozen
          ? 'opacity-70 bg-rose-50 dark:bg-rose-900/10'
          : ''
      } ${
        isLocked
          ? 'opacity-70 bg-cyan-50 dark:bg-cyan-900/10'
          : ''
      } ${
        isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <div className="flex items-center space-x-3 flex-1 min-w-0">
        {/* Checkbox */}
        <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
          isSelected
            ? 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
            : 'border-sanctuary-300 dark:border-sanctuary-600'
        }`}>
          {isSelected && <Check className="w-3 h-3" />}
        </div>

        {/* UTXO Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {format(utxo.amount)}
            </span>

            {/* Dust Warning */}
            {isDust && (
              <DustWarningBadge
                spendCost={spendCost}
                utxoAmount={utxo.amount}
                feeRate={feeRate}
                size="sm"
              />
            )}

            {/* Privacy Badge */}
            {privacyInfo && (
              <PrivacyBadge
                score={privacyInfo.score.score}
                grade={privacyInfo.score.grade}
                size="sm"
              />
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-sanctuary-500 font-mono truncate">
              {utxo.address.substring(0, 16)}...
            </span>
            {utxo.label && (
              <span className="text-xs text-sanctuary-400">
                {utxo.label}
              </span>
            )}
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {utxo.frozen && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              <Lock className="w-3 h-3 mr-1" />
              Frozen
            </span>
          )}
          {isLocked && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
              <FileText className="w-3 h-3 mr-1" />
              {utxo.lockedByDraftLabel || 'Draft'}
            </span>
          )}
          {(() => {
            const age = calculateUTXOAge(utxo);
            return (
              <span className={`text-xs ${getAgeCategoryColor(age.category)}`} title={`${utxo.confirmations.toLocaleString()} confirmations`}>
                {age.shortText}
              </span>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
