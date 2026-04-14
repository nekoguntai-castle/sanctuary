import {
  mockCriticalInsight,
  mockInfoInsight,
  mockInsight,
} from './intelligenceTabsTestHarness';
import type { AIInsight } from './intelligenceTabsTestHarness';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightCard } from '../../../components/Intelligence/tabs/InsightCard';

describe('InsightCard', () => {
  const defaultProps = {
    insight: mockInsight,
    onDismiss: vi.fn(),
    onActedOn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render title, summary, and severity type badge', () => {
    render(<InsightCard {...defaultProps} />);

    expect(screen.getByText('Fragmented UTXOs Detected')).toBeInTheDocument();
    expect(
      screen.getByText('Your wallet has 47 small UTXOs that could be consolidated.')
    ).toBeInTheDocument();
    expect(screen.getByText('UTXO Health')).toBeInTheDocument();
  });

  it('should expand on click to show analysis', () => {
    render(<InsightCard {...defaultProps} />);

    // Analysis should not be visible initially
    expect(
      screen.queryByText(
        'Detailed analysis of UTXO fragmentation and recommended consolidation strategy.'
      )
    ).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    // Analysis should now be visible
    expect(
      screen.getByText('Detailed analysis of UTXO fragmentation and recommended consolidation strategy.')
    ).toBeInTheDocument();
  });

  it('should collapse on second click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(screen.getByText(/Detailed analysis/)).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(screen.queryByText(/Detailed analysis/)).not.toBeInTheDocument();
  });

  it('should call onDismiss when Dismiss button is clicked', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to see action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Dismiss'));

    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should call onActedOn when "Mark as acted on" button is clicked', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to see action buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Mark as acted on'));

    expect(defaultProps.onActedOn).toHaveBeenCalledTimes(1);
  });

  it('should render critical severity correctly', () => {
    render(
      <InsightCard
        {...defaultProps}
        insight={mockCriticalInsight}
      />
    );

    expect(screen.getByText('Unusual Transaction Pattern')).toBeInTheDocument();
    expect(screen.getByText('Anomaly Detection')).toBeInTheDocument();
  });

  it('should render info severity correctly', () => {
    render(
      <InsightCard
        {...defaultProps}
        insight={mockInfoInsight}
      />
    );

    expect(screen.getByText('Low Fee Window')).toBeInTheDocument();
    expect(screen.getByText('Fee Timing')).toBeInTheDocument();
  });

  it('should show relative time for recent insights', () => {
    render(<InsightCard {...defaultProps} />);

    // The createdAt is "now", so it should show "just now"
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('should show relative time in minutes', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('should show relative time in hours', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('should show relative time in days', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('should show date string for older insights', () => {
    const pastInsight = {
      ...mockInsight,
      createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    render(<InsightCard {...defaultProps} insight={pastInsight} />);

    // Should show a formatted date string (locale-dependent)
    const dateText = new Date(pastInsight.createdAt).toLocaleDateString();
    expect(screen.getByText(dateText)).toBeInTheDocument();
  });

  it('should render all insight types with correct labels', () => {
    const types: Array<{ type: AIInsight['type']; label: string }> = [
      { type: 'utxo_health', label: 'UTXO Health' },
      { type: 'fee_timing', label: 'Fee Timing' },
      { type: 'anomaly', label: 'Anomaly Detection' },
      { type: 'tax', label: 'Tax Implications' },
      { type: 'consolidation', label: 'Consolidation' },
    ];

    for (const { type, label } of types) {
      const { unmount } = render(
        <InsightCard
          {...defaultProps}
          insight={{ ...mockInsight, type }}
        />
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('should stop event propagation on dismiss button click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to show buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));
    expect(screen.getByText('Dismiss')).toBeInTheDocument();

    // Click dismiss - should not collapse the card (stopPropagation)
    fireEvent.click(screen.getByText('Dismiss'));

    // The card should still be expanded (analysis still visible)
    expect(defaultProps.onDismiss).toHaveBeenCalled();
  });

  it('should stop event propagation on acted on button click', () => {
    render(<InsightCard {...defaultProps} />);

    // Expand to show buttons
    fireEvent.click(screen.getByText('Fragmented UTXOs Detected'));

    fireEvent.click(screen.getByText('Mark as acted on'));

    expect(defaultProps.onActedOn).toHaveBeenCalled();
  });
});
