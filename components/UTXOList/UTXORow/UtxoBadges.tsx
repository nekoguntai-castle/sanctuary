import { FileText } from 'lucide-react';
import type { UtxoRowModel } from './types';

interface UtxoBadgesProps {
  model: UtxoRowModel;
}

export function UtxoBadges({ model }: UtxoBadgesProps) {
  return (
    <div className="flex flex-wrap gap-1">
      <UtxoLabelBadge label={model.utxo.label} />
      <LockedDraftBadge model={model} />
    </div>
  );
}

interface UtxoLabelBadgeProps {
  label?: string;
}

function UtxoLabelBadge({ label }: UtxoLabelBadgeProps) {
  if (!label) {
    return null;
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
      {label}
    </span>
  );
}

interface LockedDraftBadgeProps {
  model: UtxoRowModel;
}

function LockedDraftBadge({ model }: LockedDraftBadgeProps) {
  if (!model.isLocked) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"
      title={`Reserved for draft: ${model.utxo.lockedByDraftLabel || 'Unnamed draft'}`}
    >
      <FileText className="w-3 h-3 mr-1" />
      {model.lockedDraftLabel}
    </span>
  );
}
