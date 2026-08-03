import { Tag } from 'lucide-react';
import type { Label, Transaction } from '../../../types';

export function ReadOnlyLabelsPanel({ selectedTx }: { selectedTx: Transaction }) {
  if (selectedTx.labels && selectedTx.labels.length > 0) {
    return (
      <div className="flex flex-wrap gap-2">
        <LabelBadgeList labels={selectedTx.labels} />
      </div>
    );
  }

  if (selectedTx.label) {
    return (
      <div className="flex flex-wrap gap-2">
        <LegacyLabelBadge label={selectedTx.label} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <span className="text-sm text-sanctuary-400">No labels</span>
    </div>
  );
}

function LabelBadgeList({ labels }: { labels: Label[] }) {
  return (
    <>
      {labels.map(label => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
          style={{ backgroundColor: label.color }}
        >
          <Tag className="w-3.5 h-3.5" />
          {label.name}
        </span>
      ))}
    </>
  );
}

function LegacyLabelBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
      <Tag className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}
