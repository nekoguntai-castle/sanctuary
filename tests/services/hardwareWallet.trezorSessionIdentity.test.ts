import { describe, expect, it, vi } from 'vitest';

vi.mock('@trezor/connect-web', () => ({
  asDeviceUniquePath: (path: string) => `unique:${path}`,
}));

import {
  assertSessionIdentity,
  connectDevice,
  requireResolvedSession,
  requireSelectedDevice,
} from '../../src/services/hardwareWallet/adapters/trezor/sessionIdentity';

const SESSION = {
  path: 'bridge:device-1',
  state: 'static-state@device-1:0',
  instance: 0,
} as const;

describe('Trezor selected session identity', () => {
  it('requires an unambiguous selected device path and wallet instance', () => {
    expect(() => requireSelectedDevice(undefined)).toThrow(
      'did not identify the selected device path'
    );
    expect(() => requireSelectedDevice({ path: '', instance: 0 })).toThrow('did not identify');
    expect(() => requireSelectedDevice({ path: SESSION.path, instance: -1 })).toThrow(
      'invalid wallet instance'
    );
    expect(() => requireSelectedDevice({ path: SESSION.path })).toThrow('invalid wallet instance');
    expect(requireSelectedDevice({ path: SESSION.path, instance: 0 })).toEqual({
      path: SESSION.path,
      instance: 0,
    });
  });

  it('requires a resolved static passphrase state from the same response identity', () => {
    const selected = { path: SESSION.path, instance: 0 };
    expect(() =>
      requireResolvedSession(selected, undefined, {
        path: SESSION.path,
        instance: 0,
      })
    ).toThrow('did not resolve the passphrase state');
    expect(
      requireResolvedSession(selected, SESSION.state, {
        path: SESSION.path,
        instance: 0,
        state: { staticSessionId: SESSION.state },
      })
    ).toEqual(SESSION);
    expect(
      requireResolvedSession(
        selected,
        { staticSessionId: SESSION.state },
        {
          path: SESSION.path,
          instance: 0,
          state: SESSION.state,
        }
      )
    ).toEqual(SESSION);
    expect(() =>
      requireResolvedSession(
        selected,
        { staticSessionId: '' },
        {
          path: SESSION.path,
          instance: 0,
          state: { staticSessionId: 7 },
        }
      )
    ).toThrow('did not resolve the passphrase state');
  });

  it.each([
    [undefined, 'omitted the response device identity'],
    [{ path: SESSION.path, state: SESSION.state }, 'invalid wallet instance'],
    [{ path: SESSION.path, instance: 0 }, 'omitted the response passphrase state'],
    [{ ...SESSION, path: 'bridge:device-2' }, 'device path or wallet instance changed'],
    [{ ...SESSION, instance: 1 }, 'device path or wallet instance changed'],
    [{ ...SESSION, state: 'different-state' }, 'passphrase state changed'],
  ])('rejects missing or changed response identity %#', (response, message) => {
    expect(() => assertSessionIdentity(response, SESSION)).toThrow(message);
  });

  it('passes the exact selected identity to every subsequent Connect request', () => {
    expect(connectDevice(SESSION)).toEqual({
      path: `unique:${SESSION.path}`,
      state: SESSION.state,
      instance: SESSION.instance,
    });
  });
});
