import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignerSelectionStep } from '../../../components/CreateWallet/SignerSelectionStep';
import { WalletType } from '../../../types';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

describe('SignerSelectionStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders singular incompatible warning and empty-compatible helper text', () => {
    render(
      <SignerSelectionStep
        walletType={WalletType.SINGLE_SIG}
        compatibleDevices={[]}
        incompatibleDevices={[
          {
            id: 'device-1',
            label: 'Ledger',
            type: 'ledger',
          } as any,
        ]}
        selectedDeviceIds={new Set()}
        toggleDevice={vi.fn()}
        getDisplayAccount={() => null}
      />
    );

    expect(screen.getByText('1 device hidden')).toBeInTheDocument();
    expect(screen.getByText(/Ledger doesn't have a single-sig derivation path/i)).toBeInTheDocument();
    expect(screen.getByText(/No devices with single-sig accounts found/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add derivation path/i }));
    expect(navigateMock).toHaveBeenCalledWith('/devices/device-1');
  });

  it('renders plural incompatible warning and compatible-device helper hint', () => {
    render(
      <SignerSelectionStep
        walletType={WalletType.MULTI_SIG}
        compatibleDevices={[
          {
            id: 'device-2',
            label: 'Coldcard',
            fingerprint: 'ABCD1234',
            type: 'coldcard',
          } as any,
        ]}
        incompatibleDevices={[
          { id: 'device-a', label: 'Jade', type: 'jade' } as any,
          { id: 'device-b', label: 'Trezor', type: 'trezor' } as any,
        ]}
        selectedDeviceIds={new Set(['device-2'])}
        toggleDevice={vi.fn()}
        getDisplayAccount={() => ({ derivationPath: "m/48'/0'/0'/2'" } as any)}
      />
    );

    expect(screen.getByText('2 devices hidden')).toBeInTheDocument();
    expect(screen.getByText(/Jade, Trezor don't have a multisig derivation path/i)).toBeInTheDocument();
    expect(screen.getByText(/Don't see your device\? It may need a multisig derivation path added\./i)).toBeInTheDocument();
    expect(screen.queryByText(/No devices with multisig accounts found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /connect new device/i }));
    expect(navigateMock).toHaveBeenCalledWith('/devices/connect');
  });
});
