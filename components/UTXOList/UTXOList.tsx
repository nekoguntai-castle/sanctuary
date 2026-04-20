import React, { useMemo, useState } from 'react';
import { UTXO } from '../../types';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useFeeEstimates } from '../../hooks/queries/useBitcoin';
import type { UtxoPrivacyInfo, WalletPrivacySummary } from '../../src/api/transactions';
import { UTXOSummaryBanners } from './UTXOSummaryBanners';
import { UTXOGarden } from './UTXOGarden';
import { UtxoListHeader } from './UTXOList/UtxoListHeader';
import { UtxoListRows } from './UTXOList/UtxoListRows';
import { UtxoPrivacyDetail } from './UTXOList/UtxoPrivacyDetail';
import { useExplorerUrl } from './UTXOList/useExplorerUrl';
import {
  createPrivacyMap,
  getDustStats,
  getSelectedAmount,
} from './UTXOList/utxoListModel';

interface UTXOListProps {
  utxos: UTXO[];
  totalCount?: number;
  onToggleFreeze: (txid: string, vout: number) => void;
  selectable?: boolean;
  selectedUtxos?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSendSelected?: () => void;
  privacyData?: UtxoPrivacyInfo[];
  privacySummary?: WalletPrivacySummary;
  showPrivacy?: boolean;
  network?: string;
}

export const UTXOList: React.FC<UTXOListProps> = ({
  utxos,
  totalCount,
  onToggleFreeze,
  selectable = false,
  selectedUtxos = new Set(),
  onToggleSelect,
  onSendSelected,
  privacyData,
  privacySummary,
  showPrivacy = false,
  network = 'mainnet',
}) => {
  const { format } = useCurrency();
  const explorerUrl = useExplorerUrl();
  const { data: feeEstimates } = useFeeEstimates();

  const [selectedUtxoForPrivacy, setSelectedUtxoForPrivacy] = useState<string | null>(null);

  const privacyMap = useMemo(() => {
    return createPrivacyMap(privacyData);
  }, [privacyData]);

  const currentFeeRate = feeEstimates?.hour || 1;

  const dustStats = useMemo(() => {
    return getDustStats(utxos, currentFeeRate);
  }, [utxos, currentFeeRate]);

  const selectedCount = selectedUtxos.size;
  const selectedAmount = useMemo(() => {
    return getSelectedAmount(utxos, selectedUtxos);
  }, [utxos, selectedUtxos]);

  return (
    <div className="space-y-6">
      <UtxoListHeader
        visibleCount={utxos.length}
        totalCount={totalCount}
        selectable={selectable}
        selectedCount={selectedCount}
        selectedAmount={selectedAmount}
        onSendSelected={onSendSelected}
        format={format}
      />

      <UTXOGarden
        utxos={utxos}
        selectedUtxos={selectedUtxos}
        onToggleSelect={onToggleSelect}
        currentFeeRate={currentFeeRate}
        showPrivacy={showPrivacy}
        format={format}
      />

      <UTXOSummaryBanners
        showPrivacy={showPrivacy}
        privacySummary={privacySummary}
        dustCount={dustStats.count}
        dustTotal={dustStats.total}
        currentFeeRate={currentFeeRate}
        format={format}
      />

      <UtxoListRows
        utxos={utxos}
        selectedUtxos={selectedUtxos}
        selectable={selectable}
        onToggleSelect={onToggleSelect}
        onToggleFreeze={onToggleFreeze}
        onShowPrivacyDetail={setSelectedUtxoForPrivacy}
        privacyMap={privacyMap}
        showPrivacy={showPrivacy}
        currentFeeRate={currentFeeRate}
        network={network}
        explorerUrl={explorerUrl}
        format={format}
      />

      <UtxoPrivacyDetail
        selectedUtxoId={selectedUtxoForPrivacy}
        utxos={utxos}
        privacyMap={privacyMap}
        onClose={() => setSelectedUtxoForPrivacy(null)}
      />
    </div>
  );
};
