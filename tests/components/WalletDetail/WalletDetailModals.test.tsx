import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalletDetailModals } from '../../../components/WalletDetail/WalletDetailModals';

// Mock all modal sub-components
vi.mock('../../../components/TransactionExportModal', () => ({
  TransactionExportModal: ({ walletName }: { walletName: string }) => (
    <div data-testid="transaction-export-modal">{walletName}</div>
  ),
}));

vi.mock('../../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: ({ resourceName }: { resourceName: string }) => (
    <div data-testid="transfer-modal">{resourceName}</div>
  ),
}));

vi.mock('../../../components/WalletDetail/modals', () => ({
  DeleteModal: () => <div data-testid="delete-modal">Delete</div>,
  ReceiveModal: () => <div data-testid="receive-modal">Receive</div>,
  ExportModal: () => <div data-testid="export-modal">Export</div>,
  AddressQRModal: ({ address }: { address: string }) => (
    <div data-testid="qr-modal">{address}</div>
  ),
  DeviceSharePromptModal: ({ deviceSharePrompt }: { deviceSharePrompt: { show: boolean } }) =>
    deviceSharePrompt.show ? <div data-testid="device-share-modal">Share</div> : null,
}));

const baseProps = {
  walletId: 'wallet-1',
  walletName: 'Test Wallet',
  walletType: 'single_sig',
  walletScriptType: 'native_segwit',
  walletDescriptor: 'wpkh(...)',
  walletQuorum: null,
  walletTotalSigners: 1,
  devices: [],
  addresses: [],

  showExport: false,
  onCloseExport: vi.fn(),
  onError: vi.fn(),

  showTransactionExport: false,
  onCloseTransactionExport: vi.fn(),

  showReceive: false,
  onCloseReceive: vi.fn(),
  onNavigateToSettings: vi.fn(),
  onFetchUnusedAddresses: vi.fn(),

  qrModalAddress: null as string | null,
  onCloseQrModal: vi.fn(),

  deviceSharePrompt: { show: false, targetUserId: '', targetUsername: '', devices: [] },
  sharingLoading: false,
  onDismissDeviceSharePrompt: vi.fn(),
  onShareDevicesWithUser: vi.fn(),

  showDelete: false,
  onCloseDelete: vi.fn(),
  onConfirmDelete: vi.fn(),

  showTransferModal: false,
  onCloseTransferModal: vi.fn(),
  onTransferInitiated: vi.fn(),
};

const renderModals = (overrides: Partial<typeof baseProps> = {}) =>
  render(<WalletDetailModals {...baseProps} {...overrides} />);

describe('WalletDetailModals', () => {
  it('renders nothing when all modals are closed', () => {
    const { container } = renderModals();
    expect(container.textContent).toBe('');
  });

  it('renders ExportModal when showExport is true', () => {
    renderModals({ showExport: true });
    expect(screen.getByTestId('export-modal')).toBeInTheDocument();
  });

  it('renders TransactionExportModal when showTransactionExport is true', () => {
    renderModals({ showTransactionExport: true });
    expect(screen.getByTestId('transaction-export-modal')).toBeInTheDocument();
  });

  it('renders ReceiveModal when showReceive is true', () => {
    renderModals({ showReceive: true });
    expect(screen.getByTestId('receive-modal')).toBeInTheDocument();
  });

  it('renders AddressQRModal when qrModalAddress is set', () => {
    renderModals({ qrModalAddress: 'bc1qtest' });
    expect(screen.getByTestId('qr-modal')).toHaveTextContent('bc1qtest');
  });

  it('renders DeviceSharePromptModal when deviceSharePrompt.show is true', () => {
    renderModals({
      deviceSharePrompt: {
        show: true,
        targetUserId: 'u2',
        targetUsername: 'bob',
        devices: [],
      },
    });
    expect(screen.getByTestId('device-share-modal')).toBeInTheDocument();
  });

  it('renders DeleteModal when showDelete is true', () => {
    renderModals({ showDelete: true });
    expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
  });

  it('renders TransferOwnershipModal when showTransferModal is true', () => {
    renderModals({ showTransferModal: true });
    expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
  });

  it('does not render modals when walletId is undefined', () => {
    renderModals({
      walletId: undefined,
      showExport: true,
      showTransactionExport: true,
      showReceive: true,
      showTransferModal: true,
    });

    expect(screen.queryByTestId('export-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-export-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('receive-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transfer-modal')).not.toBeInTheDocument();
  });
});
