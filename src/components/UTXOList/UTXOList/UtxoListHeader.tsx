import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../ui/Button';

interface UtxoListHeaderProps {
  visibleCount: number;
  totalCount?: number;
  selectable: boolean;
  selectedCount: number;
  selectedAmount: number;
  onSendSelected?: () => void;
  format: (sats: number) => string;
}

function getCountLabel(visibleCount: number, totalCount?: number): string {
  return totalCount !== undefined ? `${visibleCount} of ${totalCount}` : String(visibleCount);
}

export function UtxoListHeader({
  visibleCount,
  totalCount,
  selectable,
  selectedCount,
  selectedAmount,
  onSendSelected,
  format,
}: UtxoListHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-4 sticky top-0 surface-muted z-10 py-2">
      <div className="flex items-center space-x-4">
        <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">
          Available Outputs
        </h4>
        <span className="text-xs text-sanctuary-400 surface-secondary px-2 py-1 rounded-full">
          {getCountLabel(visibleCount, totalCount)} UTXOs
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
  );
}
