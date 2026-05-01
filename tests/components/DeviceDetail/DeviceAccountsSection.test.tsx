import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceAccountsSection } from '../../../components/DeviceDetail/DeviceDetail/DeviceAccountsSection';

vi.mock('../../../components/DeviceDetail/accounts/AddAccountFlow', () => ({
  AddAccountFlow: () => <div data-testid="add-account-flow" />,
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
  it('collapses testnet and signet derivation paths until expanded', async () => {
    const user = userEvent.setup();

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
    expect(screen.getByText('1 path hidden')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: /testnet \/ signet derivation paths/i,
      }),
    );

    expect(screen.getByText("m/84'/1'/0'")).toBeInTheDocument();
  });
});
