import type {
  MultisigScriptType,
  MultisigTestCase,
  Network,
  ScriptType,
  SingleSigTestCase,
} from './types.js';
import { deriveXpub } from './xpub.js';

/**
 * Standard BIP-39 test mnemonic - this is THE test mnemonic from the BIP spec.
 */
export const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const MULTISIG_MNEMONICS = [
  TEST_MNEMONIC,
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
];

const SINGLE_SIG_SCRIPT_TYPES: Array<{ type: ScriptType; bip: number }> = [
  { type: 'legacy', bip: 44 },
  { type: 'nested_segwit', bip: 49 },
  { type: 'native_segwit', bip: 84 },
  { type: 'taproot', bip: 86 },
];

const MULTISIG_SCRIPT_TYPES: MultisigScriptType[] = ['p2sh', 'p2sh_p2wsh', 'p2wsh'];
const NETWORKS: Network[] = ['mainnet', 'testnet'];
const SINGLE_SIG_INDICES = [0, 1, 2, 19, 99];
const HIGH_INDICES = [999, 9999, 2147483646];
const MULTISIG_INDICES = [0, 1, 2];
const CHANGE_OPTIONS = [false, true];
const THRESHOLDS = [
  { m: 2, n: 3 },
  { m: 3, n: 5 },
];

function getAccountPath(bip: number, network: Network): string {
  const coinType = network === 'mainnet' ? 0 : 1;
  return `m/${bip}'/${coinType}'/0'`;
}

function buildSingleSigCasesForPath(
  type: ScriptType,
  network: Network,
  path: string,
  xpub: string
): SingleSigTestCase[] {
  const cases: SingleSigTestCase[] = [];

  for (const change of CHANGE_OPTIONS) {
    for (const index of SINGLE_SIG_INDICES) {
      cases.push({
        description: `${type} ${network} ${change ? 'change' : 'receive'} index ${index}`,
        mnemonic: TEST_MNEMONIC,
        path,
        xpub,
        scriptType: type,
        network,
        index,
        change,
      });
    }
  }

  return cases;
}

function generateHighIndexCases(): SingleSigTestCase[] {
  return HIGH_INDICES.map((index) => ({
    description: `native_segwit mainnet receive high index ${index}`,
    mnemonic: TEST_MNEMONIC,
    path: "m/84'/0'/0'",
    xpub: deriveXpub(TEST_MNEMONIC, "m/84'/0'/0'", 'mainnet'),
    scriptType: 'native_segwit',
    network: 'mainnet',
    index,
    change: false,
  }));
}

/**
 * Generate single-sig test cases.
 */
export function generateSingleSigTestCases(): SingleSigTestCase[] {
  const cases: SingleSigTestCase[] = [];

  for (const { type, bip } of SINGLE_SIG_SCRIPT_TYPES) {
    for (const network of NETWORKS) {
      const path = getAccountPath(bip, network);
      const xpub = deriveXpub(TEST_MNEMONIC, path, network);
      cases.push(...buildSingleSigCasesForPath(type, network, path, xpub));
    }
  }

  cases.push(...generateHighIndexCases());
  return cases;
}

function deriveCosignerXpub(index: number, network: Network): string {
  if (index >= MULTISIG_MNEMONICS.length) {
    return deriveXpub(TEST_MNEMONIC, `m/48'/1'/${index}'/2'`, network);
  }

  const mnemonic = MULTISIG_MNEMONICS[index % MULTISIG_MNEMONICS.length];
  return deriveXpub(mnemonic, "m/48'/1'/0'/2'", network);
}

function deriveCosignerXpubs(totalKeys: number, network: Network): string[] {
  const xpubs: string[] = [];

  for (let index = 0; index < totalKeys; index++) {
    xpubs.push(deriveCosignerXpub(index, network));
  }

  return xpubs;
}

function buildMultisigCasesForThreshold(
  scriptType: MultisigScriptType,
  threshold: number,
  totalKeys: number,
  xpubs: string[],
  network: Network
): MultisigTestCase[] {
  const cases: MultisigTestCase[] = [];

  for (const change of CHANGE_OPTIONS) {
    for (const index of MULTISIG_INDICES) {
      cases.push({
        description: `${scriptType} ${threshold}-of-${totalKeys} ${change ? 'change' : 'receive'} index ${index}`,
        xpubs: xpubs.slice(0, totalKeys),
        threshold,
        totalKeys,
        scriptType,
        network,
        index,
        change,
      });
    }
  }

  return cases;
}

function generateKeyOrderingCases(): MultisigTestCase[] {
  const baseXpubs = MULTISIG_MNEMONICS.slice(0, 3).map((mnemonic) =>
    deriveXpub(mnemonic, "m/48'/1'/0'/2'", 'testnet')
  );
  const orderings = [
    baseXpubs.slice(),
    [baseXpubs[2], baseXpubs[1], baseXpubs[0]],
    [baseXpubs[1], baseXpubs[2], baseXpubs[0]],
  ];

  return orderings.map((xpubs, index) => ({
    description: `p2wsh 2-of-3 key ordering test ${index + 1}`,
    xpubs,
    threshold: 2,
    totalKeys: 3,
    scriptType: 'p2wsh',
    network: 'testnet',
    index: 0,
    change: false,
    keyOrder: index === 0 ? 'sorted' : 'unsorted',
  }));
}

/**
 * Generate multisig test cases.
 */
export function generateMultisigTestCases(): MultisigTestCase[] {
  const cases: MultisigTestCase[] = [];
  const network: Network = 'testnet';

  for (const scriptType of MULTISIG_SCRIPT_TYPES) {
    for (const { m, n } of THRESHOLDS) {
      const xpubs = deriveCosignerXpubs(n, network);
      cases.push(...buildMultisigCasesForThreshold(scriptType, m, n, xpubs, network));
    }
  }

  cases.push(...generateKeyOrderingCases());
  return cases;
}
