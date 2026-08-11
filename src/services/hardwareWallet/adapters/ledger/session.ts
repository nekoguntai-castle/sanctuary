import type { AppClient } from '@ledgerhq/ledger-bitcoin';

export type LedgerBitcoinNetwork = 'mainnet' | 'testnet';

export interface LedgerAppIdentity {
  name: string;
  version: string;
}

const MINIMUM_APP_VERSION = [2, 1, 0] as const;
const APP_NAME_BY_NETWORK: Record<LedgerBitcoinNetwork, string> = {
  mainnet: 'Bitcoin',
  testnet: 'Bitcoin Test',
};

function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Ledger Bitcoin app returned an invalid version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isSupportedVersion(version: string): boolean {
  const actual = parseVersion(version);
  return actual.some((part, index) => (
    part > MINIMUM_APP_VERSION[index]
      && actual.slice(0, index).every((value, earlier) => value === MINIMUM_APP_VERSION[earlier])
  )) || actual.every((part, index) => part === MINIMUM_APP_VERSION[index]);
}

export async function readLedgerAppIdentity(appClient: AppClient): Promise<LedgerAppIdentity> {
  const info = await appClient.getAppAndVersion();
  if (!Object.values(APP_NAME_BY_NETWORK).includes(info.name)) {
    throw new Error(`Please open the Bitcoin or Bitcoin Test app on Ledger; found ${info.name || 'an unknown app'}`);
  }
  if (!isSupportedVersion(info.version)) {
    throw new Error(`Ledger ${info.name} app ${info.version} is unsupported; version 2.1.0 or newer is required`);
  }
  return { name: info.name, version: info.version };
}

export function assertLedgerAppNetwork(
  identity: LedgerAppIdentity,
  network: LedgerBitcoinNetwork,
): void {
  const expected = APP_NAME_BY_NETWORK[network];
  if (identity.name !== expected) {
    throw new Error(`${expected} app is required on Ledger for ${network}; found ${identity.name}`);
  }
}

export async function assertLedgerSession(
  appClient: AppClient,
  network: LedgerBitcoinNetwork,
): Promise<LedgerAppIdentity> {
  const identity = await readLedgerAppIdentity(appClient);
  assertLedgerAppNetwork(identity, network);
  return identity;
}
