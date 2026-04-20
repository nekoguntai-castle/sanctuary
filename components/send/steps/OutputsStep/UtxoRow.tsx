import React from 'react';
import type { UTXO } from '../../../../types';
import type { UtxoPrivacyInfo } from '../../../../src/api/transactions';
import { SendUtxoAddressSummary } from './UtxoRow/SendUtxoAddressSummary';
import { SendUtxoAmount } from './UtxoRow/SendUtxoAmount';
import { SendUtxoPrivacyBadge } from './UtxoRow/SendUtxoPrivacyBadge';
import { SendUtxoSelectionControl } from './UtxoRow/SendUtxoSelectionControl';
import { createSendUtxoRowModel } from './UtxoRow/sendUtxoRowModel';

interface UtxoRowProps {
  utxo: UTXO;
  selectable?: boolean;
  selected: boolean;
  privacyInfo?: UtxoPrivacyInfo;
  onToggle: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export const UtxoRow: React.FC<UtxoRowProps> = ({
  utxo,
  selectable = true,
  selected,
  privacyInfo,
  onToggle,
  format,
  formatFiat,
}) => {
  const model = createSendUtxoRowModel({ utxo, selectable, selected });

  return (
    <div
      onClick={() => selectable && onToggle(model.utxoId)}
      className={model.rowClassName}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SendUtxoSelectionControl
            selectable={selectable}
            selected={selected}
            frozen={utxo.frozen}
            selectionClassName={model.selectionClassName}
          />

          <SendUtxoAddressSummary utxo={utxo} shortAddress={model.shortAddress} />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <SendUtxoPrivacyBadge privacyInfo={privacyInfo} />
          <SendUtxoAmount amount={utxo.amount} format={format} formatFiat={formatFiat} />
        </div>
      </div>
    </div>
  );
};
