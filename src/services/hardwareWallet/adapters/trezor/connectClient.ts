/**
 * Trezor Connect boundary
 *
 * The only module in src/ that imports the Trezor SDK (enforced by ESLint).
 * Everything else in the adapter talks to Connect through TrezorConnectClient
 * and the DTOs in ./types, so an SDK upgrade changes this file and its
 * contract test only.
 */

import TrezorConnect, {
  asDeviceUniquePath,
  type CoinSymbol,
  type StaticSessionId,
} from '@trezor/connect-web';
import type {
  TrezorCallFailure,
  TrezorCallResult,
  TrezorConnectClient,
  TrezorDeviceIdentity,
  TrezorMultisig,
  TrezorNetwork,
  TrezorResponseDevice,
  TrezorSignInput,
  TrezorSignOutput,
} from './types';

export const TREZOR_CONNECT_VERSION = '10.0.1' as const;

export type TrezorConnectInitSettings = Parameters<typeof TrezorConnect.init>[0];
// Connect 10 accepts only coin shortcuts; network labels such as 'Bitcoin' fail.
const CONNECT_COIN: Record<TrezorNetwork, CoinSymbol> = {
  mainnet: 'btc',
  testnet: 'test',
  regtest: 'regtest',
};

/** Connect coin for a network; no SDK coin string leaves this module. */
export const connectCoin = (network: TrezorNetwork): CoinSymbol => CONNECT_COIN[network];

/**
 * Brand a device identity for a Connect call. Connect 10 takes the passphrase
 * state as a DeviceState object and reads its staticSessionId.
 */
export const toConnectDevice = (device: TrezorDeviceIdentity) => ({
  path: asDeviceUniquePath(device.path),
  // The state string is the staticSessionId Connect itself returned (see
  // sessionIdentity.ts), so it already has StaticSessionId's shape.
  state:
    device.state === undefined
      ? undefined
      : { staticSessionId: device.state as StaticSessionId },
  instance: device.instance,
});

// PROTO.MultisigPubkeysOrder.LEXICOGRAPHIC; Connect 10 exports PROTO as a type only.
const LEXICOGRAPHIC_PUBKEYS_ORDER = 1;

/** Encode the multisig pubkey order as the Connect enum value. */
export const toConnectMultisig = (multisig: TrezorMultisig) => ({
  ...multisig,
  pubkeys_order: LEXICOGRAPHIC_PUBKEYS_ORDER,
});

const toConnectInput = ({ multisig, ...input }: TrezorSignInput) =>
  multisig === undefined ? input : { ...input, multisig: toConnectMultisig(multisig) };

const toConnectOutput = (output: TrezorSignOutput) => {
  if (!('address_n' in output)) return output;
  const { multisig, ...change } = output;
  return multisig === undefined ? change : { ...change, multisig: toConnectMultisig(multisig) };
};

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

// Connect 10 reports failures as { success: false, error: { message, code } }.
const connectFailure = (raw: RawConnectResult): TrezorCallFailure => {
  const error = asRecord(raw.error);
  return { message: optionalString(error.message), code: optionalString(error.code) };
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
  debug: false,
});

type ConnectWebSdk = typeof TrezorConnect;

/**
 * The Connect calls the client makes, typed by the public connect-web API. The
 * in-process @trezor/connect core exposes a superset, so the emulator proof can
 * pass it here and exercise this exact mapping.
 */
export interface TrezorConnectSdk<Settings> {
  init(settings: Settings): Promise<unknown>;
  getFeatures: ConnectWebSdk['getFeatures'];
  getDeviceState: ConnectWebSdk['getDeviceState'];
  getPublicKey: ConnectWebSdk['getPublicKey'];
  getAddress: ConnectWebSdk['getAddress'];
  signTransaction: ConnectWebSdk['signTransaction'];
}

/** Client over any Connect SDK object; init settings are resolved at init time. */
export const createConnectClient = <Settings>(
  sdk: TrezorConnectSdk<Settings>,
  initSettings: () => Settings
): TrezorConnectClient => ({
  async init() {
    await sdk.init(initSettings());
  },
  async getFeatures() {
    return normalizeConnectResult(await sdk.getFeatures());
  },
  async getDeviceState({ device }) {
    return normalizeConnectResult(await sdk.getDeviceState({ device: toConnectDevice(device) }));
  },
  async getPublicKey({ network, device, ...params }) {
    return normalizeConnectResult(
      await sdk.getPublicKey({
        ...params,
        coin: connectCoin(network),
        device: toConnectDevice(device),
      })
    );
  },
  async getAddress({ network, device, ...params }) {
    return normalizeConnectResult(
      await sdk.getAddress({
        ...params,
        coin: connectCoin(network),
        device: toConnectDevice(device),
      })
    );
  },
  async signTransaction({ network, device, inputs, outputs, ...params }) {
    return normalizeConnectResult(
      await sdk.signTransaction({
        ...params,
        inputs: inputs.map(toConnectInput),
        outputs: outputs.map(toConnectOutput),
        coin: connectCoin(network),
        push: false,
        device: toConnectDevice(device),
      })
    );
  },
});

/** Production client over @trezor/connect-web (the Suite-hosted flow). */
export const createConnectWebClient = (settings?: TrezorConnectInitSettings): TrezorConnectClient =>
  createConnectClient<TrezorConnectInitSettings>(TrezorConnect, () => settings ?? defaultInitSettings());
