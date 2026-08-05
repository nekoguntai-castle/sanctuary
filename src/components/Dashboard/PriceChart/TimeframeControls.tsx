import type { Timeframe } from '../hooks/useDashboardData';

interface TimeframeControlsProps {
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
}

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '1Y', 'ALL'];

function getTimeframeButtonClass(isSelected: boolean) {
  return `px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
    isSelected
      ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm'
      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
  }`;
}

export function TimeframeControls({ timeframe, setTimeframe }: TimeframeControlsProps) {
  // No outer wrapper: this is a flex item of the card header now, so the old
  // `justify-end` had no free space to distribute and the `mb-2` inflated the
  // header's cross-size, pushing the pills ~4px above the eyebrow's baseline.
  return (
    <div className="flex space-x-1 surface-secondary p-1 rounded-lg">
      {TIMEFRAMES.map((timeframeOption) => (
        <button
          key={timeframeOption}
          type="button"
          // Selection was previously conveyed by background colour alone, which
          // no screen reader announces.
          aria-pressed={timeframe === timeframeOption}
          onClick={() => setTimeframe(timeframeOption)}
          className={getTimeframeButtonClass(timeframe === timeframeOption)}
        >
          {timeframeOption}
        </button>
      ))}
    </div>
  );
}
