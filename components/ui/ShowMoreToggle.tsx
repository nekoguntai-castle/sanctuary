import React from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './Button';

interface ShowMoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
  /** Label shown while collapsed, e.g. "Show all 9 wallets". */
  collapsedLabel: ReactNode;
  /** Label shown while expanded. */
  expandedLabel?: ReactNode;
  /** Chevron before or after the label. */
  iconPosition?: 'leading' | 'trailing';
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
 * Shared "show more / show less" control: a label plus a chevron, in the ghost
 * button style.
 *
 * Used by WalletSummary, SpendPrivacyCard (truncating lists — no `controls`),
 * and DraftFlowToggle, PrivacyDetailPanel (true disclosures — `controls` set).
 *
 * Not used by Intelligence/tabs/InsightCard: its trigger is an entire
 * multi-element card header with a right/down chevron, which is
 * CollapsibleSection's shape rather than this one's.
 */
export const ShowMoreToggle: React.FC<ShowMoreToggleProps> = ({
  expanded,
  onToggle,
  collapsedLabel,
  expandedLabel = 'Show less',
  iconPosition = 'trailing',
  controls,
  className = '',
}) => {
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;
  const icon = <ChevronIcon className="w-4 h-4 shrink-0" />;
  const label = expanded ? expandedLabel : collapsedLabel;

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
      {iconPosition === 'leading' ? icon : null}
      {label}
      {iconPosition === 'trailing' ? icon : null}
    </Button>
  );
};
