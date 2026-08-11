import { describe, expect, it, vi } from 'vitest';
import {
  assertLedgerAppNetwork,
  assertLedgerSession,
  readLedgerAppIdentity,
} from '../../src/services/hardwareWallet/adapters/ledger/session';

function client(name: string, version: string) {
  return {
    getAppAndVersion: vi.fn().mockResolvedValue({ name, version, flags: 0 }),
  };
}

describe('Ledger Bitcoin app session identity', () => {
  it.each([
    ['Bitcoin', '2.1.0'],
    ['Bitcoin', '2.1.1'],
    ['Bitcoin', '2.2.0'],
    ['Bitcoin', '2.4.2'],
    ['Bitcoin Test', '3.0.0'],
    ['Bitcoin Test', '10.0.0'],
  ])('accepts the exact supported app identity %s %s', async (name, version) => {
    await expect(readLedgerAppIdentity(client(name, version) as never))
      .resolves.toEqual({ name, version });
  });

  it.each([
    ['Bitcoin Legacy', '2.4.2'],
    ['Bitcoin Test Legacy', '2.4.2'],
    ['Ethereum', '2.4.2'],
    ['', '2.4.2'],
  ])('rejects wrong or legacy app identity %j', async (name, version) => {
    await expect(readLedgerAppIdentity(client(name, version) as never))
      .rejects.toThrow(/open the Bitcoin or Bitcoin Test app/);
  });

  it.each(['2.0.9', '1.6.6', '2.1', 'latest', ''])('rejects unsupported version %j', async (version) => {
    await expect(readLedgerAppIdentity(client('Bitcoin', version) as never))
      .rejects.toThrow(/unsupported|invalid version/);
  });

  it('propagates app metadata transport failure instead of guessing a session', async () => {
    const appClient = { getAppAndVersion: vi.fn().mockRejectedValue(new Error('APDU unavailable')) };
    await expect(readLedgerAppIdentity(appClient as never)).rejects.toThrow('APDU unavailable');
  });

  it('binds mainnet only to Bitcoin and test-family only to Bitcoin Test', async () => {
    const mainnet = { name: 'Bitcoin', version: '2.4.2' };
    const testnet = { name: 'Bitcoin Test', version: '2.4.2' };
    expect(() => assertLedgerAppNetwork(mainnet, 'mainnet')).not.toThrow();
    expect(() => assertLedgerAppNetwork(testnet, 'testnet')).not.toThrow();
    expect(() => assertLedgerAppNetwork(mainnet, 'testnet')).toThrow(/Bitcoin Test app is required/);
    expect(() => assertLedgerAppNetwork(testnet, 'mainnet')).toThrow(/Bitcoin app is required/);
  });

  it('re-reads the running app for each operation session check', async () => {
    const appClient = client('Bitcoin Test', '2.4.2');
    await expect(assertLedgerSession(appClient as never, 'testnet')).resolves.toEqual({
      name: 'Bitcoin Test', version: '2.4.2',
    });
    expect(appClient.getAppAndVersion).toHaveBeenCalledOnce();
  });
});
