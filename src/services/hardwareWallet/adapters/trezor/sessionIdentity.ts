import { asDeviceUniquePath } from '@trezor/connect-web';
import type { TrezorSessionIdentity } from './types';

interface ConnectDeviceIdentity {
  path?: unknown;
  state?: unknown;
  instance?: unknown;
}

const identityError = (detail: string): Error =>
  new Error(`Trezor selected session mismatch: ${detail}`);

function sessionState(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!value || typeof value !== 'object') return undefined;
  const staticSessionId = (value as { staticSessionId?: unknown }).staticSessionId;
  return typeof staticSessionId === 'string' && staticSessionId.length > 0
    ? staticSessionId
    : undefined;
}

/** Capture the exact Connect transport path and wallet instance selected by the user. */
export function requireSelectedDevice(
  device: ConnectDeviceIdentity | undefined
): Pick<TrezorSessionIdentity, 'path' | 'instance'> {
  if (!device || typeof device.path !== 'string' || device.path.length === 0) {
    throw identityError('Connect did not identify the selected device path');
  }
  if (!Number.isInteger(device.instance) || Number(device.instance) < 0) {
    throw identityError('Connect returned an invalid wallet instance');
  }
  return { path: device.path, instance: Number(device.instance) };
}

/** Bind the selected transport identity to Connect's resolved passphrase state. */
export function requireResolvedSession(
  selected: Pick<TrezorSessionIdentity, 'path' | 'instance'>,
  state: unknown,
  responseDevice?: ConnectDeviceIdentity
): TrezorSessionIdentity {
  const resolvedState = sessionState(state) ?? sessionState(responseDevice?.state);
  if (!resolvedState) throw identityError('Connect did not resolve the passphrase state');
  const session = { ...selected, state: resolvedState };
  assertSessionIdentity(responseDevice, session);
  return session;
}

/** Reject a response unless it came from the same path, instance, and passphrase state. */
export function assertSessionIdentity(
  responseDevice: ConnectDeviceIdentity | undefined,
  expected: TrezorSessionIdentity
): void {
  if (!responseDevice) {
    throw identityError('Connect omitted the response device identity');
  }
  const actual = requireSelectedDevice(responseDevice);
  const actualState = sessionState(responseDevice.state);
  if (actual.path !== expected.path || actual.instance !== expected.instance) {
    throw identityError('device path or wallet instance changed');
  }
  if (!actualState) {
    throw identityError('Connect omitted the response passphrase state');
  }
  if (actualState !== expected.state) {
    throw identityError('passphrase state changed');
  }
}

/** Serialize a fully bound session for every funds-controlling Connect call. */
export function connectDevice(session: TrezorSessionIdentity) {
  return {
    path: asDeviceUniquePath(session.path),
    state: session.state,
    instance: session.instance,
  };
}

/** Serialize the pre-state selection used only while resolving passphrase state. */
export function connectSelectedDevice(selected: Pick<TrezorSessionIdentity, 'path' | 'instance'>) {
  return {
    path: asDeviceUniquePath(selected.path),
    state: undefined,
    instance: selected.instance,
  };
}
