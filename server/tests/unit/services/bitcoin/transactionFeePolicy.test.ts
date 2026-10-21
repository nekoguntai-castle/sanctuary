import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  convertToStandardXpub,
  convertXpubToFormat,
} from '../../../../src/services/bitcoin/addressDerivation/xpubConversion';
import { getNetwork } from '../../../../src/services/bitcoin/addressDerivation/utils';
import {
  createTransactionSpendPolicyResolver,
  resolveTransactionSpendPolicy,
  transactionChangeScriptTemplate,
} from '../../../../src/services/bitcoin/transactions/feePolicy';
import type { WalletSigningInfo } from '../../../../src/services/bitcoin/transactions/types';
import { testMultisigKeys } from './psbtBuilderTestFixtures';
import { VERIFIED_SINGLESIG_VECTORS } from '../../../fixtures/verified-address-vectors';

const network = bitcoin.networks.testnet;
const hardened = (index: number): number => index + 0x80000000;

function accountXpub(): string {
  let node = bip32.fromSeed(Buffer.alloc(32, 17), network);
  for (const index of [hardened(49), hardened(1), hardened(0)]) node = node.derive(index);
  return node.neutered().toBase58();
}

const SLIP132_NESTED = VERIFIED_SINGLESIG_VECTORS.filter(
  v => v.scriptType === 'nested_segwit' && /^[yu]pub/.test(v.xpub),
);

function signingInfo(overrides: Partial<WalletSigningInfo> = {}): WalletSigningInfo {
  return {
    isMultisig: false,
    scriptType: WalletScriptType.NATIVE_SEGWIT,
    ...overrides,
  };
}

