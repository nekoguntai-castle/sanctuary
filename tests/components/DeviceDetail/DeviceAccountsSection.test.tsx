import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceAccountsSection } from '../../../src/components/DeviceDetail/DeviceDetail/DeviceAccountsSection';

vi.mock('../../../src/components/DeviceDetail/accounts/AddAccountFlow', () => ({
  AddAccountFlow: () => <div data-testid="add-account-flow" />,
}));

const activeNetworkMock = vi.hoisted(() => ({
  selectedNetwork: 'mainnet' as 'mainnet' | 'testnet3' | 'testnet4' | 'signet',
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: activeNetworkMock.selectedNetwork,
    isMainnet: activeNetworkMock.selectedNetwork === 'mainnet',
    setSelectedNetwork: vi.fn(),
  }),
}));

const baseDevice = {
  id: 'device-1',
  type: 'ledger',
  label: 'Ledger',
  fingerprint: 'abcd1234',
  accounts: [
    {
      id: 'mainnet-native',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-mainnet',
    },
    {
      id: 'testnet-native',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/1'/0'",
      xpub: 'tpub-testnet',
    },
  ],
};

describe('DeviceAccountsSection', () => {
  it('shows derivation paths behind network tabs', async () => {
    const user = userEvent.setup();
    activeNetworkMock.selectedNetwork = 'mainnet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={baseDevice as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
    expect(screen.queryByText("m/84'/1'/0'")).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /mainnet \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /testnet-family \/ signet \(1\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /testnet-family \/ signet \(1\)/i }));

    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
  });

  it('combines multiple testnet-family paths in one network tab', async () => {
    const user = userEvent.setup();
    activeNetworkMock.selectedNetwork = 'mainnet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [
            ...baseDevice.accounts,
            {
              id: 'signet-taproot',
              purpose: 'single_sig',
              scriptType: 'taproot',
              derivationPath: "m/86'/1'/0'",
              xpub: 'tpub-signet',
            },
          ],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /testnet-family \/ signet \(2\)/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /testnet-family \/ signet \(2\)/i }));

    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
    expect(screen.getByText("m/86'/1'/0'")).toBeInTheDocument();
  });

  it('opens on the testnet family tab when the active network is signet', () => {
    activeNetworkMock.selectedNetwork = 'signet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={baseDevice as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
    expect(screen.queryByText("m/84'/0'/0'")).not.toBeInTheDocument();
  });

  it('switches to multisig purpose paths when requested', async () => {
    const user = userEvent.setup();
    activeNetworkMock.selectedNetwork = 'mainnet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [
            ...baseDevice.accounts,
            {
              id: 'mainnet-multisig',
              purpose: 'multisig',
              scriptType: 'native_segwit',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub-mainnet-multisig',
            },
          ],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /multisig \(1\)/i }));

    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /single-sig \(1\)/i }));
    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
  });

  it('defaults to multisig purpose when the active network has only multisig paths', () => {
    activeNetworkMock.selectedNetwork = 'mainnet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [
            {
              id: 'mainnet-multisig',
              purpose: 'multisig',
              scriptType: 'native_segwit',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub-mainnet-multisig',
            },
          ],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /multisig \(1\)/i })).toHaveClass('surface-secondary');
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();
  });

  it('skips empty account purpose tabs during keyboard navigation', () => {
    activeNetworkMock.selectedNetwork = 'mainnet';

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={baseDevice as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    const singleSigTab = screen.getByRole('tab', { name: /single-sig \(1\)/i });
    const multisigTab = screen.getByRole('tab', { name: /multisig \(0\)/i });

    expect(multisigTab).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Device account purposes' }), {
      key: 'ArrowRight',
    });

    expect(singleSigTab).toHaveAttribute('aria-selected', 'true');
    expect(multisigTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
  });

  it('falls back from stale selected tabs when the account set changes', async () => {
    const user = userEvent.setup();
    activeNetworkMock.selectedNetwork = 'mainnet';
    const { rerender } = render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [
            ...baseDevice.accounts,
            {
              id: 'mainnet-multisig',
              purpose: 'multisig',
              scriptType: 'native_segwit',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub-mainnet-multisig',
            },
          ],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /multisig \(1\)/i }));
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /testnet-family \/ signet \(1\)/i }));
    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /single-sig \(1\)/i })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: /multisig \(0\)/i }));
    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();

    rerender(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [baseDevice.accounts[0]],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();

    rerender(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [
            {
              id: 'mainnet-multisig',
              purpose: 'multisig',
              scriptType: 'native_segwit',
              derivationPath: "m/48'/0'/0'/2'",
              xpub: 'xpub-mainnet-multisig',
            },
          ],
        } as any}
        isOwner={false}
        showAddAccount={false}
        onShowAddAccount={vi.fn()}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();
  });

  it('renders legacy account details and owner add-account controls', async () => {
    const user = userEvent.setup();
    const onShowAddAccount = vi.fn();

    render(
      <DeviceAccountsSection
        deviceId="device-1"
        device={{
          ...baseDevice,
          accounts: [],
          derivationPath: "m/84'/0'/1'",
          xpub: 'xpub-legacy',
        } as any}
        isOwner
        showAddAccount
        onShowAddAccount={onShowAddAccount}
        onCloseAddAccount={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("m/84'/0'/1'")).toBeInTheDocument();
    expect(screen.getByTestId('add-account-flow')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add derivation path/i }));
    expect(onShowAddAccount).toHaveBeenCalledTimes(1);
  });
});
