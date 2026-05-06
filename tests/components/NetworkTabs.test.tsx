import { act,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkTabs,TabNetwork } from '../../components/NetworkTabs';

const originalDocumentFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

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
    if (originalDocumentFonts) {
      Object.defineProperty(document, 'fonts', originalDocumentFonts);
    } else {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: undefined,
      });
    }
  });

  describe('Rendering', () => {
    it('should render all four network tabs', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet3')).toBeInTheDocument();
      expect(screen.getByText('Testnet4')).toBeInTheDocument();
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
      expect(dots).toHaveLength(4);
      expect(dots[0]).toHaveClass('bg-mainnet-500');
      expect(dots[1]).toHaveClass('bg-testnet-500');
      expect(dots[2]).toHaveClass('bg-testnet-500');
      expect(dots[3]).toHaveClass('bg-signet-500');
    });

    it('should render a sliding indicator element', () => {
      const { container } = render(<NetworkTabs {...defaultProps} />);

      const indicator = container.querySelector('.shadow-sm');
      expect(indicator).toBeInTheDocument();
    });

    it('should remeasure initially selected Testnet4 after the tab strip settles', () => {
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
        <NetworkTabs {...defaultProps} selectedNetwork="testnet4" fullWidth />
      );
      const testnetButton = screen.getByRole('button', { name: 'Testnet4' });
      const indicator = container.querySelector('.shadow-sm') as HTMLElement;

      setTabLayout(testnetButton, 44, 76);
      act(() => {
        onResize?.([], {} as ResizeObserver);
      });

      expect(indicator).toHaveStyle({ left: '44px', width: '76px' });
    });

    it('measures synchronously when animation frames and resize observers are unavailable', () => {
      vi.stubGlobal('requestAnimationFrame', undefined);
      vi.stubGlobal('cancelAnimationFrame', undefined);
      vi.stubGlobal('ResizeObserver', undefined);

      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Mainnet' })).toHaveAttribute('data-active', 'true');
    });

    it('ignores measurement when no active tab exists', () => {
      const { container } = render(
        <NetworkTabs {...defaultProps} selectedNetwork={'regtest' as TabNetwork} />
      );

      const indicator = container.querySelector('.shadow-sm') as HTMLElement;
      expect(indicator).toHaveStyle({ left: '0px', width: '0px' });
    });

    it('cancels pending animation frames before remeasure and unmount', () => {
      let frameId = 10;
      const cancelAnimationFrame = vi.fn();
      vi.stubGlobal('requestAnimationFrame', vi.fn(() => frameId++));
      vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

      const { rerender, unmount } = render(<NetworkTabs {...defaultProps} />);

      rerender(<NetworkTabs {...defaultProps} selectedNetwork="testnet3" />);
      unmount();

      expect(cancelAnimationFrame).toHaveBeenCalledWith(10);
      expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
    });

    it('remeasures after fonts settle only while mounted', async () => {
      let resolveFontsReady!: () => void;
      const fontsReady = new Promise<void>((resolve) => {
        resolveFontsReady = resolve;
      });
      const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return requestAnimationFrame.mock.calls.length;
      });
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: fontsReady },
      });
      vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      render(<NetworkTabs {...defaultProps} />);
      const initialFrameCount = requestAnimationFrame.mock.calls.length;

      await act(async () => {
        resolveFontsReady();
        await fontsReady;
      });

      expect(requestAnimationFrame.mock.calls.length).toBeGreaterThan(initialFrameCount);
    });

    it('does not remeasure when fonts settle after unmount', async () => {
      let resolveFontsReady!: () => void;
      const fontsReady = new Promise<void>((resolve) => {
        resolveFontsReady = resolve;
      });
      const requestAnimationFrame = vi.fn(() => 1);
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: fontsReady },
      });
      vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const { unmount } = render(<NetworkTabs {...defaultProps} />);
      const initialFrameCount = requestAnimationFrame.mock.calls.length;
      unmount();

      await act(async () => {
        resolveFontsReady();
        await fontsReady;
      });

      expect(requestAnimationFrame).toHaveBeenCalledTimes(initialFrameCount);
    });
  });

  describe('Selection', () => {
    it('should mark the selected network tab as active', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet3" />);

      const testnetButton = screen.getByText('Testnet3').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'true');
    });

    it('should mark non-selected tabs as inactive', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet3').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'false');
    });

    it('should visually highlight the selected network with active text color', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet3" />);

      const testnetButton = screen.getByText('Testnet3').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-900');
    });

    it('should apply muted text to non-selected tabs', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet3').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
    });

    it('should call onNetworkChange when a different network is clicked', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet4').closest('button');
      fireEvent.click(testnetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('testnet4');
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
          networkAvailability={{ mainnet: true, testnet3: true, testnet4: false, signet: true }}
        />
      );

      const testnetButton = screen.getByRole('button', { name: 'Testnet4' });
      fireEvent.click(testnetButton);

      expect(testnetButton).toHaveAttribute('aria-disabled', 'true');
      expect(testnetButton).toHaveAttribute(
        'title',
        'Testnet4 is disabled. Enable Testnet4 under Node Configuration to select it.'
      );
      expect(testnetButton).toHaveClass('cursor-not-allowed', 'text-sanctuary-300');
      expect(mockOnNetworkChange).not.toHaveBeenCalled();
    });
  });

  describe('Empty states', () => {
    it('should show all networks even with no availability overrides', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet3')).toBeInTheDocument();
      expect(screen.getByText('Testnet4')).toBeInTheDocument();
      expect(screen.getByText('Signet')).toBeInTheDocument();
    });

    it('should apply muted styling to non-selected networks', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          selectedNetwork="mainnet"
        />
      );

      const testnetButton = screen.getByText('Testnet3').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
    });
  });
});
