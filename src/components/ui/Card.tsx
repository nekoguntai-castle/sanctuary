import React from 'react';
import type { ElementType, ReactNode } from 'react';

export type CardPadding = 'sm' | 'md' | 'lg' | 'xl' | 'none';

const CARD_BASE =
  'surface-elevated rounded-xl shadow-sm border border-sanctuary-200 dark:border-sanctuary-800';

const CARD_PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
  xl: 'p-12',
};

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  padding?: CardPadding;
  /** Adds the lift-on-hover treatment (`card-interactive`). */
  interactive?: boolean;
  /** Render as a different element, e.g. `section` for a landmark. */
  as?: ElementType;
  children?: ReactNode;
}

/**
 * The shared elevated card shell. Before this, the class string was retyped in
 * 13 places across four feature directories, drifting only in padding — and had
 * begun leaking into `components/ui/` itself.
 */
export const Card: React.FC<CardProps> = ({
  padding = 'md',
  interactive = false,
  as: Component = 'div',
  className = '',
  children,
  ...props
}) => (
  <Component
    {...props}
    className={[CARD_BASE, CARD_PADDING[padding], interactive ? 'card-interactive' : '', className]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </Component>
);
