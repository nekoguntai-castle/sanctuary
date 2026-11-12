/** The client mirrors /auth/me hardware-wallet attestation and clears it with the session. */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import {
  clearHardwareWalletAttestation,
  getAttestedHardwareWalletVendors,
  setHardwareWalletAttestation,
} from '../../src/services/hardwareWallet/operatorAttestation';
import { mockUser, TestConsumer } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/api/auth', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
  requires2FA: vi.fn(() => false),
  isPendingEmailVerification: vi.fn((response) => response?.emailVerificationRequired === true),
}));
vi.mock('../../src/services/websocket', () => ({
  websocketClient: { disconnect: vi.fn() },
}));
const terminalLogout = vi.hoisted(() => ({ listener: null as (() => void) | null }));
vi.mock('../../src/api/refresh', () => ({
  onTerminalLogout: (cb: () => void) => {
    terminalLogout.listener = cb;
    return () => { terminalLogout.listener = null; };
  },
  triggerLogout: vi.fn(),
  onPeerLogin: () => () => {},
  announceLogin: vi.fn(),
}));
vi.mock('../../src/themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
    applyPatternOpacity: vi.fn(),
    applyFlyoutOpacity: vi.fn(),
  },
}));

const attestedUser = {
  ...mockUser,
  hardwareWalletAttestation: { vendors: ['trezor'], label: 'Operator-attested, not Tier 3 verified' },
};

async function renderAuthenticated() {
  render(<UserProvider><TestConsumer /></UserProvider>);
  await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
}

describe('UserContext hardware-wallet attestation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearHardwareWalletAttestation();
  });
  afterEach(() => clearHardwareWalletAttestation());

  it('mirrors the attested vendors from /auth/me on boot', async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(attestedUser);
    await renderAuthenticated();
    expect(getAttestedHardwareWalletVendors()).toEqual(['trezor']);
  });

  it('treats an /auth/me response without the field as no attestation', async () => {
    setHardwareWalletAttestation(['trezor']);
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
    await renderAuthenticated();
    expect(getAttestedHardwareWalletVendors()).toEqual([]);
  });

  it('clears the attestation on explicit logout', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(attestedUser);
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    await renderAuthenticated();

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(getAttestedHardwareWalletVendors()).toEqual([]);
  });

  it('clears the attestation on a terminal logout from another path', async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(attestedUser);
    await renderAuthenticated();

    act(() => terminalLogout.listener?.());
    expect(getAttestedHardwareWalletVendors()).toEqual([]);
  });

  it('mirrors the login payload and clears on a pending-verification registration', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('offline'));
    vi.mocked(authApi.login).mockResolvedValue({ user: attestedUser });
    render(<UserProvider><TestConsumer /></UserProvider>);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByTestId('login'));
    await waitFor(() => expect(getAttestedHardwareWalletVendors()).toEqual(['trezor']));

    vi.mocked(authApi.register).mockResolvedValue({
      emailVerificationRequired: true,
      verificationEmailSent: true,
      message: 'Check your email',
    });
    await user.click(screen.getByTestId('register'));
    await waitFor(() => expect(getAttestedHardwareWalletVendors()).toEqual([]));
  });
});
