import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionSummary } from '../../../src/components/ui/SectionSummary';

describe('SectionSummary', () => {
  it('joins string parts into one addressable text run', () => {
    render(<SectionSummary testId="summary" parts={['~2 sat/vB', '13 blocks queued', '2 pending']} />);

    // The whole bar reads as one string. Testing Library's getNodeText
    // concatenates only direct text-node children, so this also pins the
    // separator to being text rather than a styled element with a CSS gap —
    // the latter would announce as "2 sat/vB·13 blocks queued" to a screen
    // reader.
    expect(screen.getByText('~2 sat/vB · 13 blocks queued · 2 pending')).toBeInTheDocument();
  });

  it('renders element parts alongside text', () => {
    render(
      <SectionSummary
        testId="summary"
        parts={['4 wallets', <span key="amt" data-testid="amount">0.5 BTC</span>]}
      />
    );

    const summary = screen.getByTestId('summary');
    expect(summary).toHaveTextContent('4 wallets');
    expect(summary).toContainElement(screen.getByTestId('amount'));
  });

  it('renders nothing when every part is absent', () => {
    const { container } = render(<SectionSummary testId="summary" parts={[]} />);

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('drops absent parts without leaving a stray separator', () => {
    // Callers inline conditions (`count > 0 && \`${count} pending\``), so false
    // and nullish arrive as parts. A surviving separator would render as a
    // leading or doubled middot.
    render(<SectionSummary testId="summary" parts={[null, '5 txns', undefined, false, '2h ago']} />);

    expect(screen.getByText('5 txns · 2h ago')).toBeInTheDocument();
  });

  it('drops the other parts that React renders as nothing', () => {
    // `true` is as type-legal and as invisible as `false`; `''` and `[]` are
    // dropped by React itself, so a filter that kept them would emit exactly
    // the doubled separator it exists to prevent.
    render(<SectionSummary testId="summary" parts={['5 txns', true, '', [], '2h ago']} />);

    expect(screen.getByText('5 txns · 2h ago')).toBeInTheDocument();
  });

  it('keeps zero, which is a legitimate figure', () => {
    render(<SectionSummary testId="summary" parts={[0, 'confirmed']} />);

    expect(screen.getByText('0 · confirmed')).toBeInTheDocument();
  });

  it('renders nothing when every part is empty rather than a bare separator', () => {
    render(<SectionSummary testId="summary" parts={[null, false, '']} />);

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });

  it('keeps the truncation classes that hold the bar on one line', () => {
    render(<SectionSummary testId="summary" parts={['a', 'b']} />);

    // jsdom has no layout engine, so the class names are the only observable
    // proxy. min-w-0 must be on the span itself: as a flex item of the
    // collapsible header its default min-width:auto refuses to shrink, so
    // truncate would never engage and the bar would push the heading out of
    // the card instead.
    const summary = screen.getByTestId('summary');
    expect(summary.className).toContain('truncate');
    expect(summary.className).toContain('min-w-0');
  });

});
