import React from 'react';
import type { ReactNode } from 'react';
import { Card } from '../ui/Card';

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

    {support && <div className="mt-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">{support}</div>}

    {/* `mt-auto` keeps the bottom edge flush across the row even when the
        cards carry different amounts of detail. */}
    {detail && <div className="mt-auto pt-3 text-xs">{detail}</div>}
  </Card>
);
