import { describe, expect, it } from 'vitest';
import {
  WALLET_POLICY_MANIFEST_ID,
  WALLET_POLICY_REGISTRY,
  WALLET_POLICY_REGISTRY_VERSION,
  accountPathMatchesWalletPolicy,
  assertCanonicalAddressCoordinate,
  assertCanonicalAddressRange,
  buildCanonicalAccountPath,
  buildCanonicalAddressPath,
  chainEnvironmentToDerivationFamily,
  coinTypeForDerivationFamily,
  findWalletPolicy,
  parseCanonicalAccountPath,
  parseCanonicalAddressPath,
  renderDescriptorWrapper,
} from '@sanctuary/shared/constants/walletPolicy';

describe('canonical wallet policy registry', () => {
  it('has a stable versioned identity and immutable policy rows', () => {
    expect(WALLET_POLICY_REGISTRY_VERSION).toBe(1);
    expect(WALLET_POLICY_MANIFEST_ID).toBe('sanctuary-wallet-policy-v1');
    expect(Object.isFrozen(WALLET_POLICY_REGISTRY)).toBe(true);
    expect(WALLET_POLICY_REGISTRY.every(Object.isFrozen)).toBe(true);
    expect(WALLET_POLICY_REGISTRY.map(row => row.id)).toEqual([
      'single-sig-legacy-bip44-v1',
      'single-sig-nested-segwit-bip49-v1',
      'single-sig-native-segwit-bip84-v1',
      'single-sig-taproot-bip86-v1',
      'multisig-nested-segwit-bip48-1-v1',
      'multisig-native-segwit-bip48-2-v1',
    ]);
  });

  it('contains only the supported single-sig and multisig combinations', () => {
    expect(findWalletPolicy('single_sig', 'legacy')?.purpose).toBe(44);
    expect(findWalletPolicy('single_sig', 'nested_segwit')?.purpose).toBe(49);
    expect(findWalletPolicy('single_sig', 'native_segwit')?.purpose).toBe(84);
    expect(findWalletPolicy('single_sig', 'taproot')?.purpose).toBe(86);
    expect(findWalletPolicy('multi_sig', 'nested_segwit')?.bip48ScriptType).toBe(1);
    expect(findWalletPolicy('multi_sig', 'native_segwit')?.bip48ScriptType).toBe(2);
    expect(findWalletPolicy('multi_sig', 'legacy')).toBeNull();
    expect(findWalletPolicy('multi_sig', 'taproot')).toBeNull();
  });

  it('renders every registry wrapper without duplicating descriptor syntax', () => {
    expect(WALLET_POLICY_REGISTRY.map(policy =>
      renderDescriptorWrapper(policy.descriptorWrapper, 'KEY')
    )).toEqual([
      'pkh(KEY)',
      'sh(wpkh(KEY))',
      'wpkh(KEY)',
      'tr(KEY)',
      'sh(wsh(KEY))',
      'wsh(KEY)',
    ]);
  });

  it('separates exact chain environments from the two derivation families', () => {
    expect(chainEnvironmentToDerivationFamily('mainnet')).toBe('mainnet');
    for (const network of ['testnet3', 'testnet4', 'signet', 'regtest'] as const) {
      expect(chainEnvironmentToDerivationFamily(network)).toBe('testnet');
    }
    expect(chainEnvironmentToDerivationFamily('testnet')).toBeNull();
    expect(chainEnvironmentToDerivationFamily('unknown')).toBeNull();
    expect(() => coinTypeForDerivationFamily('unknown' as 'mainnet')).toThrow(
      /unknown derivation network family/i,
    );
  });

  it('builds exact account paths for every policy and derivation family', () => {
    expect(buildCanonicalAccountPath({
      walletType: 'single_sig', scriptType: 'taproot', chainEnvironment: 'signet', account: 7,
    })).toBe("m/86'/1'/7'");
    expect(buildCanonicalAccountPath({
      walletType: 'multi_sig', scriptType: 'native_segwit', chainEnvironment: 'mainnet', account: 0,
    })).toBe("m/48'/0'/0'/2'");
    expect(() => buildCanonicalAccountPath({
      walletType: 'multi_sig', scriptType: 'taproot', chainEnvironment: 'mainnet', account: 0,
    })).toThrow(/unsupported wallet policy/i);
    expect(() => buildCanonicalAccountPath({
      walletType: 'single_sig', scriptType: 'native_segwit',
      chainEnvironment: 'unknown' as 'mainnet', account: 0,
    })).toThrow(/unknown chain environment/i);
    for (const account of [-1, 1.5, Number.NaN, 0x80000000]) {
      expect(() => buildCanonicalAccountPath({
        walletType: 'single_sig', scriptType: 'native_segwit', chainEnvironment: 'mainnet', account,
      })).toThrow(/account/i);
    }

    for (const policy of WALLET_POLICY_REGISTRY) {
      for (const chainEnvironment of ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const) {
        const path = buildCanonicalAccountPath({
          walletType: policy.walletType,
          scriptType: policy.scriptType,
          chainEnvironment,
          account: 19,
        });
        expect(parseCanonicalAccountPath(path), `${policy.id}:${chainEnvironment}`).toMatchObject({
          policyId: policy.id,
          account: 19,
          derivationFamily: chainEnvironment === 'mainnet' ? 'mainnet' : 'testnet',
        });
      }
    }
  });

  it('strictly validates account paths and optional policy expectations', () => {
    expect(parseCanonicalAccountPath(null)).toBeNull();
    expect(parseCanonicalAccountPath("m/48'/1'/2147483647'/1'")).toMatchObject({
      policyId: 'multisig-nested-segwit-bip48-1-v1',
      derivationFamily: 'testnet',
      account: 2147483647,
    });
    expect(accountPathMatchesWalletPolicy("m/84'/0'/2'", {
      walletType: 'single_sig', scriptType: 'native_segwit', chainEnvironment: 'mainnet',
    })).toBe(true);
    expect(accountPathMatchesWalletPolicy("m/84'/1'/2'", {
      walletType: 'single_sig', scriptType: 'native_segwit', chainEnvironment: 'signet',
    })).toBe(true);
    expect(accountPathMatchesWalletPolicy("m/84'/0'/2'", {
      walletType: 'single_sig', scriptType: 'native_segwit', derivationFamily: 'mainnet',
    })).toBe(true);
    expect(accountPathMatchesWalletPolicy("m/84'/1'/2'", {
      walletType: 'single_sig', scriptType: 'native_segwit', derivationFamily: 'mainnet',
    })).toBe(false);
    expect(accountPathMatchesWalletPolicy("m/84'/0'/2'", {
      walletType: 'multi_sig', scriptType: 'native_segwit', derivationFamily: 'mainnet',
    })).toBe(false);
    expect(accountPathMatchesWalletPolicy("m/84'/0'/2'", {
      walletType: 'single_sig', scriptType: 'taproot', derivationFamily: 'mainnet',
    })).toBe(false);
    expect(accountPathMatchesWalletPolicy("m/84'/0'/2'", {
      walletType: 'single_sig', scriptType: 'native_segwit', chainEnvironment: 'unknown' as 'mainnet',
    })).toBe(false);

    for (const path of [
      "m/45'/0'/0'", "m/48'/0'/0'/3'", "m/48'/0'/0'", "m/44'/0'/0'/0'",
      "m/84/0'/0'", "m/84'/0/0'", "m/84'/0'/0", "m/84'/0'/00'",
      "m/84'/0'/-1'", "m/84'/0'/2147483648'", "m/84'/2'/0'", "m/84'/0'/0'/0",
      "prefix/m/84'/0'/0'", "m/84'/0'/0'/suffix",
    ]) {
      expect(parseCanonicalAccountPath(path), path).toBeNull();
    }
  });

  it('strictly validates wallet-relative branch and address index coordinates', () => {
    expect(parseCanonicalAddressPath(null)).toBeNull();
    expect(buildCanonicalAddressPath("m/84'/0'/3'", 1, 2147483647)).toBe(
      "m/84'/0'/3'/1/2147483647",
    );
    expect(parseCanonicalAddressPath("m/48'/1'/9'/2'/0/0")).toMatchObject({
      branch: 0,
      index: 0,
      accountPath: "m/48'/1'/9'/2'",
    });
    for (const path of [
      "m/84'/0'/0'/2/0", "m/84'/0'/0'/0'/0", "m/84'/0'/0'/0/0'",
      "m/84'/0'/0'/0/00", "m/84'/0'/0'/0/2147483648", "m/84'/0'/0'/0",
      "prefix/m/84'/0'/0'/0/0", "m/84'/0'/0'/0/0/suffix",
      "m/84'/0'/0'/0/10junk",
    ]) {
      expect(parseCanonicalAddressPath(path), path).toBeNull();
    }
    expect(() => buildCanonicalAddressPath("m/84'/0'/0'", 2 as 0, 0)).toThrow(/branch/i);
    expect(() => buildCanonicalAddressPath("m/84'/0'/0'", 0, 1.5)).toThrow(/index/i);
    expect(() => buildCanonicalAddressPath('not-a-path', 0, 0)).toThrow(/account path/i);
  });

  it('rejects every non-canonical account, branch, and address index', () => {
    expect(assertCanonicalAddressCoordinate({ account: 7, branch: 1, index: 2147483647 }))
      .toEqual({ account: 7, branch: 1, index: 2147483647 });

    const invalidChildren: unknown[] = [
      -1, 0.5, 0x80000000, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY,
      Number.NaN, '0', null, undefined,
    ];
    for (const value of invalidChildren) {
      expect(() => assertCanonicalAddressCoordinate({ account: value, branch: 0, index: 0 }))
        .toThrow(/coordinate/i);
      expect(() => assertCanonicalAddressCoordinate({ account: 0, branch: 0, index: value }))
        .toThrow(/coordinate/i);
    }
    for (const branch of [-1, 2, 0.5, Number.NaN, '0', null, undefined]) {
      expect(() => assertCanonicalAddressCoordinate({ account: 0, branch, index: 0 }))
        .toThrow(/coordinate/i);
    }
  });

  it('validates address ranges atomically at the unhardened boundary', () => {
    expect(assertCanonicalAddressRange(0, 0)).toEqual({ startIndex: 0, count: 0 });
    expect(assertCanonicalAddressRange(2147483647, 1)).toEqual({
      startIndex: 2147483647,
      count: 1,
    });
    for (const [startIndex, count] of [
      [-1, 1], [0.5, 1], [2147483647, 2], [0, -1], [0, 0.5],
      [Number.NaN, 1], [0, Number.NaN], [0, '1'],
    ]) {
      expect(() => assertCanonicalAddressRange(startIndex, count)).toThrow(/range/i);
    }
  });
});
