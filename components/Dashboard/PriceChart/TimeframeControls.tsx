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
  return (
    <div className="flex justify-end mb-2">
      <div className="flex space-x-1 surface-secondary p-1 rounded-lg">
        {TIMEFRAMES.map((timeframeOption) => (
          <button
            key={timeframeOption}
            onClick={() => setTimeframe(timeframeOption)}
            className={getTimeframeButtonClass(timeframe === timeframeOption)}
          >
            {timeframeOption}
          </button>
        ))}
      </div>
    </div>
  );
}
