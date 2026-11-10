/**
 * Fake TrezorConnectClient for adapter tests. Tests drive the adapter through
 * Sanctuary's own Connect boundary types instead of mocking the Trezor SDK, so
 * an SDK upgrade does not touch them (the SDK mapping is pinned once, in
 * hardwareWallet.trezorConnectClient.test.ts).
 */
import { vi } from 'vitest';
import type {
  TrezorCallResult,
  TrezorConnectClient,
  TrezorResponseDevice,
} from '../../../src/services/hardwareWallet/adapters/trezor/types';

export interface FakeTrezorClient extends TrezorConnectClient {
  init: ReturnType<typeof vi.fn<TrezorConnectClient['init']>>;
  getFeatures: ReturnType<typeof vi.fn<TrezorConnectClient['getFeatures']>>;
  getDeviceState: ReturnType<typeof vi.fn<TrezorConnectClient['getDeviceState']>>;
  getPublicKey: ReturnType<typeof vi.fn<TrezorConnectClient['getPublicKey']>>;
  getAddress: ReturnType<typeof vi.fn<TrezorConnectClient['getAddress']>>;
  signTransaction: ReturnType<typeof vi.fn<TrezorConnectClient['signTransaction']>>;
}

export function createFakeTrezorClient(): FakeTrezorClient {
  return {
    init: vi.fn<TrezorConnectClient['init']>().mockResolvedValue(undefined),
    getFeatures: vi.fn<TrezorConnectClient['getFeatures']>(),
    getDeviceState: vi.fn<TrezorConnectClient['getDeviceState']>(),
    getPublicKey: vi.fn<TrezorConnectClient['getPublicKey']>(),
    getAddress: vi.fn<TrezorConnectClient['getAddress']>(),
    signTransaction: vi.fn<TrezorConnectClient['signTransaction']>(),
  };
}

/** Successful Connect call, optionally echoing a device identity. */
export function connectOk<T>(value: T, device?: TrezorResponseDevice): TrezorCallResult<T> {
  return device === undefined ? { ok: true, value } : { ok: true, value, device };
}

/** Failed Connect call; omit the message to exercise caller fallbacks. */
export function connectFail<T = never>(message?: string, code?: string): TrezorCallResult<T> {
  return { ok: false, error: { message, code } };
}
