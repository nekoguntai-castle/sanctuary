import React, { useState, useEffect, useMemo } from 'react';
import { UTXO } from '../../types';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { useCurrency } from '../../contexts/CurrencyContext';
import * as bitcoinApi from '../../src/api/bitcoin';
import { useFeeEstimates } from '../../hooks/queries/useBitcoin';
import { PrivacyDetailPanel } from '../PrivacyDetailPanel';
import type { UtxoPrivacyInfo, WalletPrivacySummary } from '../../src/api/transactions';
import { createLogger } from '../../utils/logger';
import { isDustUtxo } from './dustUtils';
import { UTXOSummaryBanners } from './UTXOSummaryBanners';
import { UTXOGarden } from './UTXOGarden';
import { UTXORow } from './UTXORow';

const log = createLogger('UTXOList');

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
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');
  const { data: feeEstimates } = useFeeEstimates();

  // State for privacy detail panel
  const [selectedUtxoForPrivacy, setSelectedUtxoForPrivacy] = useState<string | null>(null);

  // Create a map of privacy scores by UTXO ID for quick lookup
  const privacyMap = useMemo(() => {
    if (!privacyData) return new Map<string, UtxoPrivacyInfo>();
    return new Map(privacyData.map(p => [`${p.txid}:${p.vout}`, p]));
  }, [privacyData]);

  // Use the hour fee rate for dust calculation (reasonable baseline)
  const currentFeeRate = feeEstimates?.hour || 1;

  // Calculate dust statistics
  const dustStats = useMemo(() => {
    const dustUtxos = utxos.filter(u => !u.frozen && !u.lockedByDraftId && isDustUtxo(u, currentFeeRate));
    const dustTotal = dustUtxos.reduce((sum, u) => sum + u.amount, 0);
    return {
      count: dustUtxos.length,
      total: dustTotal,
    };
  }, [utxos, currentFeeRate]);

  // Load explorer URL from server config
  useEffect(() => {
    const fetchExplorerUrl = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (status.explorerUrl) setExplorerUrl(status.explorerUrl);
      } catch (err) {
        log.error('Failed to fetch explorer URL', { error: err });
      }
    };
    fetchExplorerUrl();
  }, []);

  const selectedCount = selectedUtxos.size;
  const selectedAmount = utxos
    .filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
    .reduce((acc, u) => acc + u.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4 sticky top-0 surface-muted z-10 py-2">
         <div className="flex items-center space-x-4">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">Available Outputs</h4>
            <span className="text-xs text-sanctuary-400 surface-secondary px-2 py-1 rounded-full">
              {totalCount !== undefined ? `${utxos.length} of ${totalCount}` : utxos.length} UTXOs
            </span>
         </div>
         <div className="flex items-center space-x-2">
            {selectable && selectedCount > 0 && onSendSelected && (
                <Button size="sm" onClick={onSendSelected} className="animate-fade-in">
                <ArrowUpRight className="w-4 h-4 mr-2" />
                Send {format(selectedAmount)}
                </Button>
            )}
         </div>
      </div>

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

      <div className="grid gap-3">
        {utxos.map((utxo) => {
          const id = `${utxo.txid}:${utxo.vout}`;
          return (
            <UTXORow
              key={id}
              utxo={utxo}
              isSelected={selectedUtxos.has(id)}
              selectable={selectable}
              onToggleSelect={onToggleSelect}
              onToggleFreeze={onToggleFreeze}
              onShowPrivacyDetail={setSelectedUtxoForPrivacy}
              privacyInfo={privacyMap.get(id)}
              showPrivacy={showPrivacy}
              currentFeeRate={currentFeeRate}
              network={network}
              explorerUrl={explorerUrl}
              format={format}
            />
          );
        })}
      </div>

      {selectedUtxoForPrivacy && (() => {
        const privacyInfo = privacyMap.get(selectedUtxoForPrivacy);
        const utxo = utxos.find(u => `${u.txid}:${u.vout}` === selectedUtxoForPrivacy);

        if (!privacyInfo || !utxo) return null;

        return (
          <PrivacyDetailPanel
            utxo={{
              txid: utxo.txid,
              vout: utxo.vout,
              amount: utxo.amount,
              address: utxo.address,
            }}
            privacyInfo={privacyInfo}
            onClose={() => setSelectedUtxoForPrivacy(null)}
          />
        );
      })()}
    </div>
  );
};
