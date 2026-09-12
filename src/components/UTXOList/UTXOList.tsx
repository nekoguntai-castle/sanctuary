import React, { useMemo, useState } from 'react';
import { UTXO } from '../../types';
import { usePriceFreeFormatter } from '../../contexts/CurrencyContext';
import { useFeeEstimates } from '../../hooks/queries/useBitcoin';
import type { BitcoinFeeNetwork } from '../../api/bitcoin';
import type { UtxoPrivacyInfo, WalletPrivacySummary } from '../../api/transactions';
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

const FEE_NETWORKS = new Set<string>(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest']);
const EMPTY_UTXO_IDS = new Set<string>();

function toFeeNetwork(network: string): BitcoinFeeNetwork {
  if (network === 'testnet') return 'testnet3';
  return FEE_NETWORKS.has(network) ? network as BitcoinFeeNetwork : 'mainnet';
}

interface UTXOListProps {
  utxos: UTXO[];
  totalCount?: number;
  onToggleFreeze: (txid: string, vout: number) => void;
  selectable?: boolean;
  selectedUtxos?: Set<string>;
  pendingFreezeIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSendSelected?: () => void;
  privacyData?: UtxoPrivacyInfo[];
  privacySummary?: WalletPrivacySummary;
  showPrivacy?: boolean;
  network?: string;
}


/**
 * Fee rates only if they belong to the active network.
 *
 * `placeholderData: keepPreviousData` serves the previous network's rates while
 * the new query is in flight, and dust economics are a function of the fee
 * rate — so stale rates silently misclassify UTXOs as dust, or fail to.
 */
function feesForNetwork<T extends { network?: string }>(
  fees: T | undefined,
  network: string,
  isPlaceholder: boolean,
): T | undefined {
  if (isPlaceholder) return undefined;
  if (fees && fees.network !== network) return undefined;
  return fees;
}

export const UTXOList: React.FC<UTXOListProps> = ({
  utxos,
  totalCount,
  onToggleFreeze,
  selectable = false,
  selectedUtxos = EMPTY_UTXO_IDS,
  pendingFreezeIds = EMPTY_UTXO_IDS,
  onToggleSelect,
  onSendSelected,
  privacyData,
  privacySummary,
  showPrivacy = false,
  network = 'mainnet',
}) => {
  const { format } = usePriceFreeFormatter();
  const explorerUrl = useExplorerUrl(network);
  const feeNetwork = toFeeNetwork(network);
  const { data: feeEstimatesRaw, isPlaceholderData: feesArePlaceholder } =
    useFeeEstimates(feeNetwork);
  const feeEstimates = feesForNetwork(feeEstimatesRaw, feeNetwork, feesArePlaceholder);

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
        pendingFreezeIds={pendingFreezeIds}
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
