import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { SettingsTab } from '../../../../src/components/WalletDetail/tabs/SettingsTab';
import { WalletType,type Device } from '../../../../src/types';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../../src/components/LabelManager', () => ({
  LabelManager: () => <div data-testid="label-manager">Label manager</div>,
}));

vi.mock('../../../../src/components/WalletDetail/WalletTelegramSettings', () => ({
  WalletTelegramSettings: () => <div>Telegram settings</div>,
}));

vi.mock('../../../../src/components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon">icon</span>,
}));

describe('SettingsTab branch coverage', () => {
  const baseProps = {
    settingsSubTab: 'general' as const,
    onSettingsSubTabChange: vi.fn(),
    wallet: {
      id: 'wallet-1',
      name: 'Main Wallet',
      type: WalletType.SINGLE_SIG,
      scriptType: 'native_segwit',
      descriptor: "wpkh([abcd1234/84h/0h/0h]xpub123/0/*)",
      derivationPath: "m/84'/0'/0'",
      userRole: 'owner',
      canEdit: true,
      totalSigners: 1,
      quorum: '',
    } as any,
    devices: [] as Device[],
    isEditingName: false,
    editedName: 'Main Wallet',
    onSetIsEditingName: vi.fn(),
    onSetEditedName: vi.fn(),
    onUpdateWallet: vi.fn(),
    onLabelsChange: vi.fn(),
    syncing: false,
    onSync: vi.fn(),
    onFullResync: vi.fn(),
    showDangerZone: false,
    onSetShowDangerZone: vi.fn(),
    onShowDelete: vi.fn(),
    onShowExport: vi.fn(),
    explorerUrl: 'https://mempool.space',
  };

  it('renders all script label branches including unknown', () => {
    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{ ...baseProps.wallet, scriptType: 'nested_segwit' }}
      />
    );
    expect(screen.getByText('Nested SegWit')).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{ ...baseProps.wallet, scriptType: 'taproot' }}
      />
    );
    expect(screen.getByText('Taproot')).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{ ...baseProps.wallet, scriptType: 'legacy' }}
      />
    );
    expect(screen.getByText('Legacy')).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{ ...baseProps.wallet, scriptType: undefined }}
      />
    );
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('covers advanced sync/repair/multisig copy and fallback derivation path branches', () => {
    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        syncing
        wallet={{
          ...baseProps.wallet,
          type: WalletType.MULTI_SIG,
          quorum: { m: 2, n: 3 },
          totalSigners: 3,
          descriptor: 'invalid-descriptor',
          derivationPath: '',
          userRole: 'owner',
          lastSyncedAt: '2025-03-01T12:34:56.000Z',
        }}
      />
    );

    expect(screen.getByText(/Last synced/i)).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getAllByText('Syncing...')).toHaveLength(2);
    expect(screen.getByText(/device setup/i)).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{
          ...baseProps.wallet,
          descriptor: null,
          userRole: 'owner',
        }}
      />
    );
    expect(screen.getByRole('button', { name: 'Create safety preview' })).toBeInTheDocument();
  });

  it('covers devices tab branches for empty, active, and multisig mismatch devices', () => {
    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="devices"
        devices={[]}
      />
    );
    expect(screen.getByText('No hardware devices associated with this wallet.')).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="devices"
        devices={[
          {
            id: 'dev-active',
            label: 'Ledger Active',
            type: 'ledger',
            fingerprint: 'aaaa',
            derivationPath: "m/84'/0'/0'",
            accountMissing: false,
          } as Device,
        ]}
      />
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ledger Active'));
    expect(navigateMock).toHaveBeenCalledWith('/devices/dev-active');

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="devices"
        wallet={{ ...baseProps.wallet, type: WalletType.MULTI_SIG }}
        devices={[
          {
            id: 'dev-missing',
            label: 'Coldcard Missing',
            type: 'coldcard',
            fingerprint: 'bbbb',
            derivationPath: "m/48'/0'/0'/2'",
            accountMissing: true,
          } as Device,
        ]}
      />
    );
    expect(screen.getByText('Cannot Sign')).toBeInTheDocument();
    expect(screen.getByText(/Missing multisig account/i)).toBeInTheDocument();
  });

  it('disables save button when edited name is blank/unchanged and enables for valid rename', () => {
    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        isEditingName
        editedName="   "
      />
    );

    const findSaveButton = () =>
      screen.getAllByRole('button').find((b) => b.querySelector('.lucide-check')) as HTMLButtonElement;

    expect(findSaveButton().disabled).toBe(true);

    rerender(
      <SettingsTab
        {...baseProps}
        isEditingName
        editedName="Main Wallet"
      />
    );
    expect(findSaveButton().disabled).toBe(true);

    rerender(
      <SettingsTab
        {...baseProps}
        isEditingName
        editedName="Renamed Wallet"
      />
    );
    const saveButton = findSaveButton();
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);
    expect(baseProps.onUpdateWallet).toHaveBeenCalledWith({ name: 'Renamed Wallet' });
  });
});
