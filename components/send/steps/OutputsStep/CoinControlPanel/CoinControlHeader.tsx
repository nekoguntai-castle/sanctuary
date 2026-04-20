import { ChevronDown, ChevronUp, Coins } from 'lucide-react';

interface CoinControlHeaderProps {
  expanded: boolean;
  showCoinControl: boolean;
  selectedCount: number;
  onTogglePanel: () => void;
}

export function CoinControlHeader({
  expanded,
  showCoinControl,
  selectedCount,
  onTogglePanel,
}: CoinControlHeaderProps) {
  return (
    <button
      onClick={onTogglePanel}
      className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-sanctuary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Coin Control
        </span>
        {showCoinControl && selectedCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
            {selectedCount} UTXOs
          </span>
        )}
      </div>
      {expanded ? (
        <ChevronUp className="w-4 h-4 text-sanctuary-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-sanctuary-400" />
      )}
    </button>
  );
}
