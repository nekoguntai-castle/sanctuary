import type { ComponentType } from 'react';
import { FileText, Lock } from 'lucide-react';
import type { UTXO } from '../../../../../types';
import type { UtxoPrivacyInfo } from '../../../../../src/api/transactions';
import { UtxoRow } from '../UtxoRow';
import { getUtxoId } from './coinControlModel';

type LockedUtxoKind = 'manuallyFrozen' | 'draftLocked';

const SECTION_CONFIG = {
  manuallyFrozen: {
    Icon: Lock,
    title: 'Frozen',
    titleClassName: 'text-rose-500',
  },
  draftLocked: {
    Icon: FileText,
    title: 'Locked by Drafts',
    titleClassName: 'text-blue-500',
  },
} satisfies Record<LockedUtxoKind, {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  titleClassName: string;
}>;

interface LockedUtxoSectionProps {
  kind: LockedUtxoKind;
  utxos: UTXO[];
  utxoPrivacyMap: Map<string, UtxoPrivacyInfo>;
  onToggleUtxo: (utxoId: string) => void;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export function LockedUtxoSection({
  kind,
  utxos,
  utxoPrivacyMap,
  onToggleUtxo,
  format,
  formatFiat,
}: LockedUtxoSectionProps) {
  if (utxos.length === 0) return null;

  const { Icon, title, titleClassName } = SECTION_CONFIG[kind];
  const hiddenCount = utxos.length - 2;

  return (
    <div className="pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
      <h4 className={`text-xs font-medium ${titleClassName} flex items-center gap-1 mb-2`}>
        <Icon className="w-3 h-3" />
        {title} ({utxos.length})
      </h4>
      <div className="space-y-2 opacity-60">
        {utxos.slice(0, 2).map((utxo) => {
          const utxoId = getUtxoId(utxo);

          return (
            <UtxoRow
              key={utxoId}
              utxo={utxo}
              selectable={false}
              selected={false}
              privacyInfo={utxoPrivacyMap.get(utxoId)}
              onToggle={onToggleUtxo}
              format={format}
              formatFiat={formatFiat}
            />
          );
        })}
        {hiddenCount > 0 && (
          <div className="text-xs text-sanctuary-500 text-center">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </div>
  );
}
