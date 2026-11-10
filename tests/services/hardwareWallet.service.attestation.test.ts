import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { HardwareWalletService } from '../../src/services/hardwareWallet/service';
import {
  clearHardwareWalletAttestation,
  setHardwareWalletAttestation,
} from '../../src/services/hardwareWallet/operatorAttestation';
import type { DeviceAdapter, HardwareWalletDevice } from '../../src/services/hardwareWallet/types';

const MODEL_T = 'Trezor Model T';

function createTrezorAdapter(model?: string) {
  const device: HardwareWalletDevice = {
    id: 'trezor-1',
    type: 'trezor',
    name: 'Trezor',
    model,
    connected: true,
    fingerprint: 'abcd1234',
  };
  const adapter: DeviceAdapter = {
    type: 'trezor',
    displayName: 'Trezor Adapter',
    isSupported: vi.fn(() => true),
    isConnected: vi.fn(() => true),
    getDevice: vi.fn(() => device),
    connect: vi.fn(async () => device),
    disconnect: vi.fn(async () => undefined),
    getXpub: vi.fn(),
    signPSBT: vi.fn(async () => ({ psbt: 'signed', signatures: 1 })),
    verifyAddress: vi.fn(async () => true),
  };
  const service = new HardwareWalletService();
  service.registerAdapter(adapter);
  return { adapter, service };
}

const connectOptions = { chainEnvironment: 'mainnet' as const, expectedModel: MODEL_T };

describe('HardwareWalletService operator attestation', () => {
  afterEach(() => clearHardwareWalletAttestation());

  it('keeps Trezor blocked before connecting when the instance has no attestation', async () => {
    const { adapter, service } = createTrezorAdapter(MODEL_T);
    await expect(service.connect('trezor', connectOptions)).rejects.toThrow(
      'Hardware wallet connection is temporarily unavailable',
    );
    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it('allows connect, sign and display for an exact attested Trezor model', async () => {
    setHardwareWalletAttestation(['trezor']);
    const { adapter, service } = createTrezorAdapter(MODEL_T);

    await expect(service.connect('trezor', connectOptions)).resolves.toMatchObject({
      model: MODEL_T,
      fingerprint: 'abcd1234',
    });
    await expect(service.signPSBT({ psbt: 'fixture' })).resolves.toMatchObject({ psbt: 'signed' });
    await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1qfixture')).resolves.toBe(true);
    expect(adapter.signPSBT).toHaveBeenCalledTimes(1);
  });

  it('rejects an attested Trezor whose connected model is unresolved', async () => {
    setHardwareWalletAttestation(['trezor']);
    const { adapter, service } = createTrezorAdapter();

    await expect(service.connect('trezor', connectOptions)).rejects.toThrow(
      'Hardware wallet connection is temporarily unavailable',
    );
    expect(adapter.disconnect).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('blocks signing once the attestation is cleared after connect', async () => {
    setHardwareWalletAttestation(['trezor']);
    const { adapter, service } = createTrezorAdapter(MODEL_T);
    await service.connect('trezor', connectOptions);

    clearHardwareWalletAttestation();
    await expect(service.signPSBT({ psbt: 'fixture' })).rejects.toThrow(
      'Hardware wallet connection is temporarily unavailable',
    );
    expect(adapter.signPSBT).not.toHaveBeenCalled();
  });
});
