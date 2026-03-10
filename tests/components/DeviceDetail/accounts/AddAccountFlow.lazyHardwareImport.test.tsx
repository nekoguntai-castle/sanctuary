import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAccountFlow } from '../../../../components/DeviceDetail/accounts/AddAccountFlow';

const hardwareModuleImportSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => true,
}));

vi.mock('../../../../services/hardwareWallet', () => {
  hardwareModuleImportSpy();
  return {
    hardwareWalletService: {
      connect: vi.fn().mockRejectedValue(new Error('hardware runtime unavailable')),
      getAllXpubs: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
    DeviceType: {},
  };
});

vi.mock('../../../../src/api/devices', () => ({
  getDevice: vi.fn(),
  addDeviceAccount: vi.fn(),
}));

vi.mock('../../../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(() => null),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('AddAccountFlow lazy hardware runtime import', () => {
  const props = {
    deviceId: 'device-1',
    device: {
      id: 'device-1',
      type: 'ledger',
      label: 'Ledger',
      fingerprint: 'abcd1234',
      accounts: [],
    } as any,
    onClose: vi.fn(),
    onDeviceUpdated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without importing hardware runtime at page load', () => {
    render(<AddAccountFlow {...props} />);

    expect(screen.getByText('Add Derivation Path')).toBeInTheDocument();
    expect(screen.getByText('Connect via USB')).toBeInTheDocument();
    expect(hardwareModuleImportSpy).not.toHaveBeenCalled();
  });

  it('shows a non-fatal error when USB flow tries to load unavailable runtime', async () => {
    const user = userEvent.setup();
    render(<AddAccountFlow {...props} />);

    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(screen.getByText(/hardware runtime unavailable/i)).toBeInTheDocument();
    });
  });
});
