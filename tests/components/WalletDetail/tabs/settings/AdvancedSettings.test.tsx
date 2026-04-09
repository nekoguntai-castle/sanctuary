import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdvancedSettings } from '../../../../../components/WalletDetail/tabs/settings/AdvancedSettings';
import { WalletType } from '../../../../../types';

const baseWallet = {
  id: 'wallet-1',
  name: 'Main Wallet',
  type: WalletType.SINGLE_SIG,
  scriptType: 'native_segwit',
  balance: 100_000,
  descriptor: '[aabb1122/84h/0h/0h]xpub...',
  quorum: null,
  userRole: 'owner',
  lastSyncedAt: '2026-03-01T12:00:00.000Z',
} as any;

const defaultProps = {
  wallet: baseWallet,
  syncing: false,
  onSync: vi.fn(),
  onFullResync: vi.fn(),
  repairing: false,
  onRepairWallet: vi.fn(),
  showDangerZone: false,
  onSetShowDangerZone: vi.fn(),
  onShowDelete: vi.fn(),
  onShowExport: vi.fn(),
};

const renderComponent = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<AdvancedSettings {...defaultProps} {...overrides} />);

describe('AdvancedSettings', () => {
  it('renders technical details section', () => {
    renderComponent();

    expect(screen.getByText('Technical Details')).toBeInTheDocument();
    expect(screen.getByText('wallet-1')).toBeInTheDocument();
    expect(screen.getByText('Native SegWit')).toBeInTheDocument();
  });

  it('renders all four script type labels correctly', () => {
    const { rerender } = render(
      <AdvancedSettings {...defaultProps} wallet={{ ...baseWallet, scriptType: 'nested_segwit' }} />,
    );
    expect(screen.getByText('Nested SegWit')).toBeInTheDocument();

    rerender(<AdvancedSettings {...defaultProps} wallet={{ ...baseWallet, scriptType: 'taproot' }} />);
    expect(screen.getByText('Taproot')).toBeInTheDocument();

    rerender(<AdvancedSettings {...defaultProps} wallet={{ ...baseWallet, scriptType: 'legacy' }} />);
    expect(screen.getByText('Legacy')).toBeInTheDocument();

    rerender(<AdvancedSettings {...defaultProps} wallet={{ ...baseWallet, scriptType: undefined }} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('renders derivation path from descriptor', () => {
    renderComponent();
    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
  });

  it('renders sync options with sync and resync buttons', () => {
    renderComponent();

    expect(screen.getByText('Sync Options')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resync' })).toBeInTheDocument();
  });

  it('disables sync buttons while syncing', () => {
    renderComponent({ syncing: true });

    const syncingButtons = screen.getAllByRole('button', { name: 'Syncing...' });
    expect(syncingButtons).toHaveLength(2);
    syncingButtons.forEach(btn => expect(btn).toBeDisabled());
  });

  it('calls onSync when Sync button is clicked', () => {
    const onSync = vi.fn();
    renderComponent({ onSync });

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('calls onFullResync when Resync button is clicked', () => {
    const onFullResync = vi.fn();
    renderComponent({ onFullResync });

    fireEvent.click(screen.getByRole('button', { name: 'Resync' }));
    expect(onFullResync).toHaveBeenCalledTimes(1);
  });

  it('renders export section with Export button', () => {
    renderComponent();

    expect(screen.getByText('Export Wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
  });

  it('calls onShowExport when export button is clicked', () => {
    const onShowExport = vi.fn();
    renderComponent({ onShowExport });

    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(onShowExport).toHaveBeenCalledTimes(1);
  });

  it('renders danger zone toggle for owner', () => {
    renderComponent();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  it('hides danger zone for non-owner', () => {
    renderComponent({ wallet: { ...baseWallet, userRole: 'viewer' } });
    expect(screen.queryByText('Danger Zone')).not.toBeInTheDocument();
  });

  it('toggles danger zone visibility', () => {
    const onSetShowDangerZone = vi.fn();
    renderComponent({ onSetShowDangerZone });

    fireEvent.click(screen.getByText('Danger Zone'));
    expect(onSetShowDangerZone).toHaveBeenCalledWith(true);
  });

  it('shows delete button when danger zone is open', () => {
    renderComponent({ showDangerZone: true });

    expect(screen.getByText('Delete Wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onShowDelete when delete button is clicked', () => {
    const onShowDelete = vi.fn();
    renderComponent({ showDangerZone: true, onShowDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onShowDelete).toHaveBeenCalledTimes(1);
  });

  it('shows troubleshooting when wallet has no descriptor and user is owner', () => {
    renderComponent({
      wallet: { ...baseWallet, descriptor: undefined },
    });

    expect(screen.getByText('Troubleshooting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repair' })).toBeInTheDocument();
  });

  it('hides troubleshooting when wallet has descriptor', () => {
    renderComponent();
    expect(screen.queryByText('Troubleshooting')).not.toBeInTheDocument();
  });

  it('calls onRepairWallet when repair button is clicked', () => {
    const onRepairWallet = vi.fn();
    renderComponent({
      wallet: { ...baseWallet, descriptor: undefined },
      onRepairWallet,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
    expect(onRepairWallet).toHaveBeenCalledTimes(1);
  });

  it('shows repairing state', () => {
    renderComponent({
      wallet: { ...baseWallet, descriptor: undefined },
      repairing: true,
    });

    expect(screen.getByRole('button', { name: 'Repairing...' })).toBeDisabled();
  });

  it('shows quorum info for multisig wallets', () => {
    renderComponent({
      wallet: { ...baseWallet, type: WalletType.MULTI_SIG, quorum: { m: 2, n: 3 }, totalSigners: 3 },
    });

    expect(screen.getByText('Quorum')).toBeInTheDocument();
  });

  it('shows last synced timestamp', () => {
    renderComponent();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });

  it('hides last synced when not available', () => {
    renderComponent({ wallet: { ...baseWallet, lastSyncedAt: null } });
    expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
  });

  it('mentions device setup in export description for multisig', () => {
    renderComponent({
      wallet: { ...baseWallet, type: WalletType.MULTI_SIG },
    });

    expect(screen.getByText(/device setup/)).toBeInTheDocument();
  });

  it('omits device setup from export description for single-sig', () => {
    renderComponent();
    expect(screen.queryByText(/device setup/)).not.toBeInTheDocument();
  });
});
