/**
 * ExportModal Component Tests
 *
 * Tests for the wallet export modal with multiple export formats:
 * QR Code, JSON, Descriptor, Labels, and Device formats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

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
  QrCode: () => <span data-testid="qr-icon">QR</span>,
  FileJson: () => <span data-testid="json-icon">JSON</span>,
  FileText: () => <span data-testid="text-icon">Text</span>,
  Tag: () => <span data-testid="tag-icon">Tag</span>,
  HardDrive: () => <span data-testid="device-icon">Device</span>,
  Download: () => <span data-testid="download-icon">Download</span>,
  Copy: () => <span data-testid="copy-icon">Copy</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
}));

// Mock Button
vi.mock('../../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    className?: string;
  }) => (
    <button onClick={onClick} data-variant={variant} className={className}>
      {children}
    </button>
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

// Mock wallets API
const mockExportWallet = vi.fn();
const mockExportLabelsBip329 = vi.fn();
const mockExportWalletFormat = vi.fn();
const mockGetExportFormats = vi.fn();

vi.mock('../../../../src/api/wallets', () => ({
  exportWallet: (...args: unknown[]) => mockExportWallet(...args),
  exportLabelsBip329: (...args: unknown[]) => mockExportLabelsBip329(...args),
  exportWalletFormat: (...args: unknown[]) => mockExportWalletFormat(...args),
  getExportFormats: (...args: unknown[]) => mockGetExportFormats(...args),
}));

// Mock types
vi.mock('../../../../types', () => ({
  isMultisigType: (type: string) => type.includes('multisig'),
  getQuorumM: (quorum: number | null) => quorum ?? 2,
  getQuorumN: (quorum: number | null, total: number | null) => total ?? 3,
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
import {
  ExportModal,
  generateMultisigConfigText,
} from '../../../../components/WalletDetail/modals/ExportModal';

describe('ExportModal', () => {
  const singleSigProps = {
    walletId: 'wallet-123',
    walletName: 'My Wallet',
    walletType: 'single_sig',
    scriptType: 'native_segwit',
    descriptor: 'wpkh([12345678/84h/0h/0h]xpub...)#checksum',
    quorum: null,
    totalSigners: null,
    devices: [],
    onClose: vi.fn(),
    onError: vi.fn(),
  };

  const multisigProps = {
    ...singleSigProps,
    walletId: 'multisig-wallet-456',
    walletName: 'Multisig Vault',
    walletType: 'multisig_2_of_3',
    descriptor: 'wsh(sortedmulti(2,[fp1]xpub1,[fp2]xpub2,[fp3]xpub3))#check',
    quorum: 2,
    totalSigners: 3,
    devices: [
      { fingerprint: 'AAAA1111', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub1...' },
      { fingerprint: 'BBBB2222', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub2...' },
      { fingerprint: 'CCCC3333', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub3...' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCopied.mockReturnValue(false);
    mockGetExportFormats.mockResolvedValue([
      { id: 'coldcard', name: 'Coldcard', extension: '.txt' },
      { id: 'passport', name: 'Passport', extension: '.json' },
    ]);
  });

  describe('Rendering', () => {
    it('should render the modal title', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(screen.getByText('Export Wallet')).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });

    it('should render export tabs', () => {
      render(<ExportModal {...singleSigProps} />);

      // These may appear multiple times (in tab and content), so use getAllByText
      expect(screen.getAllByText('QR Code').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('JSON File').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Descriptor').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Labels').length).toBeGreaterThanOrEqual(1);
    });

    it('should show Close button at bottom', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
  });

  describe('QR Tab', () => {
    it('should be active by default', () => {
      render(<ExportModal {...singleSigProps} />);

      // QR code should be visible
      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    it('should display QR code with descriptor value', () => {
      render(<ExportModal {...singleSigProps} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-value', singleSigProps.descriptor);
    });

    it('should display QR size slider', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(screen.getByText('QR Code Size')).toBeInTheDocument();
      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('should update QR size when slider changes', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      const slider = screen.getByRole('slider');
      // Slider default is 280, let's change it
      await user.click(slider); // Focus

      // Check that size text is displayed
      expect(screen.getByText('280px')).toBeInTheDocument();
    });

    it('updates QR size label and QR component size when slider value changes', () => {
      render(<ExportModal {...singleSigProps} />);

      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '320' } });

      expect(screen.getByText('320px')).toBeInTheDocument();
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-size', '320');
    });

    it('can switch away from and back to QR tab', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('JSON File'));
      await user.click(screen.getByText('QR Code'));

      expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    });

    it('should show scan message for single sig', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(
        screen.getByText('Scan to import into another device')
      ).toBeInTheDocument();
    });
  });

  describe('QR Tab - Multisig', () => {
    it('should show format selector for multisig with devices', () => {
      render(<ExportModal {...multisigProps} />);

      expect(screen.getByText('Passport/Coldcard')).toBeInTheDocument();
      expect(screen.getByText('Raw Descriptor')).toBeInTheDocument();
    });

    it('should not show format selector for single sig', () => {
      render(<ExportModal {...singleSigProps} />);

      expect(screen.queryByText('Passport/Coldcard')).not.toBeInTheDocument();
      expect(screen.queryByText('Raw Descriptor')).not.toBeInTheDocument();
    });

    it('should use Passport format by default for multisig', () => {
      render(<ExportModal {...multisigProps} />);

      expect(
        screen.getByText('Coldcard/Passport compatible format')
      ).toBeInTheDocument();
    });

    it('should switch to descriptor format when clicked', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...multisigProps} />);

      const descriptorButton = screen.getByText('Raw Descriptor');
      await user.click(descriptorButton);

      // Now should show the scan message instead of Passport message
      expect(
        screen.getByText('Scan to import into another device')
      ).toBeInTheDocument();
    });

    it('switches back to Passport format after selecting descriptor', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...multisigProps} />);

      await user.click(screen.getByText('Raw Descriptor'));
      await user.click(screen.getByText('Passport/Coldcard'));

      expect(
        screen.getByText('Coldcard/Passport compatible format')
      ).toBeInTheDocument();
    });

    it('should generate Passport config text with device info', () => {
      render(<ExportModal {...multisigProps} />);

      const qrCode = screen.getByTestId('qr-code');
      const value = qrCode.getAttribute('data-value');

      // Should contain the multisig config text
      expect(value).toContain('Name: Multisig Vault');
      expect(value).toContain('Policy: 2 of 3');
      expect(value).toContain('Format: P2WSH');
    });

    it('shows descriptor fallback note when multisig has no devices in passport mode', () => {
      render(
        <ExportModal
          {...multisigProps}
          devices={[]}
          descriptor="wsh(sortedmulti(2,[fp]xpub))#desc"
        />
      );

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-value', 'wsh(sortedmulti(2,[fp]xpub))#desc');
      expect(
        screen.getByText('Note: No devices found. Using raw descriptor format instead.')
      ).toBeInTheDocument();
    });

    it('falls back to default format text for unknown script type and missing device fields', () => {
      render(
        <ExportModal
          {...multisigProps}
          scriptType="unknown_script"
          devices={[
            { fingerprint: 'c0ffee01' },
            { fingerprint: 'aabbccdd' },
          ]}
        />
      );

      const qrCode = screen.getByTestId('qr-code');
      const value = qrCode.getAttribute('data-value') || '';
      expect(value).toContain('Format: P2WSH');
      expect(value).toContain('Derivation:');
      expect(value).toContain('AABBCCDD:');
      expect(value).toContain('C0FFEE01:');
    });

    it('uses default signer count and script type when multisig total/signing config is missing', () => {
      render(
        <ExportModal
          {...multisigProps}
          scriptType={undefined}
          totalSigners={undefined}
          devices={[{ fingerprint: 'deadbeef', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpubz' }]}
        />
      );

      const qrCode = screen.getByTestId('qr-code');
      const value = qrCode.getAttribute('data-value') || '';
      expect(value).toContain('Policy: 2 of 3');
      expect(value).toContain('Format: P2WSH');
    });

    it('generateMultisigConfigText omits derivation section when no devices are provided', () => {
      const text = generateMultisigConfigText('No Device Wallet', 2, 3, 'native_segwit', []);
      expect(text).toContain('Name: No Device Wallet');
      expect(text).toContain('Policy: 2 of 3');
      expect(text).not.toContain('Derivation:');
    });
  });

  describe('JSON Tab', () => {
    it('should switch to JSON tab when clicked', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      const jsonTab = screen.getByText('JSON File');
      await user.click(jsonTab);

      expect(
        screen.getByText(/download the full wallet backup in json format/i)
      ).toBeInTheDocument();
    });

    it('should render download button', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('JSON File'));

      expect(
        screen.getByRole('button', { name: /download backup/i })
      ).toBeInTheDocument();
    });

    it('should call exportWallet when download clicked', async () => {
      const user = userEvent.setup();
      mockExportWallet.mockResolvedValue(undefined);
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('JSON File'));
      await user.click(screen.getByRole('button', { name: /download backup/i }));

      expect(mockExportWallet).toHaveBeenCalledWith('wallet-123', 'My Wallet');
    });

    it('should call onError when export fails', async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      mockExportWallet.mockRejectedValue(new Error('Export failed'));

      render(<ExportModal {...singleSigProps} onError={onError} />);

      await user.click(screen.getByText('JSON File'));
      await user.click(screen.getByRole('button', { name: /download backup/i }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
    });
  });

  describe('Descriptor Tab', () => {
    it('should switch to descriptor tab when clicked', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Descriptor'));

      expect(screen.getByText('Output Descriptor')).toBeInTheDocument();
    });

    it('should display descriptor in textarea', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Descriptor'));

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue(singleSigProps.descriptor);
    });

    it('should have readonly textarea', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Descriptor'));

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('readonly');
    });

    it('should call copy when button clicked', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Descriptor'));
      await user.click(screen.getByRole('button', { name: /copy to clipboard/i }));

      expect(mockCopy).toHaveBeenCalledWith(singleSigProps.descriptor);
    });

    it('should show Copied! when isCopied returns true', async () => {
      const user = userEvent.setup();
      mockIsCopied.mockReturnValue(true);

      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Descriptor'));

      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    it('uses empty descriptor fallback for textarea/copy state when descriptor is missing', async () => {
      const user = userEvent.setup();
      mockIsCopied.mockImplementation((value: string) => value === '');

      render(<ExportModal {...singleSigProps} descriptor={undefined} />);

      await user.click(screen.getByText('Descriptor'));

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('');
      expect(screen.getByText('Copied!')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /copied/i }));
      expect(mockCopy).toHaveBeenCalledWith('');
    });
  });

  describe('Labels Tab', () => {
    it('should switch to labels tab when clicked', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Labels'));

      expect(screen.getByText(/export wallet labels in bip 329 format/i)).toBeInTheDocument();
    });

    it('should render download labels button', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Labels'));

      expect(
        screen.getByRole('button', { name: /download labels/i })
      ).toBeInTheDocument();
    });

    it('should call exportLabelsBip329 when download clicked', async () => {
      const user = userEvent.setup();
      mockExportLabelsBip329.mockResolvedValue(undefined);

      render(<ExportModal {...singleSigProps} />);

      await user.click(screen.getByText('Labels'));
      await user.click(screen.getByRole('button', { name: /download labels/i }));

      expect(mockExportLabelsBip329).toHaveBeenCalledWith('wallet-123', 'My Wallet');
    });

    it('should call onError when labels export fails', async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      mockExportLabelsBip329.mockRejectedValue(new Error('labels failed'));

      render(<ExportModal {...singleSigProps} onError={onError} />);

      await user.click(screen.getByText('Labels'));
      await user.click(screen.getByRole('button', { name: /download labels/i }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'Export Labels Failed');
      });
    });
  });

  describe('Device Tab (Multisig Only)', () => {
    // Helper to get the Device tab button
    const getDeviceTab = () => {
      // The Device tab is in the tab bar area, get the last button in the tab row
      const tabButtons = screen.getAllByRole('button');
      // Device tab contains the device icon
      return tabButtons.find(
        (btn) => btn.textContent?.includes('Device') && btn.querySelector('[data-testid="device-icon"]')
      );
    };

    it('should not show device tab for single sig', () => {
      render(<ExportModal {...singleSigProps} />);

      // For single sig, Device tab should not exist in the tab bar
      const deviceTab = getDeviceTab();
      expect(deviceTab).toBeUndefined();
    });

    it('should show device tab for multisig', () => {
      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      expect(deviceTab).toBeDefined();
    });

    it('should fetch export formats when device tab selected', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(mockGetExportFormats).toHaveBeenCalledWith('multisig-wallet-456');
      });
    });

    it('should display loading state while fetching formats', async () => {
      const user = userEvent.setup();
      mockGetExportFormats.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );

      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      expect(screen.getByText(/loading export formats/i)).toBeInTheDocument();
    });

    it('should display export format buttons', async () => {
      const user = userEvent.setup();
      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(screen.getByText('Coldcard')).toBeInTheDocument();
        // Passport appears in both tab and format list, use getAllByText
        expect(screen.getAllByText('Passport').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should call exportWalletFormat when format button clicked', async () => {
      const user = userEvent.setup();
      mockExportWalletFormat.mockResolvedValue(undefined);

      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(screen.getByText('Coldcard')).toBeInTheDocument();
      });

      // Click the Coldcard format button (in the content area, not the tab)
      const coldcardButton = screen.getByRole('button', { name: /coldcard.*\.txt/i });
      await user.click(coldcardButton);

      expect(mockExportWalletFormat).toHaveBeenCalledWith(
        'multisig-wallet-456',
        'coldcard',
        'Multisig Vault'
      );
    });

    it('calls onError when exporting a device format fails', async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      mockExportWalletFormat.mockRejectedValue(new Error('device format failed'));

      render(<ExportModal {...multisigProps} onError={onError} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(screen.getByText('Coldcard')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /coldcard.*\.txt/i }));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'Export Failed');
      });
    });

    it('should show empty state when no formats available', async () => {
      const user = userEvent.setup();
      mockGetExportFormats.mockResolvedValue([]);

      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(
          screen.getByText(/no device export formats available/i)
        ).toBeInTheDocument();
      });
    });

    it('falls back to empty device format list when fetching formats fails', async () => {
      const user = userEvent.setup();
      mockGetExportFormats.mockRejectedValue(new Error('formats unavailable'));

      render(<ExportModal {...multisigProps} />);

      const deviceTab = getDeviceTab();
      await user.click(deviceTab!);

      await waitFor(() => {
        expect(
          screen.getByText(/no device export formats available/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Close Functionality', () => {
    it('should call onClose when X button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<ExportModal {...singleSigProps} onClose={onClose} />);

      await user.click(screen.getByTestId('x-icon').parentElement!);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<ExportModal {...singleSigProps} onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /close/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
