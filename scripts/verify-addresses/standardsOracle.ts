import type {
  ChainEnvironment,
  DerivationFamily,
  MultisigScriptType,
  SingleSigScriptType,
  Slip132Format,
} from './types.js';

/**
 * Verifier-owned standards oracle. Do not derive these values from Sanctuary's
 * production wallet-policy registry: this table exists to detect drift there.
 */
export const STANDARD_POLICY_ORACLE = Object.freeze([
  { id: 'single-sig-legacy-bip44-v1', displayName: 'Legacy (BIP-44)', kind: 'single_sig', accountPurpose: 'single_sig', descriptorWrapper: 'pkh', productionScriptType: 'legacy', scriptType: 'legacy', purpose: 44, bip48ScriptType: null, paths: { mainnet: ["m/44'/0'/0'", "m/44'/0'/7'"], testnet: ["m/44'/1'/0'", "m/44'/1'/7'"] } },
  { id: 'single-sig-nested-segwit-bip49-v1', displayName: 'Nested SegWit (BIP-49)', kind: 'single_sig', accountPurpose: 'single_sig', descriptorWrapper: 'sh(wpkh)', productionScriptType: 'nested_segwit', scriptType: 'nested_segwit', purpose: 49, bip48ScriptType: null, paths: { mainnet: ["m/49'/0'/0'", "m/49'/0'/7'"], testnet: ["m/49'/1'/0'", "m/49'/1'/7'"] } },
  { id: 'single-sig-native-segwit-bip84-v1', displayName: 'Native SegWit (BIP-84)', kind: 'single_sig', accountPurpose: 'single_sig', descriptorWrapper: 'wpkh', productionScriptType: 'native_segwit', scriptType: 'native_segwit', purpose: 84, bip48ScriptType: null, paths: { mainnet: ["m/84'/0'/0'", "m/84'/0'/7'"], testnet: ["m/84'/1'/0'", "m/84'/1'/7'"] } },
  { id: 'single-sig-taproot-bip86-v1', displayName: 'Taproot (BIP-86)', kind: 'single_sig', accountPurpose: 'single_sig', descriptorWrapper: 'tr', productionScriptType: 'taproot', scriptType: 'taproot', purpose: 86, bip48ScriptType: null, paths: { mainnet: ["m/86'/0'/0'", "m/86'/0'/7'"], testnet: ["m/86'/1'/0'", "m/86'/1'/7'"] } },
  { id: 'multisig-nested-segwit-bip48-1-v1', displayName: 'Multisig Nested SegWit (BIP-48)', kind: 'multi_sig', accountPurpose: 'multisig', descriptorWrapper: 'sh(wsh(sortedmulti))', productionScriptType: 'nested_segwit', scriptType: 'p2sh_p2wsh', purpose: 48, bip48ScriptType: 1, paths: { mainnet: ["m/48'/0'/0'/1'", "m/48'/0'/7'/1'"], testnet: ["m/48'/1'/0'/1'", "m/48'/1'/7'/1'"] } },
  { id: 'multisig-native-segwit-bip48-2-v1', displayName: 'Multisig Native SegWit (BIP-48)', kind: 'multi_sig', accountPurpose: 'multisig', descriptorWrapper: 'wsh(sortedmulti)', productionScriptType: 'native_segwit', scriptType: 'p2wsh', purpose: 48, bip48ScriptType: 2, paths: { mainnet: ["m/48'/0'/0'/2'", "m/48'/0'/7'/2'"], testnet: ["m/48'/1'/0'/2'", "m/48'/1'/7'/2'"] } },
] as const);

export type StandardPolicy = (typeof STANDARD_POLICY_ORACLE)[number];

export const PINNED_CORE_IMAGE = 'bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78' as const;
export const PINNED_CORE_VERSION = '29.0.0' as const;
export const PINNED_NODE_VERSION = '24.19.0' as const;
export const PINNED_PYTHON_VERSION = '3.13.5' as const;
export const PINNED_PYTHON_EFFECTIVE_UID = 65532 as const;
export const PINNED_PYTHON_BASE_IMAGE = 'python:3.13.5-slim-bookworm@sha256:4c2cf9917bd1cbacc5e9b07320025bdb7cdf2df7b0ceaccb55e9dd7e30987419' as const;
export const PYTHON_VERIFIER_IMAGE = 'sanctuary/verify-addresses-python:3.13.5-bip-utils-2.12.1-v1' as const;
export const PINNED_GO_VERSION = 'go1.25.13' as const;

