import { Shield } from 'lucide-react';
import type { CSSProperties } from 'react';

const LEGEND_DUST_STYLE: CSSProperties = {
  background: 'radial-gradient(circle at 25% 25%, #f59e0b 1px, transparent 1px), radial-gradient(circle at 75% 75%, #f59e0b 1px, transparent 1px), #d97706',
};

const LEGEND_LOCKED_STYLE: CSSProperties = {
  background: 'repeating-linear-gradient(45deg, #06b6d4, #06b6d4 2px, #0891b2 2px, #0891b2 4px)',
};

const LEGEND_FROZEN_STYLE: CSSProperties = {
  background: 'repeating-linear-gradient(45deg, #e05a47, #e05a47 2px, #c44a3a 2px, #c44a3a 4px)',
};

interface UtxoGardenLegendProps {
  showPrivacy: boolean;
}

export function UtxoGardenLegend({ showPrivacy }: UtxoGardenLegendProps) {
  return (
    <div className="mt-3 pt-2 border-t border-sanctuary-100 dark:border-sanctuary-800 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-sanctuary-500">
      <LegendDot className="bg-zen-matcha" label="Fresh" />
      <LegendDot className="bg-zen-indigo" label="<1mo" />
      <LegendDot className="bg-zen-gold" label="<1yr" />
      <LegendDot className="bg-sanctuary-700" label="Ancient" />
      <LegendDot style={LEGEND_DUST_STYLE} label="Dust" />
      <LegendDot style={LEGEND_LOCKED_STYLE} label="Locked" />
      <LegendDot style={LEGEND_FROZEN_STYLE} label="Frozen" />
      {showPrivacy && (
        <div className="flex items-center">
          <Shield className="w-2 h-2 mr-1 text-zen-indigo" />
          Privacy
        </div>
      )}
    </div>
  );
}

interface LegendDotProps {
  label: string;
  className?: string;
  style?: CSSProperties;
}

function LegendDot({ label, className = '', style }: LegendDotProps) {
  return (
    <div className="flex items-center">
      <span className={`w-2 h-2 rounded-full mr-1 ${className}`} style={style} />
      {label}
    </div>
  );
}
