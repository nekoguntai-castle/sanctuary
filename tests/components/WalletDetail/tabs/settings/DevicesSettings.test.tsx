import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DevicesSettings } from '../../../../../components/WalletDetail/tabs/settings/DevicesSettings';
import { WalletType } from '../../../../../types';
import type { Device, Wallet } from '../../../../../types';

vi.mock('../../../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (_type: string, className: string) => (
    <span data-testid="device-icon" className={className} />
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const baseWallet = {
  id: 'wallet-1',
  name: 'Test Wallet',
  type: WalletType.SINGLE_SIG,
  scriptType: 'native_segwit',
  balance: 100_000,
} as Wallet;

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  label: 'Coldcard',
  type: 'coldcard',
  fingerprint: 'AABB1122',
  derivationPath: "m/84'/0'/0'",
  accountMissing: false,
  ...overrides,
} as Device);

describe('DevicesSettings', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders empty state when no devices', () => {
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByText('No hardware devices associated with this wallet.')).toBeInTheDocument();
  });

  it('renders device list with label and fingerprint', () => {
    const devices = [makeDevice()];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={devices} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Coldcard')).toBeInTheDocument();
    expect(screen.getByText(/AABB1122/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('navigates to device detail on click', () => {
    const devices = [makeDevice()];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={devices} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Coldcard'));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/device-1');
  });

  it('shows account mismatch warning for single-sig wallet', () => {
    const devices = [makeDevice({ accountMissing: true })];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={devices} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Missing single-sig account/)).toBeInTheDocument();
    expect(screen.getByText('Cannot Sign')).toBeInTheDocument();
  });

  it('shows multisig mismatch warning for multisig wallet', () => {
    const multisigWallet = { ...baseWallet, type: WalletType.MULTI_SIG };
    const devices = [makeDevice({ accountMissing: true })];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={multisigWallet} devices={devices} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Missing multisig account/)).toBeInTheDocument();
  });

  it('shows derivation path when account is not missing', () => {
    const devices = [makeDevice()];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={devices} />
      </MemoryRouter>,
    );

    expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
  });

  it('renders multiple devices', () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Coldcard' }),
      makeDevice({ id: 'd2', label: 'Trezor', type: 'trezor', fingerprint: 'CCDD3344' }),
    ];
    render(
      <MemoryRouter>
        <DevicesSettings wallet={baseWallet} devices={devices} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Coldcard')).toBeInTheDocument();
    expect(screen.getByText('Trezor')).toBeInTheDocument();
  });
});
