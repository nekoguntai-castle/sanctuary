import { AlertCircle } from 'lucide-react';

interface RemainingNeededNoticeProps {
  showCoinControl: boolean;
  remainingNeeded: number;
  format: (amount: number) => string;
}

export function RemainingNeededNotice({
  showCoinControl,
  remainingNeeded,
  format,
}: RemainingNeededNoticeProps) {
  if (!showCoinControl || remainingNeeded <= 0) return null;

  return (
    <div className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
      <AlertCircle className="w-3.5 h-3.5" />
      Need {format(remainingNeeded)} more to cover transaction
    </div>
  );
}
