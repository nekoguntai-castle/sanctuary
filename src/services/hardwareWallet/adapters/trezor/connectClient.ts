/**
 * Trezor Connect boundary
 *
 * The only module in src/ that imports the Trezor SDK (enforced by ESLint).
 * Everything else in the adapter talks to Connect through TrezorConnectClient
 * and the DTOs in ./types, so an SDK upgrade changes this file and its
 * contract test only.
 */

import TrezorConnect, { asDeviceUniquePath } from '@trezor/connect-web';
import type {
  TrezorCallFailure,
  TrezorCallResult,
  TrezorConnectClient,
  TrezorDeviceIdentity,
  TrezorNetwork,
  TrezorResponseDevice,
} from './types';

export const TREZOR_CONNECT_VERSION = '9.7.3' as const;

export type TrezorConnectInitSettings = Parameters<typeof TrezorConnect.init>[0];
type ConnectSignParams = Parameters<typeof TrezorConnect.signTransaction>[0];

// Connect 9 coin labels. Connect 10 accepts only the shortcuts (btc/test/regtest).
const CONNECT_COIN: Record<TrezorNetwork, string> = {
  mainnet: 'Bitcoin',
  testnet: 'Testnet',
  regtest: 'Regtest',
};

/** Connect coin for a network; no SDK coin string leaves this module. */
export const connectCoin = (network: TrezorNetwork): string => CONNECT_COIN[network];

/** Brand a device identity for a Connect call, keeping the caller's state type. */
export const toConnectDevice = <Device extends TrezorDeviceIdentity>(device: Device) => ({
  path: asDeviceUniquePath(device.path),
  state: device.state,
  instance: device.instance,
});

interface RawConnectResult {
  success: boolean;
  payload?: unknown;
  error?: unknown;
  device?: unknown;
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const connectFailure = (raw: RawConnectResult): TrezorCallFailure => {
  // Connect 10 reports failures as { success: false, error: { message, code } }.
  if (raw.error !== undefined) {
    const error = asRecord(raw.error);
    return { message: optionalString(error.message), code: optionalString(error.code) };
  }
  // Connect 9 reports them as { success: false, payload: { error, code } }.
  const payload = asRecord(raw.payload);
  return { message: optionalString(payload.error), code: optionalString(payload.code) };
};

/** Convert a raw Connect response into Sanctuary's result shape. */
export function normalizeConnectResult<T>(raw: RawConnectResult): TrezorCallResult<T> {
  if (!raw.success) return { ok: false, error: connectFailure(raw) };
  return {
    ok: true,
    value: raw.payload as T,
    device: raw.device as TrezorResponseDevice | undefined,
  };
}

const defaultInitSettings = (): TrezorConnectInitSettings => ({
  manifest: {
    email: 'support@sanctuary.bitcoin',
    appUrl: window.location.origin || 'https://sanctuary.bitcoin',
    appName: 'Sanctuary',
  },
  coreMode: 'auto',
  debug: true,
  lazyLoad: false,
});

/** Production client over @trezor/connect-web. Settings default at init time. */
export const createConnectWebClient = (
  settings?: TrezorConnectInitSettings
): TrezorConnectClient => ({
  async init() {
    await TrezorConnect.init(settings ?? defaultInitSettings());
  },
  async getFeatures() {
    return normalizeConnectResult(await TrezorConnect.getFeatures());
  },
  async getDeviceState({ device }) {
    return normalizeConnectResult(
      await TrezorConnect.getDeviceState({ device: toConnectDevice(device) })
    );
  },
  async getPublicKey({ network, device, ...params }) {
    return normalizeConnectResult(
      await TrezorConnect.getPublicKey({
        ...params,
        coin: connectCoin(network),
        device: toConnectDevice(device),
      })
    );
  },
  async getAddress({ network, device, ...params }) {
    return normalizeConnectResult(
      await TrezorConnect.getAddress({
        ...params,
        coin: connectCoin(network),
        device: toConnectDevice(device),
      })
    );
  },
  async signTransaction({ network, device, inputs, outputs, ...params }) {
    return normalizeConnectResult(
      await TrezorConnect.signTransaction({
        ...params,
        // Cast as a whole: Connect's declared input/output types disagree with
        // what it accepts at runtime in two fields (`amount` is optional for
        // legacy inputs, read from refTxs; `multisig.pubkeys_order` takes the
        // enum name), so tsc does not check these payloads. The emulator proof
        // is their runtime contract.
        inputs: inputs as unknown as ConnectSignParams['inputs'],
        outputs: outputs as unknown as ConnectSignParams['outputs'],
        coin: connectCoin(network),
        push: false,
        device: toConnectDevice(device),
      })
    );
  },
});