describe('transaction fee spend-policy resolution', () => {
  beforeEach(() => resetPrismaMocks());

  it.each([
    [WalletScriptType.LEGACY, 'p2pkh', 25],
    [WalletScriptType.NATIVE_SEGWIT, 'p2wpkh', 22],
    [WalletScriptType.TAPROOT, 'p2tr-keypath', 34],
  ] as const)('maps %s to its exact spend and change policy', (scriptType, policy, changeLength) => {
    const info = signingInfo({ scriptType });
    expect(resolveTransactionSpendPolicy(info, "m/84'/1'/0'/0/0", network).spendPolicy.type)
      .toBe(policy);
    expect(transactionChangeScriptTemplate(info)).toHaveLength(changeLength);
  });

  it('derives nested SegWit evidence from the account xpub and unhardened suffix', () => {
    const info = signingInfo({
      scriptType: WalletScriptType.NESTED_SEGWIT,
      accountXpub: accountXpub(),
      accountPath: "m/49'/1'/0'",
    });
    const evidence = resolveTransactionSpendPolicy(info, "m/49h/1h/0h/1/7", network);

    expect(evidence.spendPolicy.type).toBe('p2sh-p2wpkh');
    expect(evidence.redeemScript).toHaveLength(22);
    expect(transactionChangeScriptTemplate(info)).toHaveLength(23);

    expect(() => resolveTransactionSpendPolicy(info, 'm/0/7', network))
      .toThrow(/address path does not match signer account/i);
  });

  it('selects every SLIP-132 nested SegWit vector', () => {
    expect(SLIP132_NESTED).toHaveLength(60);
  });

  it.each(SLIP132_NESTED)('derives nested SegWit evidence from SLIP-132 signer xpub $caseId', (v) => {
    const vectorNetwork = getNetwork(v.network);
    const info = signingInfo({
      scriptType: WalletScriptType.NESTED_SEGWIT,
      accountXpub: v.xpub,
      accountPath: v.path,
    });
    const path = `${v.path}/${v.branch}/${v.index}`;
    const evidence = resolveTransactionSpendPolicy(info, path, vectorNetwork);

    expect(evidence.spendPolicy.type).toBe('p2sh-p2wpkh');
    expect(Buffer.from(bitcoin.payments.p2sh({ redeem: { output: evidence.redeemScript! } }).output!).toString('hex'))
      .toBe(v.expectedScriptPubKey);
    expect(evidence).toEqual(resolveTransactionSpendPolicy(
      { ...info, accountXpub: convertToStandardXpub(v.xpub) },
      path,
      vectorNetwork,
    ));
  });

  it('keeps the network check for a SLIP-132 nested SegWit xpub on the wrong network', () => {
    const mainnetVector = SLIP132_NESTED.find(
      v => v.caseId === 'ss:single-sig-nested-segwit-bip49-v1:mainnet:a0:b0:i0',
    )!;
    const info = signingInfo({
      scriptType: WalletScriptType.NESTED_SEGWIT,
      accountXpub: mainnetVector.xpub,
      accountPath: "m/49'/1'/0'",
    });

    expect(() => resolveTransactionSpendPolicy(info, "m/49'/1'/0'/0/0", bitcoin.networks.testnet))
      .toThrow('Invalid network version');
  });

  it('fails closed when nested SegWit has no account xpub', () => {
    expect(() => resolveTransactionSpendPolicy(
      signingInfo({ scriptType: WalletScriptType.NESTED_SEGWIT }),
      "m/49'/1'/0'/0/0",
      network,
    )).toThrow('account xpub is missing');
  });

  it('fails closed when nested SegWit has no signer account origin', () => {
    expect(() => resolveTransactionSpendPolicy(
      signingInfo({
        scriptType: WalletScriptType.NESTED_SEGWIT,
        accountXpub: accountXpub(),
      }),
      "m/49'/1'/0'/0/0",
      network,
    )).toThrow('signer account origin is missing');
  });

  it.each([
    ['wsh-sortedmulti', 'p2wsh-sortedmulti', 34],
    ['sh-wsh-sortedmulti', 'p2sh-p2wsh-sortedmulti', 23],
  ] as const)('resolves exact %s multisig evidence', (multisigScriptType, policy, changeLength) => {
    const info = signingInfo({
      isMultisig: true,
      multisigKeys: testMultisigKeys,
      multisigQuorum: 2,
      multisigScriptType,
    });
    const evidence = resolveTransactionSpendPolicy(info, "m/48'/1'/0'/2'/0/3", network);

    expect(evidence.spendPolicy.type).toBe(policy);
    expect(evidence.witnessScript).toBeDefined();
    if (multisigScriptType === 'sh-wsh-sortedmulti') {
      expect(evidence.redeemScript).toHaveLength(34);
    } else {
      expect(evidence.redeemScript).toBeUndefined();
    }
    expect(transactionChangeScriptTemplate(info)).toHaveLength(changeLength);
  });

  it.each(['Vpub', 'Upub'] as const)('multisig %s signer keys produce the same witness evidence as tpub keys', (format) => {
    const multisigScriptType = format === 'Vpub' ? 'wsh-sortedmulti' : 'sh-wsh-sortedmulti';
    const path = "m/48'/1'/0'/2'/0/3";
    const evidenceFor = (multisigKeys: typeof testMultisigKeys) => resolveTransactionSpendPolicy(
      signingInfo({ isMultisig: true, multisigKeys, multisigQuorum: 2, multisigScriptType }),
      path,
      network,
    );
    const slip132Keys = testMultisigKeys.map(key => ({ ...key, xpub: convertXpubToFormat(key.xpub, format) }));

    expect(evidenceFor(slip132Keys)).toEqual(evidenceFor(testMultisigKeys));
  });

  it('rejects incomplete and unsupported multisig policies', () => {
    const incomplete = signingInfo({ isMultisig: true });
    expect(() => resolveTransactionSpendPolicy(incomplete, "m/48'/1'/0'/2'/0/0", network))
      .toThrow('multisig policy is incomplete');
    expect(() => transactionChangeScriptTemplate(incomplete)).toThrow('multisig policy is incomplete');

    const unsupported = signingInfo({
      isMultisig: true,
      multisigKeys: testMultisigKeys,
      multisigQuorum: 2,
    });
    expect(() => resolveTransactionSpendPolicy(unsupported, "m/48'/1'/0'/2'/0/0", network))
      .toThrow('multisig script policy is unsupported');
    expect(() => transactionChangeScriptTemplate(unsupported))
      .toThrow('multisig script policy is unsupported');
  });

  it('deduplicates address lookups and rejects missing derivation evidence', async () => {
    const info = signingInfo({ scriptType: WalletScriptType.NATIVE_SEGWIT });
    mockPrismaClient.address.findMany.mockResolvedValueOnce([
      { address: 'a', derivationPath: "m/84'/1'/0'/0/1" },
      { address: 'b', derivationPath: "m/84'/1'/0'/0/2" },
    ]);
    const resolver = createTransactionSpendPolicyResolver('wallet-1', info, network);
    const resolved = await resolver([{ address: 'a' }, { address: 'a' }, { address: 'b' }]);

    expect(mockPrismaClient.address.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ address: { in: ['a', 'b'] } }),
    }));
    expect([...resolved.keys()]).toEqual(['a', 'b']);

    mockPrismaClient.address.findMany.mockResolvedValueOnce([]);
    await expect(resolver([{ address: 'missing' }])).rejects.toThrow(
      'derivation path is missing for missing',
    );
  });
});
