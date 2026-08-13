import { beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
/**
 * Advanced Transaction Test Harness
 *
 * Shared mocks and default setup for RBF/CPFP advanced transaction contract tests.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../../mocks/electrum';
import { testnetAddresses } from '../../../../fixtures/bitcoin';

const mockBindPsbtAccount = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: vi.fn().mockResolvedValue(undefined),
  assertCanonicalAddressesMatchWallet: vi.fn(),
}));

vi.mock('../../../../../src/services/bitcoin/psbtAccountBinding', () => ({
  bindPsbtAccount: mockBindPsbtAccount,
}));

export const TEST_ACCOUNT_XPUB =
  'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';

export function rawTransactionWithOutput(
  scriptPubKey: string,
  valueSats: number,
  address?: string,
) {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32), 0xffffffff);
  transaction.addOutput(Buffer.from(scriptPubKey, 'hex'), BigInt(valueSats));
  return {
    transaction,
    response: {
      txid: transaction.getId(),
      hex: transaction.toHex(),
      vin: [],
      vout: [{
        value: valueSats / 100_000_000,
        n: 0,
        scriptPubKey: { hex: scriptPubKey, ...(address && { address }) },
      }],
    },
  };
}

export function immutableSignerLink(overrides: Record<string, unknown> = {}) {
  return {
    signerBindingVersion: 1,
    signerIndex: 0,
    signerFingerprint: 'aabbccdd',
    signerXpub: TEST_ACCOUNT_XPUB,
    signerDerivationPath: "m/84'/1'/0'",
    deviceAccountId: 'account-1',
    deviceId: 'device-1',
    device: {
      id: 'device-1',
      fingerprint: 'aabbccdd',
      xpub: TEST_ACCOUNT_XPUB,
    },
    ...overrides,
  };
}

export function advancedSignableWallet(
  id: string,
  scriptType: 'native_segwit' | 'legacy' = 'native_segwit',
) {
  const purpose = scriptType === 'legacy' ? 44 : 84;
  const wrapper = scriptType === 'legacy' ? 'pkh' : 'wpkh';
  const descriptorKey = `[aabbccdd/${purpose}'/1'/0']${TEST_ACCOUNT_XPUB}`;
  return {
    id,
    type: 'single_sig',
    network: 'testnet3',
    scriptType,
    descriptor: `${wrapper}(${descriptorKey}/0/*)`,
    changeDescriptor: `${wrapper}(${descriptorKey}/1/*)`,
    canonicalPolicyId: scriptType === 'legacy'
      ? 'single-sig-legacy-bip44-v1'
      : 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    devices: [immutableSignerLink({ signerDerivationPath: `m/${purpose}'/1'/0'` })],
  };
}

export function rejectNextPsbtBinding(message: string): void {
  mockBindPsbtAccount.mockRejectedValueOnce(new Error(message));
}

const boundSigningContext = (walletId: string, network = 'testnet3') => ({
  version: 1,
  walletId,
  network,
  walletType: 'single_sig',
  scriptType: 'native_segwit',
  canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
  canonicalPolicyVersion: 1,
  descriptorDigest: 'c'.repeat(64),
  unsignedTransactionDigest: 'd'.repeat(64),
  signers: [{
    signerIndex: 0,
    deviceId: 'device-1',
    deviceAccountId: 'account-1',
    masterFingerprint: 'aabbccdd',
    accountPath: "m/84'/1'/0'",
    accountXpub: TEST_ACCOUNT_XPUB,
  }],
  inputs: [{
    inputIndex: 0,
    txid: 'e'.repeat(64),
    vout: 0,
    amountSats: '10000',
    scriptPubKey: `0014${'aa'.repeat(20)}`,
    addressPath: "m/84'/1'/0'/0/0",
    signerOrigins: [{
      masterFingerprint: 'aabbccdd',
      path: "m/84'/1'/0'/0/0",
      pubkey: `02${'11'.repeat(32)}`,
    }],
  }],
  changeOutputs: [],
});

export function resolveNextPsbtBindingNetwork(network: string): void {
  mockBindPsbtAccount.mockImplementationOnce(async (walletId: string) => (
    boundSigningContext(walletId, network)
  ));
}

export function registerAdvancedTxTestSetup() {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    mockElectrumClient.getTransaction.mockReset();

    // Default system settings
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
      key: 'dustThreshold',
      value: '546',
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue(advancedSignableWallet('advanced-wallet'));
    mockPrismaClient.address.findMany.mockImplementation((query: any) => {
      const addresses: string[] = query?.where?.address?.in ?? [];
      return Promise.resolve(addresses.map((address, index) => ({
        address,
        derivationPath: `m/84'/1'/0'/0/${index}`,
      })));
    });
    mockPrismaClient.address.findFirst.mockResolvedValue({
      id: 'change-0',
      walletId: 'advanced-wallet',
      address: testnetAddresses.nativeSegwit[1],
      derivationPath: "m/84'/1'/0'/1/0",
      index: 0,
      branch: 1,
      coordinateVersion: 1,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      scriptPubKey: Buffer.from(bitcoin.address.toOutputScript(
        testnetAddresses.nativeSegwit[1], bitcoin.networks.testnet,
      )).toString('hex'),
      used: false,
    });
    mockBindPsbtAccount.mockReset();
    mockBindPsbtAccount.mockImplementation(async (walletId: string) => (
      boundSigningContext(walletId)
    ));
  });
}
