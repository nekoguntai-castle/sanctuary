/**
 * AddressQRModal Component Tests
 *
 * Tests for the address QR code display modal with copy functionality.
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';

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
  Copy: () => <span data-testid="copy-icon">Copy</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
}));

// Mock useCopyToClipboard
const mockCopy = vi.fn();
const mockIsCopied = vi.fn().mockReturnValue(false);

vi.mock('../../../../src/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    isCopied: mockIsCopied,
  }),
}));

// Import after mocks
import { AddressQRModal } from '../../../../src/components/WalletDetail/modals/AddressQRModal';

describe('AddressQRModal', () => {
  const testAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const defaultProps = {
    address: testAddress,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCopied.mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('should render the modal title', () => {
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByText('Address QR Code')).toBeInTheDocument();
    });

    it('should render the QR code with correct address', () => {
      render(<AddressQRModal {...defaultProps} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toBeInTheDocument();
      expect(qrCode).toHaveAttribute('data-value', testAddress);
    });

    it('should render the QR code with size 200', () => {
      render(<AddressQRModal {...defaultProps} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-size', '200');
    });

    it('should display the full address', () => {
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByText(testAddress)).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });

    it('should render copy button', () => {
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
    });

    it('should display "Full Address" label', () => {
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByText('Full Address')).toBeInTheDocument();
    });
  });

  describe('Close Functionality', () => {
    it('should call onClose when X button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<AddressQRModal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByTestId('x-icon').parentElement;
      await user.click(closeButton!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when clicking backdrop', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<AddressQRModal {...defaultProps} onClose={onClose} />);

      // Click on the backdrop (outer div)
      const backdrop = screen.getByText('Address QR Code').closest('.fixed');
      await user.click(backdrop!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when clicking modal content', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<AddressQRModal {...defaultProps} onClose={onClose} />);

      // Click on the modal content (inner div with address)
      await user.click(screen.getByText(testAddress));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Copy Functionality', () => {
    it('should call copy when copy button is clicked', async () => {
      const user = userEvent.setup();
      render(<AddressQRModal {...defaultProps} />);

      // Find the copy button by its title
      const copyButton = screen.getByTitle('Copy address');
      await user.click(copyButton);

      expect(mockCopy).toHaveBeenCalledWith(testAddress);
    });

    it('should show copy icon when not copied', () => {
      mockIsCopied.mockReturnValue(false);
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
    });

    it('should show check icon when copied', () => {
      mockIsCopied.mockReturnValue(true);
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('copy-icon')).not.toBeInTheDocument();
    });

    it('should show "Copied!" title when copied', () => {
      mockIsCopied.mockReturnValue(true);
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTitle('Copied!')).toBeInTheDocument();
    });

    it('should show "Copy address" title when not copied', () => {
      mockIsCopied.mockReturnValue(false);
      render(<AddressQRModal {...defaultProps} />);

      expect(screen.getByTitle('Copy address')).toBeInTheDocument();
    });
  });

  describe('Different Addresses', () => {
    it('should render legacy address correctly', () => {
      const legacyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
      render(<AddressQRModal address={legacyAddress} onClose={vi.fn()} />);

      expect(screen.getByText(legacyAddress)).toBeInTheDocument();
      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-value', legacyAddress);
    });

    it('should render P2SH address correctly', () => {
      const p2shAddress = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
      render(<AddressQRModal address={p2shAddress} onClose={vi.fn()} />);

      expect(screen.getByText(p2shAddress)).toBeInTheDocument();
    });

    it('should render taproot address correctly', () => {
      const taprootAddress =
        'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
      render(<AddressQRModal address={taprootAddress} onClose={vi.fn()} />);

      expect(screen.getByText(taprootAddress)).toBeInTheDocument();
    });

    it('should check isCopied with the correct address', async () => {
      const customAddress = 'bc1custom123';
      render(<AddressQRModal address={customAddress} onClose={vi.fn()} />);

      // isCopied should be called with the address
      expect(mockIsCopied).toHaveBeenCalledWith(customAddress);
    });
  });
});
