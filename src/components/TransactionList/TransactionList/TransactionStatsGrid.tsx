import { useRef } from 'react';
import type React from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Amount } from '../../Amount';
import { useElementWidth } from '../../../hooks/useElementWidth';

export type TransactionListStats = {
  total: number;
  received: number;
  sent: number;
  consolidations: number;
  totalReceived: number;
  totalSent: number;
  totalFees: number;
};

type TileDensity = 'comfortable' | 'compact';

const TILE_COUNT = 7;
const GAP_PX = 12; // gap-3

/**
 * 9rem is the widest tile minimum — "Consolidations" at text-xs uppercase plus
 * its icon and px-3. The compact tile drops the label to text-[10px] and the
 * padding to px-2, which is what lets it hold its content 2.5rem narrower.
 */
const COMFORTABLE_MIN_PX = 144;
const COMPACT_MIN_PX = 104;

/**
 * Below the width that fits all seven comfortable tiles on one line the grid
 * wraps, and each extra row costs ~4rem of vertical space above the table —
 * on a laptop the first transaction row ended up below the fold. Compact tiles
 * fit seven across from ~800px and, where they still wrap, wrap into shorter
 * rows.
 */
const ONE_COMFORTABLE_ROW_PX = TILE_COUNT * COMFORTABLE_MIN_PX + (TILE_COUNT - 1) * GAP_PX;

/**
 * Pick the tile density for a measured grid width.
 *
 * Exported so the breakpoint can be asserted directly: the rendered component
 * only ever sees widths jsdom reports as zero, so a test that went through the
 * DOM could not tell the two sides of the threshold apart.
 *
 * @param width the grid's own width in CSS pixels, or `null` when it has not
 *   been measured yet.
 */
export function densityForWidth(width: number | null): TileDensity {
  // `null` is "not measured yet", which the layout effect resolves before
  // paint. Treating it as comfortable keeps the wider layout authoritative.
  if (width === null) return 'comfortable';
  return width < ONE_COMFORTABLE_ROW_PX ? 'compact' : 'comfortable';
}

export function TransactionStatsGrid({ txStats }: { txStats: TransactionListStats }) {
  // auto-fit rather than viewport breakpoints: this grid renders both full
  // width (wallet detail) and inside a half-width dashboard column, and
  // viewport-keyed columns can't tell those apart. The same reason drives
  // measuring the element rather than the viewport for the density switch.
  //
  // Inline style, not a `grid-cols-[...]` arbitrary utility: Tailwind here is
  // the CDN build (src/index.html), whose JIT emits arbitrary utilities
  // asynchronously after paint. A core utility would be in the initial sheet;
  // this one would not, so the first paint could land with no column template.
  const gridRef = useRef<HTMLDivElement>(null);
  const density = densityForWidth(useElementWidth(gridRef));
  const minTileWidth = density === 'compact' ? COMPACT_MIN_PX : COMFORTABLE_MIN_PX;

  return (
    <div
      ref={gridRef}
      data-testid="transaction-stats-grid"
      data-density={density}
      className={`grid gap-3 ${density === 'compact' ? 'mb-4' : 'mb-6'}`}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minTileWidth}px, 1fr))` }}
    >
      <StatTile density={density} label="Total" value={txStats.total} />
      <StatTile density={density} label="Received" value={txStats.received} icon={<ArrowDownLeft className="w-3 h-3 text-success-500" />} valueClassName="text-success-600" />
      <StatTile density={density} label="Sent" value={txStats.sent} icon={<ArrowUpRight className="w-3 h-3 text-sanctuary-500" />} />
      <StatTile density={density} label="Consolidations" value={txStats.consolidations} icon={<RefreshCw className="w-3 h-3 text-primary-500" />} valueClassName="text-primary-600 dark:text-primary-400" />
      <AmountStatTile density={density} label="Total In" sats={txStats.totalReceived} labelClassName="text-success-500" valueClassName="text-success-600" />
      <AmountStatTile density={density} label="Total Out" sats={txStats.totalSent} labelClassName="text-sanctuary-500" valueClassName="text-sanctuary-900 dark:text-sanctuary-100" />
      <AmountStatTile density={density} label="Fees Paid" sats={txStats.totalFees} labelClassName="text-warning-500" valueClassName="text-warning-600" />
    </div>
  );
}

// text-[10px] is intentional for the compact tile: the named sizes step from
// text-xs (12px) straight past it, and 12px labels are what make the tile need
// 9rem in the first place.
const TILE_BOX = {
  comfortable: 'surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800',
  compact: 'surface-elevated px-2 py-1.5 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800',
} as const;

const TILE_LABEL = {
  comfortable: 'text-xs',
  compact: 'text-[10px] leading-tight',
} as const;

const TILE_VALUE_TEXT = {
  comfortable: 'text-lg',
  compact: 'text-base leading-tight',
} as const;

function StatTile({
  density,
  label,
  value,
  icon,
  valueClassName = 'text-sanctuary-900 dark:text-sanctuary-100',
}: {
  density: TileDensity;
  label: string;
  value: number;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className={TILE_BOX[density]}>
      <div className={`flex items-center gap-1 ${TILE_LABEL[density]} text-sanctuary-500 uppercase`}>
        {icon}
        {label}
      </div>
      <div className={`${TILE_VALUE_TEXT[density]} font-semibold ${valueClassName}`}>{value}</div>
    </div>
  );
}

function AmountStatTile({
  density,
  label,
  sats,
  labelClassName,
  valueClassName,
}: {
  density: TileDensity;
  label: string;
  sats: number;
  labelClassName: string;
  valueClassName: string;
}) {
  return (
    <div className={TILE_BOX[density]}>
      <div className={`${TILE_LABEL[density]} uppercase ${labelClassName}`}>{label}</div>
      <div className={`${density === 'compact' ? 'text-xs' : 'text-sm'} font-semibold ${valueClassName}`}>
        <Amount sats={sats} size="sm" />
      </div>
    </div>
  );
}
