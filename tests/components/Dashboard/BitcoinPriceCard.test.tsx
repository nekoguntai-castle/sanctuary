import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BitcoinPriceCard } from '../../../src/components/Dashboard/BitcoinPriceCard';

vi.mock('lucide-react', () => ({
  TrendingUp: () => <span data-testid="trending-up" />,
  TrendingDown: () => <span data-testid="trending-down" />,
  Bitcoin: () => <span data-testid="bitcoin-icon" />,
}));

vi.mock('../../../src/components/Dashboard/PriceChart', () => ({
  AnimatedPrice: ({ value, symbol }: { value: number | null; symbol: string }) => (
    <span data-testid="animated-price">{value !== null ? `${symbol}${value}` : '---'}</span>
  ),
}));

describe('BitcoinPriceCard', () => {
  describe('mainnet', () => {
    it('renders animated price for mainnet', () => {
      render(
        <BitcoinPriceCard
          btcPrice={50000}
          currencySymbol="$"
          priceChange24h={2.5}
          priceChangePositive={true}
          lastPriceUpdate={new Date('2026-01-01T12:00:00Z')}
        />,
      );

      expect(screen.getByTestId('animated-price')).toHaveTextContent('$50000');
    });

    it('shows positive price change with TrendingUp icon', () => {
      render(
        <BitcoinPriceCard
          btcPrice={50000}
          currencySymbol="$"
          priceChange24h={2.5}
          priceChangePositive={true}
          lastPriceUpdate={null}
        />,
      );

      expect(screen.getByTestId('trending-up')).toBeInTheDocument();
      expect(screen.getByTestId('price-change-24h')).toHaveTextContent('+2.50%');
    });

    it('shows negative price change with TrendingDown icon', () => {
      render(
        <BitcoinPriceCard
          btcPrice={48000}
          currencySymbol="$"
          priceChange24h={-3.75}
          priceChangePositive={false}
          lastPriceUpdate={null}
        />,
      );

      expect(screen.getByTestId('trending-down')).toBeInTheDocument();
      expect(screen.getByTestId('price-change-24h')).toHaveTextContent('-3.75%');
    });

    it('shows --- when priceChange24h is null', () => {
      render(
        <BitcoinPriceCard
          btcPrice={50000}
          currencySymbol="$"
          priceChange24h={null}
          priceChangePositive={false}
          lastPriceUpdate={null}
        />,
      );

      expect(screen.getByTestId('price-change-24h')).toHaveTextContent('---');
      expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
      expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
    });

    it('shows last price update time when available', () => {
      const updateTime = new Date('2026-01-01T14:30:00Z');
      render(
        <BitcoinPriceCard
          btcPrice={50000}
          currencySymbol="$"
          priceChange24h={1}
          priceChangePositive={true}
          lastPriceUpdate={updateTime}
        />,
      );

      // Time should be rendered (the exact format depends on locale), now
      // labelled rather than sitting bare in the corner.
      const timeText = updateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      expect(screen.getByText(`updated ${timeText}`)).toBeInTheDocument();
    });

    it('does not show time when lastPriceUpdate is null', () => {
      const { container } = render(
        <BitcoinPriceCard
          btcPrice={50000}
          currencySymbol="$"
          priceChange24h={1}
          priceChangePositive={true}
          lastPriceUpdate={null}
        />,
      );

      // No time element should render
      const timeSpans = container.querySelectorAll('.text-xs.text-sanctuary-400');
      const timeSpan = Array.from(timeSpans).find(el => el.textContent?.match(/\d{1,2}:\d{2}/));
      expect(timeSpan).toBeUndefined();
    });
  });

  // The tBTC/sBTC "no market value" placeholder is gone: the card is mainnet-only
  // now, and DashboardContent omits it entirely on testnet and signet. The
  // absence is asserted where the decision is made — see Dashboard.render.test.
});
