/**
 * UTXOTab - UTXO list with freeze/select and privacy analysis
 *
 * Displays UTXOs with controls for freezing, coin selection for sending,
 * and optional privacy scoring data.
 */

import React from 'react';
import { UTXOList } from '../../UTXOList';
import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo, WalletPrivacySummary } from '../../../src/api/transactions';
import { canEditWalletRole } from '../../../utils/walletCapabilities';

interface UTXOTabProps {
  utxos: UTXO[];
  utxoTotalCount?: number;
  onToggleFreeze: (txid: string, vout: number) => void;
  userRole: string;
  selectedUtxos: Set<string>;
  onToggleSelect: (id: string) => void;
  onSendSelected: () => void;
  privacyData: UtxoPrivacyInfo[];
  privacySummary: WalletPrivacySummary | null | undefined;
  showPrivacy: boolean;
  network: string;
  hasMoreUtxos: boolean;
  onLoadMore: () => void;
  loadingMoreUtxos: boolean;
}

export const UTXOTab: React.FC<UTXOTabProps> = ({
  utxos,
  utxoTotalCount,
  onToggleFreeze,
  userRole,
  selectedUtxos,
  onToggleSelect,
  onSendSelected,
  privacyData,
  privacySummary,
  showPrivacy,
  network,
  hasMoreUtxos,
  onLoadMore,
  loadingMoreUtxos,
}) => {
  const canEdit = canEditWalletRole(userRole);

  return (
    <div>
      <UTXOList
        utxos={utxos}
        totalCount={utxoTotalCount}
        onToggleFreeze={onToggleFreeze}
        selectable={canEdit}
        selectedUtxos={selectedUtxos}
        onToggleSelect={onToggleSelect}
        onSendSelected={canEdit ? onSendSelected : undefined}
        privacyData={privacyData}
        privacySummary={privacySummary ?? undefined}
        showPrivacy={showPrivacy}
        network={network}
      />
      {hasMoreUtxos && utxos.length > 0 && (
        <div className="mt-4 text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMoreUtxos}
            className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingMoreUtxos ? (
              <span className="flex items-center justify-center">
                <span className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent mr-2" />
                Loading...
              </span>
            ) : (
              `Load More (${utxos.length} shown)`
            )}
          </button>
        </div>
      )}
    </div>
  );
};
