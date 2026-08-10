import { describe, expect, it } from 'vitest';

import {
  MATRIX_ACCOUNTS,
  MATRIX_BRANCHES,
  MATRIX_CHAINS,
  MATRIX_INDICES,
  assertProductionPolicyOracle,
  generateDerivationTestCases,
} from '../../scripts/verify-addresses/testCases';
import {
  OFFICIAL_BIP_ANCHORS,
  STANDARD_POLICY_ORACLE,
  derivationFamilyForChain,
  expectedAccountPath,
  expectedSlip132Format,
} from '../../scripts/verify-addresses/standardsOracle';
import { EXPECTED_DERIVATION_CASE_COUNT } from '../../scripts/verify-addresses/types';
import {
  WALLET_POLICY_REGISTRY,
  buildCanonicalAccountPathForFamily,
  type WalletPolicyRow,
} from '../../shared/constants/walletPolicy';
import {
  VERIFIED_SINGLESIG_VECTORS,
} from '../../scripts/verify-addresses/output/verified-vectors';

describe('address verification derivation matrix', () => {
  const cases = generateDerivationTestCases();

  it('is an exact, unique 480-case seed-to-address contract', () => {
    expect(cases).toHaveLength(EXPECTED_DERIVATION_CASE_COUNT);
    expect(new Set(cases.map(testCase => testCase.id)).size).toBe(cases.length);
    expect(new Set(cases.map(testCase => testCase.chain))).toEqual(new Set(MATRIX_CHAINS));
    expect(new Set(cases.map(testCase => testCase.account))).toEqual(new Set(MATRIX_ACCOUNTS));
    expect(new Set(cases.map(testCase => testCase.branch))).toEqual(new Set(MATRIX_BRANCHES));
    expect(new Set(cases.map(testCase => testCase.index))).toEqual(new Set(MATRIX_INDICES));
  });

  it('contains every exact policy/chain/account/quorum/branch/index coordinate once', () => {
    const expectedIds = STANDARD_POLICY_ORACLE.flatMap(policy => MATRIX_CHAINS.flatMap(chain => (
      MATRIX_ACCOUNTS.flatMap(account => {
        const coordinates = MATRIX_BRANCHES.flatMap(branch => MATRIX_INDICES.map(index => ({ branch, index })));
        if (policy.kind === 'single_sig') {
          return coordinates.map(({ branch, index }) => (
            `ss:${policy.id}:${chain}:a${account}:b${branch}:i${index}`
          ));
        }
        return ([{ threshold: 2, totalKeys: 3 }, { threshold: 3, totalKeys: 5 }] as const)
          .flatMap(({ threshold, totalKeys }) => coordinates.map(({ branch, index }) => (
            `ms:${policy.id}:${chain}:a${account}:q${threshold}of${totalKeys}:b${branch}:i${index}`
          )));
      })
    )));
    expect(cases.map(testCase => testCase.id).sort()).toEqual(expectedIds.sort());
  });

  it('covers all supported policies and excludes unsupported legacy multisig', () => {
    expect(new Set(cases.filter(item => item.kind === 'single_sig').map(item => item.scriptType)))
      .toEqual(new Set(['legacy', 'nested_segwit', 'native_segwit', 'taproot']));
    expect(new Set(cases.filter(item => item.kind === 'multisig').map(item => item.scriptType)))
      .toEqual(new Set(['p2sh_p2wsh', 'p2wsh']));
    expect(cases.some(item => item.scriptType === ('p2sh' as never))).toBe(false);
  });

  it('uses the exact standards-owned account path and SLIP-132 format', () => {
    for (const testCase of cases) {
      const policy = STANDARD_POLICY_ORACLE.find(item => item.id === testCase.policyId)!;
      const family = derivationFamilyForChain(testCase.chain);
      expect(testCase.accountPath).toBe(expectedAccountPath(policy, family, testCase.account));
      expect(testCase.slip132Format).toBe(expectedSlip132Format(testCase.scriptType, family));
    }
  });

  it('pins literal paths independently of production path construction', () => {
    expect(Object.fromEntries(STANDARD_POLICY_ORACLE.map(policy => [policy.id, policy.paths]))).toEqual({
      'single-sig-legacy-bip44-v1': { mainnet: ["m/44'/0'/0'", "m/44'/0'/7'"], testnet: ["m/44'/1'/0'", "m/44'/1'/7'"] },
      'single-sig-nested-segwit-bip49-v1': { mainnet: ["m/49'/0'/0'", "m/49'/0'/7'"], testnet: ["m/49'/1'/0'", "m/49'/1'/7'"] },
      'single-sig-native-segwit-bip84-v1': { mainnet: ["m/84'/0'/0'", "m/84'/0'/7'"], testnet: ["m/84'/1'/0'", "m/84'/1'/7'"] },
      'single-sig-taproot-bip86-v1': { mainnet: ["m/86'/0'/0'", "m/86'/0'/7'"], testnet: ["m/86'/1'/0'", "m/86'/1'/7'"] },
      'multisig-nested-segwit-bip48-1-v1': { mainnet: ["m/48'/0'/0'/1'", "m/48'/0'/7'/1'"], testnet: ["m/48'/1'/0'/1'", "m/48'/1'/7'/1'"] },
      'multisig-native-segwit-bip48-2-v1': { mainnet: ["m/48'/0'/0'/2'", "m/48'/0'/7'/2'"], testnet: ["m/48'/1'/0'/2'", "m/48'/1'/7'/2'"] },
    });
  });

  it('matches literal official BIP49, BIP84, and BIP86 known-answer anchors', () => {
    for (const anchor of OFFICIAL_BIP_ANCHORS) {
      const vector = VERIFIED_SINGLESIG_VECTORS.find(item => item.caseId === anchor.caseId);
      expect(vector, anchor.source).toBeDefined();
      expect(vector).toMatchObject({
        path: anchor.accountPath,
        xpub: anchor.accountPublicKey,
        expectedAddress: anchor.address,
        expectedScriptPubKey: anchor.scriptPubKey,
      });
    }
  });

  it.each([
    ['purpose', (rows: typeof WALLET_POLICY_REGISTRY) => rows.map(row => (
      row.id === 'single-sig-taproot-bip86-v1' ? { ...row, purpose: 84 as const } : row
    ))],
    ['descriptor wrapper', (rows: typeof WALLET_POLICY_REGISTRY) => rows.map(row => (
      row.id === 'single-sig-taproot-bip86-v1' ? { ...row, descriptorWrapper: 'wpkh' as const } : row
    ))],
    ['account purpose', (rows: typeof WALLET_POLICY_REGISTRY) => rows.map(row => (
      row.id === 'single-sig-taproot-bip86-v1' ? { ...row, accountPurpose: 'multisig' as const } : row
    ))],
  ] as const)('rejects production %s mutation without regenerating anchors', (_label, mutate) => {
    const mutatedRows: readonly WalletPolicyRow[] = mutate(WALLET_POLICY_REGISTRY);
    expect(mutatedRows).toHaveLength(WALLET_POLICY_REGISTRY.length);
    expect(() => assertProductionPolicyOracle(mutatedRows)).toThrow('standards oracle');
  });

  it.each([
    ['coin type', (path: string) => path.replace("/0'/", "/1'/")],
    ['account', (path: string) => path.replace(/\/(0|7)'(?=(?:\/[12]')?$)/, "/9'")],
    ['hardening', (path: string) => path.replace("86'", '86')],
  ])('rejects production %s path mutation without regenerating anchors', (_label, mutate) => {
    expect(() => assertProductionPolicyOracle(
      WALLET_POLICY_REGISTRY,
      options => mutate(buildCanonicalAccountPathForFamily(options)),
    )).toThrow('account path drifted');
  });
});
