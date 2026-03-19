/**
 * ReceiveModal Component Tests
 *
 * Tests for the receive address modal with QR code display,
 * address selection, and Payjoin functionality.
 */

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Address } from '../../../../types';

// Mock QRCodeSVG
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <div data-testid="qr-code" data-value={value} data-size={size}>
      QR Code
    </div>
  ),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon">X</span>,
  RefreshCw: ({ className }: { className?: string }) => (
    <span data-testid="refresh-icon" className={className}>
      Refresh
    </span>
  ),
  Copy: () => <span data-testid="copy-icon">Copy</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
}));

// Mock Button
vi.mock('../../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button onClick={onClick} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Mock PayjoinSection
vi.mock('../../../../components/PayjoinSection', () => ({
  PayjoinSection: ({
    enabled,
    onToggle,
    className,
  }: {
    walletId: string;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
    className?: string;
  }) => (
    <div data-testid="payjoin-section" className={className}>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          data-testid="payjoin-toggle"
        />
        Payjoin
      </label>
    </div>
  ),
}));

// Mock useCopyToClipboard
const mockCopy = vi.fn();
const mockIsCopied = vi.fn().mockReturnValue(false);

vi.mock('../../../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    isCopied: mockIsCopied,
  }),
}));

// Mock payjoin API
vi.mock('../../../../src/api/payjoin', () => ({
  getPayjoinStatus: vi.fn().mockResolvedValue({
    enabled: true,
    configured: true,
  }),
  getPayjoinUri: vi.fn().mockResolvedValue({
    uri: 'bitcoin:bc1qtest?pj=https://payjoin.example.com',
    address: 'bc1qtest',
    payjoinUrl: 'https://payjoin.example.com',
  }),
}));

// Mock logger
vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { ReceiveModal } from '../../../../components/WalletDetail/modals/ReceiveModal';
import * as payjoinApi from '../../../../src/api/payjoin';

// Test data
const mockAddresses: Address[] = [
  {
    id: 'addr-1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    derivationPath: "m/84'/0'/0'/0/0",
    index: 0,
    balance: 0,
    isChange: false,
    used: false,
  },
  {
    id: 'addr-2',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    derivationPath: "m/84'/0'/0'/0/1",
    index: 1,
    balance: 0,
    isChange: false,
    used: false,
  },
  {
    id: 'addr-3',
    address: 'bc1qchange123',
    derivationPath: "m/84'/0'/0'/1/0",
    index: 0,
    balance: 0,
    isChange: true,
    used: false,
  },
  {
    id: 'addr-4',
    address: 'bc1qusedaddress',
    derivationPath: "m/84'/0'/0'/0/2",
    index: 2,
    balance: 0,
    isChange: false,
    used: true,
  },
];

