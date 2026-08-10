import * as walletPolicyModule from '../../shared/constants/walletPolicy.js';
import type * as WalletPolicyModule from '../../shared/constants/walletPolicy.js';
import type { WalletPolicyRow } from '../../shared/constants/walletPolicy.js';
import {
  EXPECTED_DERIVATION_CASE_COUNT,
  type ChainEnvironment,
  type DerivationFamily,
  type DerivationTestCase,
  type MultisigScriptType,
  type SingleSigScriptType,
  type Slip132Format,
  type TestSeed,
  type WalletBranch,
} from './types.js';
import {
  STANDARD_POLICY_ORACLE,
  derivationFamilyForChain,
  expectedAccountPath,
  expectedSlip132Format,
} from './standardsOracle.js';

const walletPolicy = ('default' in walletPolicyModule
  ? walletPolicyModule.default
  : walletPolicyModule) as typeof WalletPolicyModule;
const { WALLET_POLICY_REGISTRY, buildCanonicalAccountPathForFamily } = walletPolicy;

export const TEST_SEEDS = Object.freeze([
  { id: 'bip39-abandon', mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
  { id: 'bip39-zoo', mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong' },
  { id: 'bip39-legal', mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' },
  { id: 'bip39-letter', mnemonic: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above' },
  { id: 'bip39-ozone', mnemonic: 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic' },
] as const satisfies readonly TestSeed[]);

export const TEST_MNEMONIC = TEST_SEEDS[0].mnemonic;
export const MATRIX_CHAINS = Object.freeze([
  'mainnet', 'testnet3', 'testnet4', 'signet', 'regtest',
] as const satisfies readonly ChainEnvironment[]);
export const MATRIX_ACCOUNTS = Object.freeze([0, 7] as const);
export const MATRIX_BRANCHES = Object.freeze([0, 1] as const satisfies readonly WalletBranch[]);
export const MATRIX_INDICES = Object.freeze([0, 1, 0x7fffffff] as const);

export function slip132FormatFor(
  scriptType: SingleSigScriptType | MultisigScriptType,
  family: DerivationFamily,
): Slip132Format {
  return expectedSlip132Format(scriptType, family);
}

const singlePolicies = STANDARD_POLICY_ORACLE.filter(policy => policy.kind === 'single_sig');
const multisigPolicies = STANDARD_POLICY_ORACLE.filter(policy => policy.kind === 'multi_sig');

export function assertProductionPolicyOracle(
  rows: readonly WalletPolicyRow[] = WALLET_POLICY_REGISTRY,
  buildPath: typeof buildCanonicalAccountPathForFamily = buildCanonicalAccountPathForFamily,
): void {
  if (rows.length !== STANDARD_POLICY_ORACLE.length) {
    throw new Error('Production wallet policy registry differs from the verifier standards oracle');
  }
  const productionById = new Map(rows.map(policy => [policy.id, policy]));
  for (const expected of STANDARD_POLICY_ORACLE) {
    const actual = productionById.get(expected.id);
    if (!actual
      || actual.walletType !== expected.kind
      || actual.accountPurpose !== expected.accountPurpose
      || actual.descriptorWrapper !== expected.descriptorWrapper
      || actual.scriptType !== expected.productionScriptType
      || actual.purpose !== expected.purpose
      || actual.bip48ScriptType !== expected.bip48ScriptType) {
      throw new Error(`Production wallet policy drifted from standards oracle: ${expected.id}`);
    }
    for (const family of ['mainnet', 'testnet'] as const) {
      for (const account of MATRIX_ACCOUNTS) {
        const actualPath = buildPath({
          walletType: actual.walletType,
          scriptType: actual.scriptType,
          derivationFamily: family,
          account,
        });
        if (actualPath !== expectedAccountPath(expected, family, account)) {
          throw new Error(`Production account path drifted from standards oracle: ${expected.id}/${family}/${account}`);
        }
      }
    }
  }
}

function singleSigCases(): DerivationTestCase[] {
  return singlePolicies.flatMap(policy => MATRIX_CHAINS.flatMap(chain => {
    const family = derivationFamilyForChain(chain);
    const scriptType = policy.scriptType;
    return MATRIX_ACCOUNTS.flatMap(account => {
      const accountPath = expectedAccountPath(policy, family, account);
      return MATRIX_BRANCHES.flatMap(branch => MATRIX_INDICES.map(index => ({
        id: `ss:${policy.id}:${chain}:a${account}:b${branch}:i${index}`,
        description: `${policy.displayName} ${chain} account ${account} branch ${branch} index ${index}`,
        kind: 'single_sig' as const,
        chain,
        derivationFamily: family,
        policyId: policy.id,
        scriptType,
        account,
        accountPath,
        branch,
        index,
        seedIds: [TEST_SEEDS[0].id] as const,
        slip132Format: slip132FormatFor(scriptType, family),
      })));
    });
  }));
}

function multisigCases(): DerivationTestCase[] {
  const quorums = [{ threshold: 2 as const, totalKeys: 3 as const }, { threshold: 3 as const, totalKeys: 5 as const }];
  return multisigPolicies.flatMap(policy => MATRIX_CHAINS.flatMap(chain => {
    const family = derivationFamilyForChain(chain);
    const scriptType = policy.scriptType;
    return MATRIX_ACCOUNTS.flatMap(account => {
      const accountPath = expectedAccountPath(policy, family, account);
      return quorums.flatMap(({ threshold, totalKeys }) => MATRIX_BRANCHES.flatMap(branch => (
        MATRIX_INDICES.map(index => ({
          id: `ms:${policy.id}:${chain}:a${account}:q${threshold}of${totalKeys}:b${branch}:i${index}`,
          description: `${policy.displayName} ${threshold}-of-${totalKeys} ${chain} account ${account} branch ${branch} index ${index}`,
          kind: 'multisig' as const,
          chain,
          derivationFamily: family,
          policyId: policy.id,
          scriptType,
          account,
          accountPath,
          branch,
          index,
          threshold,
          totalKeys,
          seedIds: TEST_SEEDS.slice(0, totalKeys).map(seed => seed.id),
          slip132Format: slip132FormatFor(scriptType, family),
        }))
      )));
    });
  }));
}

export function generateDerivationTestCases(): DerivationTestCase[] {
  assertProductionPolicyOracle();
  const cases = [...singleSigCases(), ...multisigCases()];
  const ids = new Set(cases.map(testCase => testCase.id));
  if (cases.length !== EXPECTED_DERIVATION_CASE_COUNT || ids.size !== cases.length) {
    throw new Error(
      `Derivation matrix must contain exactly ${EXPECTED_DERIVATION_CASE_COUNT} unique cases; received ${cases.length}/${ids.size}`,
    );
  }
  return cases;
}

export const generateSingleSigTestCases = () => (
  generateDerivationTestCases().filter(testCase => testCase.kind === 'single_sig')
);
export const generateMultisigTestCases = () => (
  generateDerivationTestCases().filter(testCase => testCase.kind === 'multisig')
);
