import React from 'react';
import type { ReactNode } from 'react';

interface SectionSummaryProps {
  /**
   * Headline figures, rendered left to right and separated by middots.
   *
   * `ReactNode` rather than `string` because callers pass rendered amounts
   * (`<Amount>`) alongside plain text. Nullish and `false` entries are dropped,
   * so callers can inline a condition without assembling the array first.
   */
  parts: ReactNode[];
  testId?: string;
}

/**
 * Carries its own spaces, and is emitted as text rather than as a styled
 * element with a CSS gap. Two reasons, both load-bearing:
 *
 * - A screen reader reads the bar as one string. Separators spaced by `gap-*`
 *   leave no whitespace in the text, so it announces as `2 sat/vB·13 blocks`.
 * - Testing Library's `getNodeText` concatenates only *direct text-node*
 *   children. Keeping every string part a direct text node means an all-text
 *   bar stays addressable as one `getByText`, exactly as it was when this was
 *   built with `parts.join(' · ')`. A bar containing an element part (an
 *   `<Amount>`, say) does not — that element's text is excluded, so those
 *   callers must assert with `toHaveTextContent` instead.
 */
const SEPARATOR = ' · ';

/**
 * Would this part render as nothing?
 *
 * `ReactNode` admits `boolean`, `null`, `undefined`, `''` and empty iterables,
 * all of which React renders as nothing — so a separator emitted beside one
 * shows up as a leading or doubled middot. `cond && value` is the idiom callers
 * reach for, which makes `false` the common case, but `true` and `''` are just
 * as type-legal and just as invisible.
 *
 * Zero is deliberately NOT empty: `0` is a legitimate figure in a summary bar.
 */
function rendersNothing(part: ReactNode): boolean {
  if (part === null || part === undefined || typeof part === 'boolean' || part === '') {
    return true;
  }

  // Arrays and other iterables flatten; an empty one contributes no output.
  return Array.isArray(part) && part.length === 0;
}

/**
 * The one-line figure bar shown in a `CollapsibleSection` header while the
 * section is collapsed. A collapsed section showing only its title is dead
 * space; this is what fills it.
 *
 * Everything sits on a single row on purpose. A multi-line block here reads as
 * squashed against the disclosure heading beside it, and inflates the header's
 * cross-size so collapsing the section barely shortens the page.
 */
export const SectionSummary: React.FC<SectionSummaryProps> = ({ parts, testId }) => {
  const visible = parts.filter((part) => !rendersNothing(part));

  if (visible.length === 0) {
    return null;
  }

  return (
    // `min-w-0` belongs on this span, not a wrapper: as a flex item of the
    // CollapsibleSection header its default `min-width: auto` refuses to shrink
    // below its content, so `truncate` would never engage and the bar would
    // instead push the heading out of the card.
    <span
      className="text-xs text-sanctuary-500 dark:text-sanctuary-400 tabular-nums truncate min-w-0"
      data-testid={testId}
    >
      {visible.map((part, index) => (
        // Index keys: `parts` is a positional list whose entries are arbitrary
        // nodes with no identity of their own, and it never reorders.
        <React.Fragment key={index}>
          {index > 0 && SEPARATOR}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
};
