import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TransactionStatsGrid,
  densityForWidth,
} from '../../../src/components/TransactionList/TransactionList/TransactionStatsGrid';

/**
 * Seven statistics tiles at their comfortable minimum need 1080px to sit on one
 * line. Below that the grid wrapped to three or four rows and pushed the first
 * transaction row below the fold on a laptop. The tiles now shrink instead of
 * stacking, keyed off the grid's own width — the same grid renders full width on
 * wallet detail and inside a narrower column elsewhere, which a viewport
 * breakpoint cannot tell apart.
 */

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats = 0 }: { sats?: number }) => <span>{sats} sats</span>,
}));

const observations: { callback: ResizeObserverCallback }[] = [];

class CapturingResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    observations.push({ callback: this.callback });
  }
  unobserve() {}
  disconnect() {}
}

/** jsdom reports every box as 0×0, so the grid's width has to be stubbed. */
function stubWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
  } as DOMRect);
}

const txStats = {
  total: 12,
  received: 7,
  sent: 4,
  consolidations: 1,
  totalReceived: 500000,
  totalSent: 120000,
  totalFees: 900,
};

const grid = () => screen.getByTestId('transaction-stats-grid');

describe('TransactionStatsGrid density', () => {
  beforeEach(() => {
    observations.length = 0;
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('densityForWidth', () => {
    it('keeps the comfortable layout until the seven tiles stop fitting on one line', () => {
      expect(densityForWidth(1080)).toBe('comfortable');
      expect(densityForWidth(1079)).toBe('compact');
    });

    it('treats an unmeasured width as comfortable, so the wider layout is authoritative', () => {
      // The measurement runs in a layout effect, so `null` resolves before
      // paint; assuming compact here would flash a narrow header on desktop.
      expect(densityForWidth(null)).toBe('comfortable');
    });
  });

  it('renders full-size tiles when the grid has room for one row', () => {
    stubWidth(1200);

    render(<TransactionStatsGrid txStats={txStats} />);

    expect(grid()).toHaveAttribute('data-density', 'comfortable');
    expect(grid().style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(144px, 1fr))');
    expect(screen.getByText('Total').className).toContain('text-xs');
  });

  it('shrinks the tiles rather than stacking them when the grid is narrower', () => {
    stubWidth(900);

    render(<TransactionStatsGrid txStats={txStats} />);

    expect(grid()).toHaveAttribute('data-density', 'compact');
    expect(grid().style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(104px, 1fr))');
    // text-[10px] is deliberate: the named sizes step from text-xs straight past
    // it, and a 12px label is what makes the tile need 9rem in the first place.
    expect(screen.getByText('Total').className).toContain('text-[10px]');
    expect(screen.getByText('Total In').className).toContain('text-[10px]');
  });

  it('still renders every tile when compact', () => {
    stubWidth(900);

    render(<TransactionStatsGrid txStats={txStats} />);

    for (const label of ['Total', 'Received', 'Sent', 'Consolidations', 'Total In', 'Total Out', 'Fees Paid']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('switches density when its own box changes without a window resize', () => {
    stubWidth(1200);
    render(<TransactionStatsGrid txStats={txStats} />);
    expect(grid()).toHaveAttribute('data-density', 'comfortable');

    // A sidebar opening resizes this element and not the window.
    stubWidth(700);
    act(() => {
      observations[0].callback([], {} as ResizeObserver);
    });

    expect(grid()).toHaveAttribute('data-density', 'compact');
  });
});
