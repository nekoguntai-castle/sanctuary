import type { UTXO } from '../../../../../types';
import type { SpendPrivacyAnalysis, UtxoPrivacyInfo } from '../../../../../src/api/transactions';
import { AvailableUtxoList } from './AvailableUtxoList';
import { CoinControlActions } from './CoinControlActions';
import { LockedUtxoSection } from './LockedUtxoSection';
import { RemainingNeededNotice } from './RemainingNeededNotice';
import { SpendPrivacySection } from './SpendPrivacySection';

interface CoinControlBodyProps {
  showCoinControl: boolean;
  selectedUTXOs: Set<string>;
  available: UTXO[];
  manuallyFrozen: UTXO[];
  draftLocked: UTXO[];
  remainingNeeded: number;
  privacyAnalysis: SpendPrivacyAnalysis | null;
  utxoPrivacyMap: Map<string, UtxoPrivacyInfo>;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleCoinControl: () => void;
  onToggleUtxo: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export function CoinControlBody({
  showCoinControl,
  selectedUTXOs,
  available,
  manuallyFrozen,
  draftLocked,
  remainingNeeded,
  privacyAnalysis,
  utxoPrivacyMap,
  onSelectAll,
  onClearSelection,
  onToggleCoinControl,
  onToggleUtxo,
  format,
  formatFiat,
}: CoinControlBodyProps) {
  return (
    <div className="px-4 pb-4 space-y-3 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
      <CoinControlActions
        showCoinControl={showCoinControl}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onToggleCoinControl={onToggleCoinControl}
      />

      <RemainingNeededNotice
        showCoinControl={showCoinControl}
        remainingNeeded={remainingNeeded}
        format={format}
      />

      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        <AvailableUtxoList
          available={available}
          selectedUTXOs={selectedUTXOs}
          utxoPrivacyMap={utxoPrivacyMap}
          onToggleUtxo={onToggleUtxo}
          format={format}
          formatFiat={formatFiat}
        />
      </div>

      <SpendPrivacySection privacyAnalysis={privacyAnalysis} selectedCount={selectedUTXOs.size} />

      <LockedUtxoSection
        kind="manuallyFrozen"
        utxos={manuallyFrozen}
        utxoPrivacyMap={utxoPrivacyMap}
        onToggleUtxo={onToggleUtxo}
        format={format}
        formatFiat={formatFiat}
      />

      <LockedUtxoSection
        kind="draftLocked"
        utxos={draftLocked}
        utxoPrivacyMap={utxoPrivacyMap}
        onToggleUtxo={onToggleUtxo}
        format={format}
        formatFiat={formatFiat}
      />
    </div>
  );
}
