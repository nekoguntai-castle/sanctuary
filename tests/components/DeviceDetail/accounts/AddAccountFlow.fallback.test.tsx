import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAccountFlow } from '../../../../components/DeviceDetail/accounts/AddAccountFlow';

const setAddAccountMethodMock = vi.hoisted(() => vi.fn());
const setAddAccountErrorMock = vi.hoisted(() => vi.fn());
const resetImportStateMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => true,
}));

vi.mock('../../../../components/DeviceDetail/accounts/hooks/useAddAccountFlow', () => ({
  getDeviceTypeFromDeviceModel: () => 'ledger',
  useAddAccountFlow: () => ({
    addAccountMethod: 'unexpected-method',
    setAddAccountMethod: setAddAccountMethodMock,
    addAccountLoading: false,
    addAccountError: null,
    setAddAccountError: setAddAccountErrorMock,
    usbProgress: null,
    handleAddAccountsViaUsb: vi.fn(),
    manualAccount: { derivationPath: '', xpub: '', name: '', scriptType: 'native_segwit', purpose: 'single_sig' },
    setManualAccount: vi.fn(),
    handleAddAccountManually: vi.fn(),
    qrMode: 'camera',
    setQrMode: vi.fn(),
    cameraActive: false,
    setCameraActive: vi.fn(),
    cameraError: null,
    setCameraError: vi.fn(),
    urProgress: null,
    setUrProgress: vi.fn(),
    urDecoderRef: { current: null },
    bytesDecoderRef: { current: null },
    handleQrScan: vi.fn(),
    handleCameraError: vi.fn(),
    parsedAccounts: [],
    selectedParsedAccounts: new Set<number>(),
    setSelectedParsedAccounts: vi.fn(),
    accountConflict: null,
    handleAddParsedAccounts: vi.fn(),
    resetImportState: resetImportStateMock,
    handleFileUpload: vi.fn(),
  }),
}));

describe('AddAccountFlow fallback branches', () => {
  it('renders no method panel for unknown addAccountMethod and still allows back reset', async () => {
    const user = userEvent.setup();
    render(
      <AddAccountFlow
        deviceId="device-1"
        device={{ id: 'device-1', type: 'ledger', label: 'Ledger' } as any}
        onClose={vi.fn()}
        onDeviceUpdated={vi.fn()}
      />
    );

    expect(screen.queryByText('Connect via USB')).not.toBeInTheDocument();
    await user.click(screen.getByText('← Back to options'));

    expect(setAddAccountMethodMock).toHaveBeenCalledWith(null);
    expect(setAddAccountErrorMock).toHaveBeenCalledWith(null);
    expect(resetImportStateMock).toHaveBeenCalled();
  });
});
