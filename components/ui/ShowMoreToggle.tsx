import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './Button';

interface ShowMoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
  /** Label shown while collapsed, e.g. "Show all 9 wallets". */
  collapsedLabel: string;
  /** Label shown while expanded. */
  expandedLabel?: string;
  /**
   * id of the region this control fully hides and reveals. Set it ONLY for a
   * true disclosure. When the region stays visible and merely truncates — a
   * capped table, a clipped warning list — leave it unset: `aria-expanded` on
   * a control whose region never disappears misreports the state, and the
   * button's accessible name already carries both state and action.
   */
  controls?: string;
  className?: string;
}

/**
 * Shared "show more / show less" control, for a plain-text label with a
 * trailing chevron. Currently used by WalletSummary and SpendPrivacyCard.
 *
 * Three other hand-rolled copies exist and are deliberately NOT migrated yet,
 * because each needs an API addition first:
 * - DraftFlowToggle renders its chevron *before* the label — needs
 *   `iconPosition`.
 * - PrivacyDetailPanel's LearnMoreSection labels with an icon + text and lays
 *   out `justify-between` — needs `collapsedLabel: ReactNode`.
 * - InsightCard's trigger is a whole multi-element card header with a
 *   right/down chevron. That is CollapsibleSection's shape, not this one's.
 */
export const ShowMoreToggle: React.FC<ShowMoreToggleProps> = ({
  expanded,
  onToggle,
  collapsedLabel,
  expandedLabel = 'Show less',
  controls,
  className = '',
}) => {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-expanded={controls ? expanded : undefined}
      aria-controls={controls}
      className={`gap-1.5 ${className}`}
    >
      {expanded ? expandedLabel : collapsedLabel}
      <ChevronIcon className="w-4 h-4" />
    </Button>
  );
};
