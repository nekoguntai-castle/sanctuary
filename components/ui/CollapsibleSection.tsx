import React, { useId } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useUserPreference } from '../../hooks/useUserPreference';

type HeadingLevel = 2 | 3 | 4;

interface CollapsibleSectionProps {
  /**
   * Inline heading content — text, not a heading element. This component
   * supplies the heading and wraps the toggle button in it (the WAI-ARIA
   * accordion pattern). Passing an `<h3>` here would nest flow content inside a
   * button, which is invalid HTML, and `role=button` flattens its descendants
   * so the heading would vanish from screen-reader heading navigation.
   */
  title: ReactNode;
  headingLevel?: HeadingLevel;
  headingClassName?: string;
  /**
   * Rendered beside the heading but OUTSIDE the button — network badges and the
   * like, which would otherwise leak into the button's accessible name.
   */
  titleAdornment?: ReactNode;
  /** Controls pinned to the right of the header — refresh buttons, status pills. */
  actions?: ReactNode;
  /**
   * Rendered in the header while collapsed. A collapsed section showing only
   * its title is dead space; give the reader the headline numbers instead.
   */
  summary?: ReactNode;
  /**
   * Dot-notation preference path, e.g. 'viewSettings.dashboard.mempoolCollapsed'.
   * Required: every caller so far wants the choice to persist. A second caller
   * needing ephemeral collapse should make this optional with a useState
   * fallback rather than inventing a throwaway preference key.
   */
  preferenceKey: string;
  defaultCollapsed?: boolean;
  /** Card shell classes. */
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}

/**
 * A card section whose body collapses away, with the state persisted per user.
 *
 * Unlike ShowMoreToggle, the body is genuinely removed from the layout, so
 * `aria-expanded`/`aria-controls` are accurate and always set.
 *
 * Note the children stay MOUNTED while collapsed — `hidden` only zeroes their
 * dimensions. Two consequences: any child that measures layout once on mount
 * (`getBoundingClientRect` without a `ResizeObserver`) will read zeroes and has
 * no signal to remeasure on reveal, and collapsing saves no render, effect, or
 * timer work.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  headingLevel = 3,
  headingClassName = '',
  titleAdornment,
  actions,
  summary,
  preferenceKey,
  defaultCollapsed = false,
  className = 'surface-elevated rounded-xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 card-interactive',
  headerClassName = 'flex items-center justify-between gap-4 px-2 mb-2',
  children,
}) => {
  const [collapsed, setCollapsed] = useUserPreference(preferenceKey, defaultCollapsed);
  const contentId = useId();
  const ChevronIcon = collapsed ? ChevronDown : ChevronUp;
  const Heading = `h${headingLevel}` as const;

  return (
    <section className={className}>
      <div className={headerClassName}>
        <div className="flex items-center gap-2 min-w-0">
          <Heading className={headingClassName}>
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-controls={contentId}
              className="flex items-center gap-1.5 rounded text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ChevronIcon className="w-4 h-4 shrink-0" />
              {title}
            </button>
          </Heading>
          {titleAdornment}
        </div>
        <div className="flex items-center gap-4 min-w-0">
          {collapsed && summary}
          {actions}
        </div>
      </div>
      <div id={contentId} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
};
