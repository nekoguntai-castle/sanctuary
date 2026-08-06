import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeeEstimationCard } from '../../../src/components/Dashboard/FeeEstimationCard';

vi.mock('lucide-react', () => ({
  Zap: () => <span data-testid="zap-icon" />,
}));

vi.mock('../../../src/components/Dashboard/AnimatedFeeRate', () => ({
  AnimatedFeeRate: ({ value }: { value: string }) => (
    <span data-testid="animated-fee-rate">{value}</span>
  ),
}));

const mockFormatFeeRate = (rate: number | undefined) =>
  rate !== undefined ? `${rate} sat/vB` : '---';

describe('FeeEstimationCard', () => {
  it('renders all three fee tiers with rates', () => {
    const fees = { fast: 20, medium: 10, slow: 3 };

    render(
      <FeeEstimationCard fees={fees} formatFeeRate={mockFormatFeeRate} />,
    );

    // Tier names sit under the rates as the legend now, lower-cased: the
    // numbers are what the reader came for, not the labels.
    expect(screen.getByText('fast')).toBeInTheDocument();
    expect(screen.getByText('normal')).toBeInTheDocument();
    expect(screen.getByText('slow')).toBeInTheDocument();
    // The unit is stated once on the card rather than repeated per row.
    expect(screen.getByText('sat/vB')).toBeInTheDocument();

    const feeRates = screen.getAllByTestId('animated-fee-rate');
    expect(feeRates[0]).toHaveTextContent('20');
    expect(feeRates[1]).toHaveTextContent('10');
    expect(feeRates[2]).toHaveTextContent('3');
  });

  it('renders --- when fees are null', () => {
    render(
      <FeeEstimationCard fees={null} formatFeeRate={mockFormatFeeRate} />,
    );

    const feeRates = screen.getAllByTestId('animated-fee-rate');
    feeRates.forEach(el => {
      expect(el).toHaveTextContent('---');
    });
  });

  it('renders estimated sats in tooltip when rate is available', () => {
    const fees = { fast: 10, medium: 5, slow: 2 };

    const { container } = render(
      <FeeEstimationCard fees={fees} formatFeeRate={mockFormatFeeRate} />,
    );

    // TYPICAL_VB = 140, so fast = 10*140 = 1,400 sats
    expect(container.textContent).toContain('1,400');
    // medium = 5*140 = 700 sats
    expect(container.textContent).toContain('700');
    // slow = 2*140 = 280 sats
    expect(container.textContent).toContain('280');
  });

  it('renders tooltip timing info for each tier', () => {
    const fees = { fast: 10, medium: 5, slow: 2 };

    render(
      <FeeEstimationCard fees={fees} formatFeeRate={mockFormatFeeRate} />,
    );

    expect(screen.getByText('~10 min / ~1 block')).toBeInTheDocument();
    expect(screen.getByText('~30 min / ~3 blocks')).toBeInTheDocument();
    expect(screen.getByText('~60 min / ~6 blocks')).toBeInTheDocument();
  });

  it('does not render estimated sats when rate is undefined', () => {
    const { container } = render(
      <FeeEstimationCard fees={null} formatFeeRate={mockFormatFeeRate} />,
    );

    // No sats estimation should appear
    expect(container.textContent).not.toContain('sats for typical tx');
  });
});