/**
 * Observed with Bitcoin Core 29.0 `getdescriptorinfo`. Core removes the private
 * root but retains the root tpub plus hardened suffix; it does not return an
 * account-level tpub whose BIP32 payload could be compared independently.
 */
export const CORE_ACCOUNT_METADATA_PROBE = Object.freeze({
  inputShape: 'wpkh(root-tprv/84h/1h/0h/<0;1>/*)',
  returnedShape: 'wpkh(root-tpub/84h/1h/0h/0/*)',
  hasPrivateKeys: true,
  exposesAccountExtendedPublicKey: false,
} as const);
export const CORE_CHAIN_ORACLE = Object.freeze([
  { environment: 'mainnet', reportedChain: 'main' },
  { environment: 'testnet3', reportedChain: 'test' },
  { environment: 'testnet4', reportedChain: 'testnet4' },
  { environment: 'signet', reportedChain: 'signet' },
  { environment: 'regtest', reportedChain: 'regtest' },
] as const satisfies readonly { environment: ChainEnvironment; reportedChain: string }[]);

export const derivationFamilyForChain = (chain: ChainEnvironment): DerivationFamily => (
  chain === 'mainnet' ? 'mainnet' : 'testnet'
);

export function expectedAccountPath(
  policy: StandardPolicy,
  family: DerivationFamily,
  account: number,
): string {
  const accountIndex = account === 0 ? 0 : account === 7 ? 1 : -1;
  if (accountIndex === -1) throw new Error(`No standards path anchor for account ${account}`);
  return policy.paths[family][accountIndex];
}

const SLIP132_POLICY_ORACLE: Readonly<Record<
  SingleSigScriptType | MultisigScriptType,
  Readonly<Record<DerivationFamily, Slip132Format>>
>> = Object.freeze({
  legacy: Object.freeze({ mainnet: 'xpub', testnet: 'tpub' }),
  nested_segwit: Object.freeze({ mainnet: 'ypub', testnet: 'upub' }),
  native_segwit: Object.freeze({ mainnet: 'zpub', testnet: 'vpub' }),
  taproot: Object.freeze({ mainnet: 'xpub', testnet: 'tpub' }),
  p2sh_p2wsh: Object.freeze({ mainnet: 'Ypub', testnet: 'Upub' }),
  p2wsh: Object.freeze({ mainnet: 'Zpub', testnet: 'Vpub' }),
});

export const expectedSlip132Format = (
  scriptType: SingleSigScriptType | MultisigScriptType,
  family: DerivationFamily,
): Slip132Format => SLIP132_POLICY_ORACLE[scriptType][family];

/**
 * Literal published vectors, copied from the BIP specifications rather than
 * calculated by verifier code:
 * - BIP49: https://github.com/bitcoin/bips/blob/master/bip-0049.mediawiki#test-vectors
 * - BIP84: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki#test-vectors
 * - BIP86: https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki#test-vectors
 */
export const OFFICIAL_BIP_ANCHORS = Object.freeze([
  {
    source: 'BIP49', caseId: 'ss:single-sig-nested-segwit-bip49-v1:testnet3:a0:b0:i0',
    accountPath: "m/49'/1'/0'", accountPublicKey: 'upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY',
    address: '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2',
    scriptPubKey: 'a914336caa13e08b96080a32b5d818d59b4ab3b3674287',
  },
  {
    source: 'BIP84', caseId: 'ss:single-sig-native-segwit-bip84-v1:mainnet:a0:b0:i0',
    accountPath: "m/84'/0'/0'", accountPublicKey: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    scriptPubKey: '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2',
  },
  {
    source: 'BIP86', caseId: 'ss:single-sig-taproot-bip86-v1:mainnet:a0:b0:i0',
    accountPath: "m/86'/0'/0'", accountPublicKey: 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ',
    address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    scriptPubKey: '5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c',
  },
] as const);
