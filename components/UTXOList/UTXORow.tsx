import React from 'react';
import { createUtxoRowModel } from './UTXORow/utxoRowModel';
import { UtxoAddressLink } from './UTXORow/UtxoAddressLink';
import { UtxoAgeTransactionDetails } from './UTXORow/UtxoAgeTransactionDetails';
import { UtxoAmountSummary } from './UTXORow/UtxoAmountSummary';
import { UtxoBadges } from './UTXORow/UtxoBadges';
import { UtxoFreezeButton } from './UTXORow/UtxoFreezeButton';
import { UtxoSelectionControl } from './UTXORow/UtxoSelectionControl';
import type { UTXORowProps } from './UTXORow/types';

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
  const model = createUtxoRowModel({ utxo, isSelected, currentFeeRate });

  return (
    <div className={model.rowClassName}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4">
          <UtxoSelectionControl
            model={model}
            selectable={selectable}
            onToggleSelect={onToggleSelect}
          />
          <div className="space-y-1">
            <UtxoAmountSummary
              model={model}
              privacyInfo={privacyInfo}
              showPrivacy={showPrivacy}
              onShowPrivacyDetail={onShowPrivacyDetail}
              format={format}
            />
            <UtxoAddressLink
              address={utxo.address}
              network={network}
              explorerUrl={explorerUrl}
            />
            <UtxoBadges model={model} />
          </div>
        </div>

        <div className="flex flex-col items-end space-y-2">
          <UtxoFreezeButton model={model} onToggleFreeze={onToggleFreeze} />
          <UtxoAgeTransactionDetails
            utxo={utxo}
            network={network}
            explorerUrl={explorerUrl}
          />
        </div>
      </div>
    </div>
  );
};
