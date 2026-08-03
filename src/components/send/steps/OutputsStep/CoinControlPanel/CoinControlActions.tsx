import { Button } from '../../../../ui/Button';

interface CoinControlActionsProps {
  showCoinControl: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleCoinControl: () => void;
}

export function CoinControlActions({
  showCoinControl,
  onSelectAll,
  onClearSelection,
  onToggleCoinControl,
}: CoinControlActionsProps) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" onClick={onSelectAll}>
        Select All
      </Button>
      <Button variant="secondary" size="sm" onClick={onClearSelection}>
        Clear
      </Button>
      {!showCoinControl && (
        <Button variant="primary" size="sm" onClick={onToggleCoinControl}>
          Enable
        </Button>
      )}
    </div>
  );
}