describe('ReceiveModal', () => {
  const defaultProps = {
    walletId: 'wallet-123',
    addresses: mockAddresses,
    network: 'mainnet',
    onClose: vi.fn(),
    onNavigateToSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCopied.mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('should render the modal title', () => {
      render(<ReceiveModal {...defaultProps} />);

      expect(screen.getByText('Receive Bitcoin')).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(<ReceiveModal {...defaultProps} />);

      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });

    it('should render QR code with first unused receive address', () => {
      render(<ReceiveModal {...defaultProps} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toBeInTheDocument();
      expect(qrCode).toHaveAttribute(
        'data-value',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });

    it('should display the receive address', () => {
      render(<ReceiveModal {...defaultProps} />);

      expect(
        screen.getByText('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')
      ).toBeInTheDocument();
    });

    it('should render copy button', () => {
      render(<ReceiveModal {...defaultProps} />);

      expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
    });

    it('should render Payjoin section when feature is enabled and configured', async () => {
      render(<ReceiveModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('payjoin-section')).toBeInTheDocument();
      });
    });

    it('should not render Payjoin section when feature is disabled', async () => {
      vi.mocked(payjoinApi.getPayjoinStatus).mockResolvedValueOnce({
        enabled: false,
        configured: true,
      });
      render(<ReceiveModal {...defaultProps} />);

      // Wait for async check to complete, then verify it's not shown
      await waitFor(() => {
        expect(screen.queryByTestId('payjoin-section')).not.toBeInTheDocument();
      });
    });

    it('should not render Payjoin section when status check fails', async () => {
      vi.mocked(payjoinApi.getPayjoinStatus).mockRejectedValueOnce(new Error('network error'));
      render(<ReceiveModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByTestId('payjoin-section')).not.toBeInTheDocument();
      });
    });

    it('should not render Payjoin section when URL is not configured', async () => {
      vi.mocked(payjoinApi.getPayjoinStatus).mockResolvedValueOnce({
        enabled: true,
        configured: false,
      });
      render(<ReceiveModal {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByTestId('payjoin-section')).not.toBeInTheDocument();
      });
    });

    it('should show Bitcoin-only warning message', () => {
      render(<ReceiveModal {...defaultProps} />);

      expect(
        screen.getByText('Send only Bitcoin (BTC) to this address.')
      ).toBeInTheDocument();
    });
  });

  describe('Address Filtering', () => {
    it('should only show unused receive addresses (not change, not used)', () => {
      render(<ReceiveModal {...defaultProps} />);

      // The first unused receive address should be shown
      expect(
        screen.getByText('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')
      ).toBeInTheDocument();

      // Change addresses should not be selectable
      expect(screen.queryByText('bc1qchange123')).not.toBeInTheDocument();

      // Used addresses should not be selectable
      expect(screen.queryByText('bc1qusedaddress')).not.toBeInTheDocument();
    });
  });

  describe('Address Selector', () => {
    it('should show address selector when multiple unused addresses exist', () => {
      render(<ReceiveModal {...defaultProps} />);

      // With 2 unused receive addresses, selector should show
      expect(screen.getByText(/2 unused/)).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should not show address selector when only one unused address', () => {
      const singleAddressProps = {
        ...defaultProps,
        addresses: [mockAddresses[0]], // Only one unused receive address
      };

      render(<ReceiveModal {...singleAddressProps} />);

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('should update displayed address when selection changes', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      const selector = screen.getByRole('combobox');
      await user.selectOptions(selector, 'addr-2');

      // QR code should update to second address
      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute(
        'data-value',
        'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
      );
    });

    it('resets selected address to first unused when selection is cleared', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      const selector = screen.getByRole('combobox');
      await user.selectOptions(selector, 'addr-2');
      fireEvent.change(selector, { target: { value: '' } });

      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });

    it('handles unknown selected address ids by falling back to first unused address', async () => {
      render(<ReceiveModal {...defaultProps} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unknown-id' } });

      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });

    it('falls back to first unused address when previously selected address disappears', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<ReceiveModal {...defaultProps} />);

      await user.selectOptions(screen.getByRole('combobox'), 'addr-2');
      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
      );

      rerender(
        <ReceiveModal
          {...defaultProps}
          addresses={[
            mockAddresses[0],
            {
              id: 'addr-9',
              address: 'bc1qnewaddress999',
              derivationPath: "m/84'/0'/0'/0/9",
              index: 9,
              balance: 0,
              isChange: false,
              used: false,
            },
          ]}
        />
      );

      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });
  });

  describe('Close Functionality', () => {
    it('should call onClose when X button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ReceiveModal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByTestId('x-icon').parentElement;
      await user.click(closeButton!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when clicking backdrop', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ReceiveModal {...defaultProps} onClose={onClose} />);

      // Click on the backdrop
      const backdrop = screen.getByText('Receive Bitcoin').closest('.fixed');
      await user.click(backdrop!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when clicking modal content', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ReceiveModal {...defaultProps} onClose={onClose} />);

      // Click on the QR code (inside modal)
      await user.click(screen.getByTestId('qr-code'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Copy Functionality', () => {
    it('should call copy with address when copy button is clicked', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      const copyButton = screen.getByTitle('Copy');
      await user.click(copyButton);

      expect(mockCopy).toHaveBeenCalledWith(
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });

    it('should show check icon when copied', () => {
      mockIsCopied.mockReturnValue(true);
      render(<ReceiveModal {...defaultProps} />);

      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no addresses', () => {
      render(<ReceiveModal {...defaultProps} addresses={[]} />);

      expect(
        screen.getByText(/no receive address available/i)
      ).toBeInTheDocument();
    });

    it('should show Go to Settings button in empty state', () => {
      render(<ReceiveModal {...defaultProps} addresses={[]} />);

      expect(
        screen.getByRole('button', { name: /go to settings/i })
      ).toBeInTheDocument();
    });

    it('should call onNavigateToSettings when button clicked in empty state', async () => {
      const user = userEvent.setup();
      const onNavigateToSettings = vi.fn();
      const onClose = vi.fn();
      render(
        <ReceiveModal
          {...defaultProps}
          addresses={[]}
          onNavigateToSettings={onNavigateToSettings}
          onClose={onClose}
        />
      );

      const button = screen.getByRole('button', { name: /go to settings/i });
      await user.click(button);

      expect(onClose).toHaveBeenCalled();
      expect(onNavigateToSettings).toHaveBeenCalled();
    });
  });

  describe('Payjoin Toggle', () => {
    it('should have Payjoin disabled by default', async () => {
      render(<ReceiveModal {...defaultProps} />);

      const toggle = await screen.findByTestId('payjoin-toggle');
      expect(toggle).not.toBeChecked();
    });

    it('should show amount input when Payjoin is enabled', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      const toggle = await screen.findByTestId('payjoin-toggle');
      await user.click(toggle);

      // Amount input should appear
      expect(screen.getByPlaceholderText('0.00000000')).toBeInTheDocument();
      expect(screen.getByText('Amount (optional)')).toBeInTheDocument();
    });

    it('should update label to BIP21 URI when Payjoin enabled', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      // Initially shows "Receive Address"
      expect(screen.getByText('Receive Address')).toBeInTheDocument();

      const toggle = await screen.findByTestId('payjoin-toggle');
      await user.click(toggle);

      // Now shows BIP21 URI label
      await waitFor(() => {
        expect(
          screen.getByText('BIP21 URI (with Payjoin)')
        ).toBeInTheDocument();
      });
    });

    it('should show Payjoin message when enabled', async () => {
      const user = userEvent.setup();
      render(<ReceiveModal {...defaultProps} />);

      const toggle = await screen.findByTestId('payjoin-toggle');
      await user.click(toggle);

      await waitFor(() => {
        expect(
          screen.getByText(/share this uri with a payjoin-capable wallet/i)
        ).toBeInTheDocument();
      });
    });

    it('generates a Payjoin URI with parsed amount input', async () => {
      const user = userEvent.setup();
      const getPayjoinUriMock = vi.mocked(payjoinApi.getPayjoinUri);
      getPayjoinUriMock.mockResolvedValue({
        uri: 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?pj=https://payjoin.example.com',
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        payjoinUrl: 'https://payjoin.example.com',
      });

      render(<ReceiveModal {...defaultProps} />);

      await user.click(await screen.findByTestId('payjoin-toggle'));
      await user.type(screen.getByPlaceholderText('0.00000000'), '0.12345678');

      await waitFor(() => {
        expect(getPayjoinUriMock).toHaveBeenCalled();
      });

      const lastCall = getPayjoinUriMock.mock.calls.at(-1);
      expect(lastCall).toEqual([
        'addr-1',
        { amount: 12345678 },
      ]);
    });

    it('falls back to .address when selectedReceiveAddress has no id', async () => {
      const user = userEvent.setup();
      const getPayjoinUriMock = vi.mocked(payjoinApi.getPayjoinUri);
      getPayjoinUriMock.mockResolvedValue({
        uri: 'bitcoin:bc1qnoid?pj=https://payjoin.example.com',
        address: 'bc1qnoid',
        payjoinUrl: 'https://payjoin.example.com',
      });

      // Address without id property — exercises the ?? fallback on line 79
      const addressesWithoutId: Address[] = [
        {
          address: 'bc1qnoid',
          derivationPath: "m/84'/0'/0'/0/0",
          index: 0,
          balance: 0,
          isChange: false,
          used: false,
        },
      ];

      render(
        <ReceiveModal
          {...defaultProps}
          addresses={addressesWithoutId}
        />
      );

      await user.click(await screen.findByTestId('payjoin-toggle'));

      await waitFor(() => {
        expect(getPayjoinUriMock).toHaveBeenCalled();
      });

      // Should fall back to using .address since .id is undefined
      const lastCall = getPayjoinUriMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('bc1qnoid');
    });

    it('falls back to receive address when Payjoin URI generation fails', async () => {
      const user = userEvent.setup();
      const getPayjoinUriMock = vi.mocked(payjoinApi.getPayjoinUri);
      getPayjoinUriMock.mockRejectedValueOnce(new Error('payjoin unavailable'));

      render(<ReceiveModal {...defaultProps} />);
      await user.click(await screen.findByTestId('payjoin-toggle'));

      await waitFor(() => {
        expect(getPayjoinUriMock).toHaveBeenCalled();
      });

      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
      );
    });
  });

  describe('All Used Addresses', () => {
    it('should show empty state when all addresses are used or change', () => {
      const usedAddresses: Address[] = [
        {
          id: 'addr-1',
          address: 'bc1qused1',
          derivationPath: "m/84'/0'/0'/0/0",
          index: 0,
          balance: 0,
          isChange: false,
          used: true,
        },
        {
          id: 'addr-2',
          address: 'bc1qchange',
          derivationPath: "m/84'/0'/0'/1/0",
          index: 0,
          balance: 0,
          isChange: true,
          used: false,
        },
      ];

      render(<ReceiveModal {...defaultProps} addresses={usedAddresses} />);

      expect(
        screen.getByText(/no receive address available/i)
      ).toBeInTheDocument();
    });
  });
});
