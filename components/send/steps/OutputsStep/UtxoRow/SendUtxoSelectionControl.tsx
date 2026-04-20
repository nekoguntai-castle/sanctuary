import { Check, Lock } from 'lucide-react';

interface SendUtxoSelectionControlProps {
  selectable: boolean;
  selected: boolean;
  frozen?: boolean;
  selectionClassName: string;
}

export function SendUtxoSelectionControl({
  selectable,
  selected,
  frozen,
  selectionClassName,
}: SendUtxoSelectionControlProps) {
  if (!selectable && frozen) {
    return <Lock className="w-3.5 h-3.5 text-sanctuary-400" />;
  }

  if (!selectable) return null;

  return (
    <div
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${selectionClassName}`}
    >
      {selected && <Check className="w-2.5 h-2.5 text-white" />}
    </div>
  );
}
