import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsTab } from '../../../../components/WalletDetail/tabs/SettingsTab';
import { WalletType, type Device } from '../../../../types';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../../components/LabelManager', () => ({
  LabelManager: () => <div data-testid="label-manager">Label manager</div>,
}));

vi.mock('../../../../components/WalletDetail/WalletTelegramSettings', () => ({
  WalletTelegramSettings: () => <div data-testid="wallet-telegram-settings">Telegram settings</div>,
}));

vi.mock('../../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon">icon</span>,
}));

describe('SettingsTab', () => {
  const baseProps = {
    settingsSubTab: 'general' as const,
    onSettingsSubTabChange: vi.fn(),
    wallet: {
      id: 'wallet-1',
      name: 'Main Wallet',
      type: WalletType.SINGLE_SIG,
      scriptType: 'native_segwit',
      descriptor: null,
      derivationPath: '',
      userRole: 'owner',
      canEdit: true,
      totalSigners: 1,
    } as any,
    devices: [],
    isEditingName: false,
    editedName: 'Main Wallet',
    onSetIsEditingName: vi.fn(),
    onSetEditedName: vi.fn(),
    onUpdateWallet: vi.fn(),
    onLabelsChange: vi.fn(),
    syncing: false,
    onSync: vi.fn(),
    onFullResync: vi.fn(),
    repairing: false,
    onRepairWallet: vi.fn(),
    showDangerZone: true,
    onSetShowDangerZone: vi.fn(),
    onShowDelete: vi.fn(),
    onShowExport: vi.fn(),
    explorerUrl: 'https://mempool.space',
  };

  it('renders general tab with label manager', () => {
    render(<SettingsTab {...baseProps} />);
    expect(screen.getByText('Wallet Name')).toBeInTheDocument();
    expect(screen.getByTestId('label-manager')).toBeInTheDocument();
  });

  it('handles wallet name editing actions', () => {
    render(<SettingsTab {...baseProps} isEditingName editedName="Renamed Wallet" />);

    const input = screen.getByPlaceholderText('Enter wallet name');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(baseProps.onUpdateWallet).toHaveBeenCalledWith({ name: 'Renamed Wallet' });
    expect(baseProps.onSetIsEditingName).toHaveBeenCalledWith(false);
  });

  it('renders devices tab and navigates on device click', () => {
    render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="devices"
        devices={[{ id: 'd1', label: 'Ledger', type: 'ledger', fingerprint: 'abcd', derivationPath: 'm/84', accountMissing: true } as Device]}
      />
    );

    expect(screen.getByText('Cannot Sign')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ledger'));
    expect(navigateMock).toHaveBeenCalledWith('/devices/d1');
  });

  it('renders notifications and advanced actions', () => {
    render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{ ...baseProps.wallet, descriptor: null, userRole: 'owner' }}
      />
    );

    fireEvent.click(screen.getByText('Sync'));
    fireEvent.click(screen.getByText('Resync'));
    fireEvent.click(screen.getByText('Repair'));
    fireEvent.click(screen.getByText('Export'));
    fireEvent.click(screen.getByText('Delete'));

    expect(baseProps.onSync).toHaveBeenCalled();
    expect(baseProps.onFullResync).toHaveBeenCalled();
    expect(baseProps.onRepairWallet).toHaveBeenCalled();
    expect(baseProps.onShowExport).toHaveBeenCalled();
    expect(baseProps.onShowDelete).toHaveBeenCalled();
  });

  it('renders notifications subtab component', () => {
    render(<SettingsTab {...baseProps} settingsSubTab="notifications" />);
    expect(screen.getByTestId('wallet-telegram-settings')).toBeInTheDocument();
  });

  it('invokes settings sub-tab change handlers', () => {
    render(<SettingsTab {...baseProps} settingsSubTab="general" />);

    fireEvent.click(screen.getByText('General'));
    fireEvent.click(screen.getByText('Devices'));
    fireEvent.click(screen.getByText('Notifications'));
    fireEvent.click(screen.getByText('Advanced'));

    expect(baseProps.onSettingsSubTabChange).toHaveBeenCalledWith('general');
    expect(baseProps.onSettingsSubTabChange).toHaveBeenCalledWith('devices');
    expect(baseProps.onSettingsSubTabChange).toHaveBeenCalledWith('notifications');
    expect(baseProps.onSettingsSubTabChange).toHaveBeenCalledWith('advanced');
  });

  it('handles rename edit interactions (change, save, cancel, escape)', () => {
    const props = {
      ...baseProps,
      isEditingName: true,
      editedName: 'Renamed Wallet',
    };
    const { rerender } = render(<SettingsTab {...props} />);

    const input = screen.getByPlaceholderText('Enter wallet name');
    fireEvent.change(input, { target: { value: 'Another Name' } });
    expect(baseProps.onSetEditedName).toHaveBeenCalledWith('Another Name');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(baseProps.onSetIsEditingName).toHaveBeenCalledWith(false);
    expect(baseProps.onSetEditedName).toHaveBeenCalledWith('Main Wallet');

    rerender(<SettingsTab {...props} editedName="Brand New" />);
    const saveButton = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-check'))!;
    fireEvent.click(saveButton);
    expect(baseProps.onUpdateWallet).toHaveBeenCalledWith({ name: 'Brand New' });
    expect(baseProps.onSetIsEditingName).toHaveBeenCalledWith(false);

    const cancelButton = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-x'))!;
    fireEvent.click(cancelButton);
    expect(baseProps.onSetEditedName).toHaveBeenCalledWith('Main Wallet');
  });

  it('does not submit wallet rename when edited name is blank', () => {
    const onUpdateWallet = vi.fn();
    const onSetIsEditingName = vi.fn();
    const onSetEditedName = vi.fn();

    render(
      <SettingsTab
        {...baseProps}
        isEditingName={true}
        editedName="   "
        onUpdateWallet={onUpdateWallet}
        onSetIsEditingName={onSetIsEditingName}
        onSetEditedName={onSetEditedName}
      />
    );

    const input = screen.getByPlaceholderText('Enter wallet name');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateWallet).not.toHaveBeenCalled();

    const saveButton = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-check')) as HTMLButtonElement;
    const reactPropsKey = Object.keys(saveButton).find(key => key.startsWith('__reactProps$'));
    const reactOnClick = reactPropsKey
      ? (saveButton as any)[reactPropsKey]?.onClick
      : undefined;
    expect(typeof reactOnClick).toBe('function');
    reactOnClick?.({} as React.MouseEvent<HTMLButtonElement>);
    expect(onUpdateWallet).not.toHaveBeenCalled();
    expect(onSetIsEditingName).not.toHaveBeenCalled();
  });

  it('enters edit mode from view mode', () => {
    render(<SettingsTab {...baseProps} isEditingName={false} />);

    fireEvent.click(screen.getByTitle('Rename wallet'));
    expect(baseProps.onSetEditedName).toHaveBeenCalledWith('Main Wallet');
    expect(baseProps.onSetIsEditingName).toHaveBeenCalledWith(true);
  });

  it('renders descriptor-derived and fallback paths in advanced technical details', () => {
    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{
          ...baseProps.wallet,
          descriptor: "wpkh([abcd1234/84h/0h/0h]xpub123/0/*)",
          derivationPath: 'm/84/0/0',
        }}
      />
    );

    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();

    rerender(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        wallet={{
          ...baseProps.wallet,
          descriptor: 'invalid-descriptor',
          derivationPath: 'm/86/0/0',
        }}
      />
    );

    expect(screen.getByText('m/86/0/0')).toBeInTheDocument();
  });

  it('toggles danger zone section from header button', () => {
    render(
      <SettingsTab
        {...baseProps}
        settingsSubTab="advanced"
        showDangerZone={false}
      />
    );

    fireEvent.click(screen.getByText('Danger Zone'));
    expect(baseProps.onSetShowDangerZone).toHaveBeenCalledWith(true);
  });
});
