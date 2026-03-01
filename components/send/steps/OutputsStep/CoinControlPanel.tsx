import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Coins,
  Lock,
  FileText,
} from 'lucide-react';
import { Button } from '../../../ui/Button';
import SpendPrivacyCard from '../../../SpendPrivacyCard';
import { UtxoRow } from './UtxoRow';
import type { UTXO } from '../../../../types';
import type { SpendPrivacyAnalysis, UtxoPrivacyInfo } from '../../../../src/api/transactions';

interface CoinControlPanelProps {
  expanded: boolean;
  showCoinControl: boolean;
  selectedUTXOs: Set<string>;
  available: UTXO[];
  manuallyFrozen: UTXO[];
  draftLocked: UTXO[];
  remainingNeeded: number;
  privacyAnalysis: SpendPrivacyAnalysis | null;
  utxoPrivacyMap: Map<string, UtxoPrivacyInfo>;
  onTogglePanel: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleCoinControl: () => void;
  onToggleUtxo: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export const CoinControlPanel: React.FC<CoinControlPanelProps> = ({
  expanded,
  showCoinControl,
  selectedUTXOs,
  available,
  manuallyFrozen,
  draftLocked,
  remainingNeeded,
  privacyAnalysis,
  utxoPrivacyMap,
  onTogglePanel,
  onSelectAll,
  onClearSelection,
  onToggleCoinControl,
  onToggleUtxo,
  format,
  formatFiat,
}) => {
  const isSelected = (utxo: UTXO) => selectedUTXOs.has(`${utxo.txid}:${utxo.vout}`);

  return (
    <div className="surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
      <button
        onClick={onTogglePanel}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-sanctuary-500" />
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Coin Control
          </span>
          {showCoinControl && selectedUTXOs.size > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {selectedUTXOs.size} UTXOs
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-sanctuary-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-sanctuary-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onSelectAll}>
              Select All
            </Button>
            <Button variant="secondary" size="sm" onClick={onClearSelection}>
              Clear
            </Button>
            {!showCoinControl && (
              <Button variant="primary" size="sm" onClick={onToggleCoinControl}>
                Enable
              </Button>
            )}
          </div>

          {showCoinControl && remainingNeeded > 0 && (
            <div className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <AlertCircle className="w-3.5 h-3.5" />
              Need {format(remainingNeeded)} more to cover transaction
            </div>
          )}

          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {available.length === 0 ? (
              <div className="text-center py-4 text-sanctuary-500 text-sm">
                No spendable UTXOs
              </div>
            ) : (
              available.map(utxo => (
                <UtxoRow
                  key={`${utxo.txid}:${utxo.vout}`}
                  utxo={utxo}
                  selectable={true}
                  selected={isSelected(utxo)}
                  privacyInfo={utxoPrivacyMap.get(`${utxo.txid}:${utxo.vout}`)}
                  onToggle={onToggleUtxo}
                  format={format}
                  formatFiat={formatFiat}
                />
              ))
            )}
          </div>

          {/* Privacy Analysis Card */}
          {privacyAnalysis && selectedUTXOs.size >= 1 && (
            <SpendPrivacyCard analysis={privacyAnalysis} className="mt-3" />
          )}

          {/* Manually Frozen UTXOs (red) */}
          {manuallyFrozen.length > 0 && (
            <div className="pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
              <h4 className="text-xs font-medium text-rose-500 flex items-center gap-1 mb-2">
                <Lock className="w-3 h-3" />
                Frozen ({manuallyFrozen.length})
              </h4>
              <div className="space-y-2 opacity-60">
                {manuallyFrozen.slice(0, 2).map(utxo => (
                  <UtxoRow
                    key={`${utxo.txid}:${utxo.vout}`}
                    utxo={utxo}
                    selectable={false}
                    selected={false}
                    privacyInfo={utxoPrivacyMap.get(`${utxo.txid}:${utxo.vout}`)}
                    onToggle={onToggleUtxo}
                    format={format}
                    formatFiat={formatFiat}
                  />
                ))}
                {manuallyFrozen.length > 2 && (
                  <div className="text-xs text-sanctuary-500 text-center">
                    +{manuallyFrozen.length - 2} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Draft-Locked UTXOs (blue) */}
          {draftLocked.length > 0 && (
            <div className="pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
              <h4 className="text-xs font-medium text-blue-500 flex items-center gap-1 mb-2">
                <FileText className="w-3 h-3" />
                Locked by Drafts ({draftLocked.length})
              </h4>
              <div className="space-y-2 opacity-60">
                {draftLocked.slice(0, 2).map(utxo => (
                  <UtxoRow
                    key={`${utxo.txid}:${utxo.vout}`}
                    utxo={utxo}
                    selectable={false}
                    selected={false}
                    privacyInfo={utxoPrivacyMap.get(`${utxo.txid}:${utxo.vout}`)}
                    onToggle={onToggleUtxo}
                    format={format}
                    formatFiat={formatFiat}
                  />
                ))}
                {draftLocked.length > 2 && (
                  <div className="text-xs text-sanctuary-500 text-center">
                    +{draftLocked.length - 2} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
