/**
 * Amount Component Tests
 *
 * Tests for the Bitcoin amount display component.
 */

import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { Amount } from '../../src/components/Amount';
import { useCurrency } from '../../src/contexts/CurrencyContext';

// Mock the CurrencyContext
vi.mock('../../src/contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(() => ({
    format: vi.fn((sats: number, options?: { forceSats?: boolean }) => {
      if (options?.forceSats) {
        return `${sats.toLocaleString()} sats`;
      }
      // Default to BTC format
      const btc = sats / 100_000_000;
      return `${btc.toFixed(8)} BTC`;
    }),
    formatFiat: vi.fn((sats: number) => {
      // Mock $1 = 100,000 sats
      const usd = sats / 100_000;
      return `$${usd.toFixed(2)}`;
    }),
  })),
}));

describe('Amount', () => {
  describe('rendering', () => {
    it('should render Bitcoin amount', () => {
      render(<Amount sats={100000000} />);

      expect(screen.getByText('1.00000000 BTC')).toBeInTheDocument();
    });

    it('should render fiat value', () => {
      render(<Amount sats={100000} />);

      expect(screen.getByText('$1.00')).toBeInTheDocument();
    });

    it('should render both BTC and fiat', () => {
      render(<Amount sats={1000000} />);

      expect(screen.getByText('0.01000000 BTC')).toBeInTheDocument();
      expect(screen.getByText('$10.00')).toBeInTheDocument();
    });
  });

  describe('showSign', () => {
    it('should show + sign for positive amounts when showSign is true', () => {
      render(<Amount sats={100000} showSign={true} />);

      expect(screen.getByText('+0.00100000 BTC')).toBeInTheDocument();
    });

    it('should show - sign for negative amounts when showSign is true', () => {
      render(<Amount sats={-100000} showSign={true} />);

      expect(screen.getByText('-0.00100000 BTC')).toBeInTheDocument();
    });

    it('should show - sign for negative amounts even when showSign is false', () => {
      render(<Amount sats={-100000} showSign={false} />);

      expect(screen.getByText('-0.00100000 BTC')).toBeInTheDocument();
    });

    it('should not show sign for positive amounts when showSign is false', () => {
      render(<Amount sats={100000} showSign={false} />);

      expect(screen.getByText('0.00100000 BTC')).toBeInTheDocument();
    });
  });

  describe('forceSats', () => {
    it('should force sats display when forceSats is true', () => {
      render(<Amount sats={100000} forceSats={true} />);

      expect(screen.getByText('100,000 sats')).toBeInTheDocument();
    });
  });

  describe('inline', () => {
    it('should render inline when inline is true', () => {
      const { container } = render(<Amount sats={100000} inline={true} />);

      // Inline uses span, non-inline uses div
      expect(container.querySelector('span')).toBeInTheDocument();
      expect(container.querySelector('div.flex.flex-col')).not.toBeInTheDocument();
    });

    it('should render as flex column when inline is false', () => {
      const { container } = render(<Amount sats={100000} inline={false} />);

      expect(container.querySelector('div.flex.flex-col')).toBeInTheDocument();
    });

    it('should add margin between BTC and fiat in inline mode', () => {
      const { container } = render(<Amount sats={100000} inline={true} />);

      const fiatSpan = container.querySelectorAll('span span')[1];
      expect(fiatSpan).toHaveClass('ml-2');
    });

    it('should stay phrasing-level inline when there is no fiat to show', () => {
      // Non-regression: `formatFiat` returns null whenever fiat is switched off
      // or the network is not mainnet, which is the default state for
      // testnet/signet users. The inline branch used to be gated on
      // `inline && fiatValue`, so those callers silently fell through to the
      // block `<div class="flex flex-col">`.
      //
      // That div is flow content emitted into callers' phrasing-content spans
      // (SectionSummary, PriceChart's pending row) — invalid HTML, and a
      // block-level box beside inline text forces an anonymous block box, so
      // the row breaks onto two lines. `truncate`/`whitespace-nowrap` cannot
      // prevent that.
      vi.mocked(useCurrency).mockReturnValueOnce({
        format: (sats: number) => `${(sats / 100_000_000).toFixed(8)} BTC`,
        formatFiat: () => null,
      } as unknown as ReturnType<typeof useCurrency>);

      const { container } = render(<Amount sats={100000} inline={true} />);

      expect(container.querySelector('div')).not.toBeInTheDocument();
      expect(container.firstElementChild?.tagName).toBe('SPAN');
      expect(screen.getByText('0.00100000 BTC')).toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('should apply small size classes', () => {
      render(<Amount sats={100000} size="sm" />);

      const btcElement = screen.getByText('0.00100000 BTC');
      expect(btcElement).toHaveClass('text-sm');
    });

    it('should apply medium size classes', () => {
      render(<Amount sats={100000} size="md" />);

      const btcElement = screen.getByText('0.00100000 BTC');
      expect(btcElement).toHaveClass('text-base');
    });

    it('should apply large size classes', () => {
      render(<Amount sats={100000} size="lg" />);

      const btcElement = screen.getByText('0.00100000 BTC');
      expect(btcElement).toHaveClass('text-lg');
    });

    it('should apply xl size classes', () => {
      render(<Amount sats={100000} size="xl" />);

      const btcElement = screen.getByText('0.00100000 BTC');
      expect(btcElement).toHaveClass('text-2xl');
    });

    it('should default to medium size', () => {
      render(<Amount sats={100000} />);

      const btcElement = screen.getByText('0.00100000 BTC');
      expect(btcElement).toHaveClass('text-base');
    });
  });

  describe('fiat size classes', () => {
    it('should apply small fiat size for sm and md', () => {
      render(<Amount sats={100000} size="sm" />);

      const fiatElement = screen.getByText('$1.00');
      expect(fiatElement).toHaveClass('text-xs');
    });

    it('should apply base fiat size for xl', () => {
      render(<Amount sats={100000} size="xl" />);

      const fiatElement = screen.getByText('$1.00');
      expect(fiatElement).toHaveClass('text-base');
    });
  });

  describe('custom classNames', () => {
    it('should apply custom className to container', () => {
      const { container } = render(<Amount sats={100000} className="custom-class" />);

      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });

    it('should apply custom fiatClassName to fiat element', () => {
      render(<Amount sats={100000} fiatClassName="fiat-custom" />);

      const fiatElement = screen.getByText('$1.00');
      expect(fiatElement).toHaveClass('fiat-custom');
    });
  });

  describe('fiat styling', () => {
    it('should apply primary color classes to fiat', () => {
      render(<Amount sats={100000} />);

      const fiatElement = screen.getByText('$1.00');
      expect(fiatElement).toHaveClass('text-primary-500');
    });
  });

  describe('absolute values', () => {
    it('should use absolute value for formatting negative amounts', () => {
      render(<Amount sats={-500000} />);

      // Should display 0.00500000 BTC (absolute value)
      expect(screen.getByText('-0.00500000 BTC')).toBeInTheDocument();
      // Fiat should also use absolute
      expect(screen.getByText('$5.00')).toBeInTheDocument();
    });
  });
});
