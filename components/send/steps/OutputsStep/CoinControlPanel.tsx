import React from 'react';
import type { UTXO } from '../../../../types';
import type { SpendPrivacyAnalysis, UtxoPrivacyInfo } from '../../../../src/api/transactions';
import { CoinControlBody } from './CoinControlPanel/CoinControlBody';
import { CoinControlHeader } from './CoinControlPanel/CoinControlHeader';

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
  return (
    <div className="surface-secondary rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
      <CoinControlHeader
        expanded={expanded}
        showCoinControl={showCoinControl}
        selectedCount={selectedUTXOs.size}
        onTogglePanel={onTogglePanel}
      />

      {expanded && (
        <CoinControlBody
          showCoinControl={showCoinControl}
          selectedUTXOs={selectedUTXOs}
          available={available}
          manuallyFrozen={manuallyFrozen}
          draftLocked={draftLocked}
          remainingNeeded={remainingNeeded}
          privacyAnalysis={privacyAnalysis}
          utxoPrivacyMap={utxoPrivacyMap}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onToggleCoinControl={onToggleCoinControl}
          onToggleUtxo={onToggleUtxo}
          format={format}
          formatFiat={formatFiat}
        />
      )}
    </div>
  );
};
