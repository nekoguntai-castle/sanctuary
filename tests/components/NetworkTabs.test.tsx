import { act,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkTabs,TabNetwork } from '../../components/NetworkTabs';

const setTabLayout = (element: HTMLElement, left: number, width: number) => {
  Object.defineProperty(element, 'offsetLeft', {
    configurable: true,
    value: left,
  });
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    value: width,
  });
};

describe('NetworkTabs', () => {
  const mockOnNetworkChange = vi.fn();

  const defaultProps = {
    selectedNetwork: 'mainnet' as TabNetwork,
    onNetworkChange: mockOnNetworkChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Rendering', () => {
    it('should render all three network tabs', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet')).toBeInTheDocument();
      expect(screen.getByText('Signet')).toBeInTheDocument();
    });

    it('should not display wallet counts in compact sidebar tabs', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.queryByText('3')).not.toBeInTheDocument();
      expect(screen.queryByText('2')).not.toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <NetworkTabs {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should render network color dots for each tab', () => {
      const { container } = render(<NetworkTabs {...defaultProps} />);

      const dots = container.querySelectorAll('[aria-hidden="true"]');
      expect(dots).toHaveLength(3);
      expect(dots[0]).toHaveClass('bg-mainnet-500');
      expect(dots[1]).toHaveClass('bg-testnet-500');
      expect(dots[2]).toHaveClass('bg-signet-500');
    });

    it('should render a sliding indicator element', () => {
      const { container } = render(<NetworkTabs {...defaultProps} />);

      const indicator = container.querySelector('.shadow-sm');
      expect(indicator).toBeInTheDocument();
    });

    it('should remeasure initially selected Testnet after the tab strip settles', () => {
      let onResize: ResizeObserverCallback | undefined;
      class MockResizeObserver implements ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();

        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }
      }
      vi.stubGlobal('ResizeObserver', MockResizeObserver);
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const { container } = render(
        <NetworkTabs {...defaultProps} selectedNetwork="testnet" fullWidth />
      );
      const testnetButton = screen.getByRole('button', { name: 'Testnet' });
      const indicator = container.querySelector('.shadow-sm') as HTMLElement;

      setTabLayout(testnetButton, 44, 76);
      act(() => {
        onResize?.([], {} as ResizeObserver);
      });

      expect(indicator).toHaveStyle({ left: '44px', width: '76px' });
    });
  });

  describe('Selection', () => {
    it('should mark the selected network tab as active', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'true');
    });

    it('should mark non-selected tabs as inactive', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'false');
    });

    it('should visually highlight the selected network with active text color', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-900');
    });

    it('should apply muted text to non-selected tabs', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
    });

    it('should call onNetworkChange when a different network is clicked', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      fireEvent.click(testnetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('testnet');
      expect(mockOnNetworkChange).toHaveBeenCalledTimes(1);
    });

    it('should still call onNetworkChange when clicking already selected network', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const mainnetButton = screen.getByText('Mainnet').closest('button');
      fireEvent.click(mainnetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('mainnet');
    });

    it('should handle clicking signet tab', () => {
      render(<NetworkTabs {...defaultProps} />);

      const signetButton = screen.getByText('Signet').closest('button');
      fireEvent.click(signetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('signet');
    });

    it('should block disabled networks and keep the hover guidance available', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          networkAvailability={{ mainnet: true, testnet: false, signet: true }}
        />
      );

      const testnetButton = screen.getByRole('button', { name: 'Testnet' });
      fireEvent.click(testnetButton);

      expect(testnetButton).toHaveAttribute('aria-disabled', 'true');
      expect(testnetButton).toHaveAttribute(
        'title',
        'Testnet is disabled. Enable Testnet under Node Configuration to select it.'
      );
      expect(testnetButton).toHaveClass('cursor-not-allowed', 'text-sanctuary-300');
      expect(mockOnNetworkChange).not.toHaveBeenCalled();
    });
  });

  describe('Empty states', () => {
    it('should show all networks even with no availability overrides', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet')).toBeInTheDocument();
      expect(screen.getByText('Signet')).toBeInTheDocument();
    });

    it('should apply muted styling to non-selected networks', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          selectedNetwork="mainnet"
        />
      );

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
    });
  });
});
