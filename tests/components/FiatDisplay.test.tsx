import { render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

import {
FiatDisplay,
FiatDisplayBlock,
FiatDisplayInline,
FiatDisplaySubtle,
} from '../../components/FiatDisplay';

// Mock the CurrencyContext
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

import { useCurrency } from '../../contexts/CurrencyContext';

const mockUseCurrency = useCurrency as ReturnType<typeof vi.fn>;

describe('FiatDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('should render fiat value when available', () => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$245.00'),
      });

      render(<FiatDisplay sats={50000} />);

      expect(screen.getByText('$245.00')).toBeInTheDocument();
    });

    it('should return null when fiat is disabled', () => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => null),
      });

      const { container } = render(<FiatDisplay sats={50000} />);

      expect(container.firstChild).toBeNull();
    });

    it('should return null when fiat value is unavailable', () => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => null),
      });

      const { container } = render(<FiatDisplay sats={50000} />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Display modes', () => {
    beforeEach(() => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$500.00'),
      });
    });

    it('should apply block mode classes by default', () => {
      render(<FiatDisplay sats={100000} />);

      const element = screen.getByText('$500.00');
      expect(element).toHaveClass('text-primary-500');
    });

    it('should apply inline mode classes', () => {
      render(<FiatDisplay sats={100000} mode="inline" />);

      const element = screen.getByText('$500.00');
      expect(element).toHaveClass('text-primary-500');
    });

    it('should apply subtle mode classes', () => {
      render(<FiatDisplay sats={100000} mode="subtle" />);

      const element = screen.getByText('$500.00');
      expect(element).toHaveClass('text-sanctuary-500');
    });
  });

  describe('Size presets', () => {
    beforeEach(() => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$100.00'),
      });
    });

    it('should apply xs size class', () => {
      render(<FiatDisplay sats={20000} size="xs" />);

      const element = screen.getByText('$100.00');
      expect(element).toHaveClass('text-[10px]');
    });

    it('should apply sm size class (default)', () => {
      render(<FiatDisplay sats={20000} size="sm" />);

      const element = screen.getByText('$100.00');
      expect(element).toHaveClass('text-xs');
    });

    it('should apply md size class', () => {
      render(<FiatDisplay sats={20000} size="md" />);

      const element = screen.getByText('$100.00');
      expect(element).toHaveClass('text-sm');
    });

    it('should apply lg size class', () => {
      render(<FiatDisplay sats={20000} size="lg" />);

      const element = screen.getByText('$100.00');
      expect(element).toHaveClass('text-base');
    });
  });

  describe('Prefix options', () => {
    beforeEach(() => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$750.00'),
      });
    });

    it('should show approximate symbol when showApprox is true', () => {
      render(<FiatDisplay sats={150000} showApprox />);

      expect(screen.getByText('≈ $750.00')).toBeInTheDocument();
    });

    it('should not show approximate symbol by default', () => {
      render(<FiatDisplay sats={150000} />);

      expect(screen.getByText('$750.00')).toBeInTheDocument();
      expect(screen.queryByText('≈ $750.00')).not.toBeInTheDocument();
    });

    it('should use custom prefix when provided', () => {
      render(<FiatDisplay sats={150000} prefix="Total: " />);

      expect(screen.getByText('Total: $750.00')).toBeInTheDocument();
    });

    it('should prefer custom prefix over showApprox', () => {
      render(<FiatDisplay sats={150000} prefix="Custom: " showApprox />);

      expect(screen.getByText('Custom: $750.00')).toBeInTheDocument();
      expect(screen.queryByText('≈ $750.00')).not.toBeInTheDocument();
    });
  });

  describe('Negative amounts', () => {
    beforeEach(() => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$200.00'),
      });
    });

    it('should show negative sign when negative prop is true', () => {
      render(<FiatDisplay sats={40000} negative />);

      expect(screen.getByText('-$200.00')).toBeInTheDocument();
    });

    it('should not show negative sign by default', () => {
      render(<FiatDisplay sats={40000} />);

      expect(screen.getByText('$200.00')).toBeInTheDocument();
    });

    it('should combine negative with prefix', () => {
      render(<FiatDisplay sats={40000} negative showApprox />);

      expect(screen.getByText('≈ -$200.00')).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    beforeEach(() => {
      mockUseCurrency.mockReturnValue({
        formatFiat: vi.fn(() => '$300.00'),
      });
    });

    it('should apply custom className', () => {
      render(<FiatDisplay sats={60000} className="ml-2 font-bold" />);

      const element = screen.getByText('$300.00');
      expect(element).toHaveClass('ml-2');
      expect(element).toHaveClass('font-bold');
    });
  });

  describe('Uses absolute value', () => {
    it('should use absolute value for formatting', () => {
      const mockFormatFiat = vi.fn(() => '$100.00');
      mockUseCurrency.mockReturnValue({
        formatFiat: mockFormatFiat,
      });

      render(<FiatDisplay sats={-20000} />);

      // Should pass absolute value (20000) to formatFiat
      expect(mockFormatFiat).toHaveBeenCalledWith(20000, { network: undefined });
    });
  });
});

describe('Convenience wrapper components', () => {
  beforeEach(() => {
    mockUseCurrency.mockReturnValue({
      formatFiat: vi.fn(() => '$1,000.00'),
    });
  });

  describe('FiatDisplayBlock', () => {
    it('should render with block mode', () => {
      render(<FiatDisplayBlock sats={200000} />);

      const element = screen.getByText('$1,000.00');
      expect(element).toHaveClass('text-primary-500');
    });

    it('should pass through other props', () => {
      render(<FiatDisplayBlock sats={200000} showApprox size="lg" />);

      expect(screen.getByText('≈ $1,000.00')).toBeInTheDocument();
    });
  });

  describe('FiatDisplayInline', () => {
    it('should render with inline mode', () => {
      render(<FiatDisplayInline sats={200000} />);

      const element = screen.getByText('$1,000.00');
      expect(element).toHaveClass('text-primary-500');
    });
  });

  describe('FiatDisplaySubtle', () => {
    it('should render with subtle mode', () => {
      render(<FiatDisplaySubtle sats={200000} />);

      const element = screen.getByText('$1,000.00');
      expect(element).toHaveClass('text-sanctuary-500');
    });
  });
});

describe('Edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle zero sats', () => {
    mockUseCurrency.mockReturnValue({
      formatFiat: vi.fn(() => '$0.00'),
    });

    render(<FiatDisplay sats={0} />);

    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('should handle very large amounts', () => {
    mockUseCurrency.mockReturnValue({
      formatFiat: vi.fn(() => '$1,234,567.89'),
    });

    render(<FiatDisplay sats={2469135780000} />);

    expect(screen.getByText('$1,234,567.89')).toBeInTheDocument();
  });

  it('should handle loading state (-----)', () => {
    mockUseCurrency.mockReturnValue({
      formatFiat: vi.fn(() => '-----'),
    });

    render(<FiatDisplay sats={50000} />);

    expect(screen.getByText('-----')).toBeInTheDocument();
  });
});
