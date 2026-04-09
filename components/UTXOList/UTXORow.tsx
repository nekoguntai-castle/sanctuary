import React from 'react';
import { Lock, Unlock, Check, ExternalLink, FileText, AlertTriangle } from 'lucide-react';
import type { UTXO } from '../../types';
import type { UtxoPrivacyInfo } from '../../src/api/transactions';
import { Amount } from '../Amount';
import { PrivacyBadge } from '../PrivacyBadge';
import { getAddressExplorerUrl, getTxExplorerUrl } from '../../utils/explorer';
import { calculateUTXOAge, getAgeCategoryColor } from '../../utils/utxoAge';
import { isDustUtxo, getSpendCost } from './dustUtils';

interface UTXORowProps {
  utxo: UTXO;
  isSelected: boolean;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleFreeze: (txid: string, vout: number) => void;
  onShowPrivacyDetail: (id: string) => void;
  privacyInfo?: UtxoPrivacyInfo;
  showPrivacy: boolean;
  currentFeeRate: number;
  network: string;
  explorerUrl: string;
  format: (sats: number) => string;
}

export const UTXORow: React.FC<UTXORowProps> = ({
  utxo,
  isSelected,
  selectable,
  onToggleSelect,
  onToggleFreeze,
  onShowPrivacyDetail,
  privacyInfo,
  showPrivacy,
  currentFeeRate,
  network,
  explorerUrl,
  format,
}) => {
  const id = `${utxo.txid}:${utxo.vout}`;
  const isFrozen = utxo.frozen;
  const isLocked = !!utxo.lockedByDraftId;
  const isDisabled = isFrozen || isLocked;
  const isDust = !isFrozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
  const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;

  return (
    <div
      className={`group relative p-4 rounded-lg border transition-all duration-200
        ${isFrozen
        ? 'bg-zen-vermilion/5 border-zen-vermilion/20 dark:bg-zen-vermilion/10'
        : isLocked
            ? 'bg-cyan-50 border-cyan-200 dark:bg-cyan-900/10 dark:border-cyan-800/50'
            : isDust
                ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/50'
                : isSelected
                    ? 'bg-zen-gold/10 border-zen-gold/50 shadow-sm'
                    : 'bg-white border-sanctuary-200 dark:bg-sanctuary-900 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-700 shadow-sm'
        }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4">
          {selectable && !isDisabled && (
            <div
              onClick={() => onToggleSelect && onToggleSelect(id)}
              className={`mt-1 flex-shrink-0 w-5 h-5 rounded border cursor-pointer flex items-center justify-center transition-colors ${isSelected ? 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900' : 'border-sanctuary-300 dark:border-sanctuary-600 hover:border-sanctuary-400'}`}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </div>
          )}

          <div className="space-y-1">
            <div className={`font-mono font-medium flex items-center gap-2 ${isFrozen ? 'text-zen-vermilion' : isLocked ? 'text-cyan-600 dark:text-cyan-400' : isDust ? 'text-amber-600 dark:text-amber-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
              <Amount sats={utxo.amount} size="lg" />
              {isDust && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title={`Costs ${format(spendCost)} to spend at current fees`}>
                  <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                  DUST
                </span>
              )}
              {showPrivacy && privacyInfo && (
                <span onClick={(e) => e.stopPropagation()}>
                  <PrivacyBadge
                    score={privacyInfo.score.score}
                    grade={privacyInfo.score.grade}
                    size="sm"
                    onClick={() => onShowPrivacyDetail(id)}
                  />
                </span>
              )}
            </div>
            <a
              href={getAddressExplorerUrl(utxo.address, network, explorerUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-sanctuary-500 font-mono break-all max-w-md hover:text-primary-500 dark:hover:text-primary-400 hover:underline inline-flex items-center"
              title={`View address ${utxo.address} on block explorer`}
            >
              {utxo.address}
              <ExternalLink className="w-2.5 h-2.5 ml-1 flex-shrink-0" />
            </a>
            <div className="flex flex-wrap gap-1">
              {utxo.label && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
                  {utxo.label}
                </span>
              )}
              {isLocked && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" title={`Reserved for draft: ${utxo.lockedByDraftLabel || 'Unnamed draft'}`}>
                  <FileText className="w-3 h-3 mr-1" />
                  {utxo.lockedByDraftLabel || 'Pending Draft'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end space-y-2">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFreeze(utxo.txid, utxo.vout); }}
            title={isFrozen ? "Unfreeze coin for spending" : "Freeze coin to prevent spending"}
            className={`p-2 rounded-lg transition-colors ${
              isFrozen
              ? "bg-zen-vermilion/10 text-zen-vermilion hover:bg-zen-vermilion/20"
              : "text-sanctuary-300 hover:text-zen-matcha hover:bg-zen-matcha/10"
            }`}
          >
            {isFrozen ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
          {(() => {
            const age = calculateUTXOAge(utxo);
            return (
              <div className="text-xs text-sanctuary-400 text-right">
                <span className={`font-medium ${getAgeCategoryColor(age.category)}`} title={`${utxo.confirmations.toLocaleString()} confirmations`}>
                  {age.displayText}
                </span>
                <span className="text-[10px] opacity-70"> old</span>
                <br/>
                <span className="text-[10px] opacity-70">
                  {utxo.confirmations.toLocaleString()} confs
                </span>
                <br/>
                <a
                  href={`${getTxExplorerUrl(utxo.txid, network, explorerUrl)}#vout=${utxo.vout}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center font-mono text-[10px] text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 hover:underline"
                  title={`View transaction ${utxo.txid} output #${utxo.vout} on block explorer`}
                >
                  txid:{utxo.txid.substring(0,8)}...:{utxo.vout}
                  <ExternalLink className="w-2.5 h-2.5 ml-1" />
                </a>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
