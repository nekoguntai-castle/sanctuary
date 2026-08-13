/** Strict contracts shared by every independent derivation verifier. */

export const DERIVATION_MATRIX_SCHEMA_VERSION = 2 as const;
export const DERIVATION_MATRIX_ID = 'sanctuary-seed-to-address-v2' as const;
export const EXPECTED_DERIVATION_CASE_COUNT = 480 as const;

/** Mutually exclusive provenance claims; later entries must never be inferred from earlier ones. */
export type EvidenceTier =
  | 'literal-official-vector'
  | 'independently-executed-implementation-consensus'
  | 'self-generated-integration-fixture'
  | 'emulator-protocol-proof'
  | 'physical-device-proof';

export type ChainEnvironment = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';
export type DerivationFamily = 'mainnet' | 'testnet';
export type SingleSigScriptType = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
export type MultisigScriptType = 'p2sh_p2wsh' | 'p2wsh';
export type ScriptType = SingleSigScriptType | MultisigScriptType;
export type WalletBranch = 0 | 1;
export type Slip132Format =
  | 'xpub' | 'ypub' | 'zpub' | 'Ypub' | 'Zpub'
  | 'tpub' | 'upub' | 'vpub' | 'Upub' | 'Vpub';

export interface TestSeed {
  readonly id: string;
  readonly mnemonic: string;
}

interface BaseDerivationCase {
  readonly id: string;
  readonly description: string;
  readonly chain: ChainEnvironment;
  readonly derivationFamily: DerivationFamily;
  readonly policyId: string;
  readonly scriptType: ScriptType;
  readonly account: number;
  readonly accountPath: string;
  readonly branch: WalletBranch;
  readonly index: number;
  readonly seedIds: readonly string[];
  readonly slip132Format: Slip132Format;
}

export interface SingleSigTestCase extends BaseDerivationCase {
  readonly kind: 'single_sig';
  readonly scriptType: SingleSigScriptType;
  readonly seedIds: readonly [string];
}

export interface MultisigTestCase extends BaseDerivationCase {
  readonly kind: 'multisig';
  readonly scriptType: MultisigScriptType;
  readonly seedIds: readonly string[];
  readonly threshold: 2 | 3;
  readonly totalKeys: 3 | 5;
}

export type DerivationTestCase = SingleSigTestCase | MultisigTestCase;

/** BIP32 account-node evidence, decoded without interpreting the address. */
export interface AccountKeyEvidence {
  readonly seedId: string;
  readonly masterFingerprint: string;
  readonly originPath: string;
  readonly encoded: string;
  readonly versionHex: string;
  readonly depth: number;
  readonly parentFingerprint: string;
  readonly childNumber: number;
  readonly chainCodeHex: string;
  readonly publicKeyHex: string;
  /** The complete 74-byte payload after the four version bytes. */
  readonly payloadHex: string;
}

export interface DerivationEvidence {
  readonly caseId: string;
  readonly implementation: string;
  readonly implementationVersion: string;
  readonly evidenceScope: 'root-private-descriptor-to-output' | 'seed-to-account-and-output';
  readonly accountKeys: readonly AccountKeyEvidence[];
  readonly address: string;
  readonly scriptPubKeyHex: string;
  readonly descriptor?: string;
  readonly core?: {
    readonly chain: string;
    readonly version: string;
  };
}

export interface DerivationImplementation {
  readonly id: 'bitcoin-core' | 'bitcoinjs-lib' | 'bip-utils-python' | 'btcd-go';
  readonly name: string;
  version: string;
  unavailableReason?: string;
  isAvailable(): Promise<boolean>;
  deriveCases(
    cases: readonly DerivationTestCase[],
    seeds: readonly TestSeed[],
  ): Promise<DerivationEvidence[]>;
}

export interface VerifierProvenance {
  readonly schemaVersion: typeof DERIVATION_MATRIX_SCHEMA_VERSION;
  readonly matrixId: typeof DERIVATION_MATRIX_ID;
  readonly exactCaseCount: typeof EXPECTED_DERIVATION_CASE_COUNT;
  readonly sourceSha256: string;
  readonly coreImage: string;
  readonly runtimes: {
    readonly node: string;
    readonly python: string;
    readonly pythonEffectiveUid: number;
    readonly pythonImage: string;
    readonly go: string;
    readonly pythonRequirementsSha256: string;
    readonly pythonDependencyFingerprint: string;
    readonly pythonVerifierSourceSha256: string;
  };
  readonly evidenceScopes: readonly {
    readonly implementation: string;
    readonly scope: DerivationEvidence['evidenceScope'];
  }[];
  readonly adversarialProofs: readonly {
    readonly id: 'reversed-sortedmulti' | 'duplicate-key-rejection' | 'invalid-seed-rejection'
      | 'invalid-extended-public-key-rejection';
    readonly scope: 'four-way-core-derived-output' | 'adapter-input-validation' | 'verifier-xpub-boundary';
    readonly verifiedBy: readonly string[];
  }[];
  readonly implementations: readonly {
    readonly id: DerivationImplementation['id'];
    readonly name: string;
    readonly version: string;
  }[];
  readonly coreChains: readonly {
    readonly environment: ChainEnvironment;
    readonly reportedChain: string;
    readonly version: string;
  }[];
}

export interface VerifiedSingleSigVector {
  readonly evidenceTier: 'independently-executed-implementation-consensus';
  readonly caseId: string;
  readonly description: string;
  readonly seedId: string;
  readonly mnemonic: string;
  readonly path: string;
  readonly xpub: string;
  readonly scriptType: SingleSigScriptType;
  readonly network: ChainEnvironment;
  readonly account: number;
  readonly index: number;
  readonly branch: WalletBranch;
  readonly change: boolean;
  readonly expectedAddress: string;
  readonly expectedScriptPubKey: string;
  readonly expectedDescriptor: string;
  readonly accountKeys: readonly AccountKeyEvidence[];
  readonly verifiedBy: readonly string[];
}

export interface VerifiedMultisigVector {
  readonly evidenceTier: 'independently-executed-implementation-consensus';
  readonly caseId: string;
  readonly description: string;
  readonly seedIds: readonly string[];
  readonly xpubs: readonly string[];
  readonly threshold: number;
  readonly totalKeys: number;
  readonly scriptType: MultisigScriptType;
  readonly network: ChainEnvironment;
  readonly account: number;
  readonly accountPath: string;
  readonly index: number;
  readonly branch: WalletBranch;
  readonly change: boolean;
  readonly expectedAddress: string;
  readonly expectedScriptPubKey: string;
  readonly expectedDescriptor: string;
  readonly accountKeys: readonly AccountKeyEvidence[];
  readonly verifiedBy: readonly string[];
}
