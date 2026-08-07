import React from 'react';
import type { ReactNode } from 'react';
import { Card } from '../ui/Card';

/**
 * Typography — and only typography — for the line under the headline.
 *
 * Exported because FeeEstimationCard cannot use the `support` slot: its tier
 * names have to share grid tracks with the rates to sit under them, so they
 * render inside the headline block instead, and still have to read as a
 * support line. The 8px offset below the headline is not covered here; see the
 * note on `mt-2` in the render.
 */
export const TELEMETRY_SUPPORT_CLASS = 'text-xs text-sanctuary-500 dark:text-sanctuary-400';

interface TelemetryCardProps {
  /** Eyebrow label, e.g. `Bitcoin Price`. */
  title: string;
  /** Rendered beside the title — network badges, status dots. */
  titleAdornment?: ReactNode;
  /** The one figure the card exists to show. */
  headline: ReactNode;
  /** One line of context under the headline. */
  support?: ReactNode;
  /** Optional third line, or a disclosure for detail that does not fit. */
  detail?: ReactNode;
  testId?: string;
}

/**
 * Shared shell for the dashboard's telemetry row.
 *
 * The three cards previously shared only an eyebrow: one was a big number with
 * half a card of dead space, one was three nested inset panels, and one was a
 * dense key/value dump cramped into a third of the width. Same row, three
 * different densities and three different internal grammars, with a ragged
 * bottom edge.
 *
 * The shape is deliberately shallow — eyebrow, one headline, one supporting
 * line, optional detail. Anything that does not fit belongs behind a
 * disclosure rather than making this card taller than its neighbours.
 *
 * A card whose supporting line has to column-align with segments of the
 * headline may render that line inside `headline` and style it with
 * `TELEMETRY_SUPPORT_CLASS`, leaving `support` unset — separate rows size their
 * tracks independently and cannot be made to line up. The shape is unchanged;
 * only the nesting is. FeeEstimationCard is the one such case.
 */
export const TelemetryCard: React.FC<TelemetryCardProps> = ({
  title,
  titleAdornment,
  headline,
  support,
  detail,
  testId,
}) => (
  // No stagger class: the telemetry row's `stagger-enter` parent owns the
  // per-child delay via nth-child, which outranks any animate-fade-in-up-*.
  <Card className="flex flex-col" data-testid={testId}>
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">
        {title}
      </h3>
      {titleAdornment}
    </div>

    <div className="text-2xl font-bold font-mono tabular-nums text-sanctuary-900 dark:text-sanctuary-50 leading-none">
      {headline}
    </div>

    {/* `mt-2` — FeeEstimationCard mirrors this as `gap-y-2` inside its headline
        grid, because its supporting line lives there. Change both together or
        its tier names fall off the rhythm the other two cards sit on. */}
    {support && <div className={`mt-2 ${TELEMETRY_SUPPORT_CLASS}`}>{support}</div>}

    {/* `mt-auto` keeps the bottom edge flush across the row even when the
        cards carry different amounts of detail. */}
    {detail && <div className="mt-auto pt-3 text-xs">{detail}</div>}
  </Card>
);
