/**
 * Shared types for address verification
 */

export type ScriptType = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
export type MultisigScriptType = 'p2sh' | 'p2sh_p2wsh' | 'p2wsh';
export type Network = 'mainnet' | 'testnet';

export interface SingleSigTestCase {
  description: string;
  mnemonic: string;
  path: string;
  xpub: string;
  scriptType: ScriptType;
  network: Network;
  index: number;
  change: boolean;
}

export interface MultisigTestCase {
  description: string;
  xpubs: string[];
  threshold: number;
  totalKeys: number;
  scriptType: MultisigScriptType;
  network: Network;
  index: number;
  change: boolean;
  // For key ordering tests
  keyOrder?: 'sorted' | 'unsorted';
}

export interface VerificationResult {
  testCase: SingleSigTestCase | MultisigTestCase;
  results: Map<string, string>; // implementation name -> address
  consensus: boolean;
  consensusAddress?: string;
  disagreements?: Array<{ impl: string; address: string }>;
  errors?: string[];
}

export interface VerifiedSingleSigVector {
  description: string;
  mnemonic: string;
  path: string;
  xpub: string;
  scriptType: ScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  verifiedBy: string[];
}

export interface VerifiedMultisigVector {
  description: string;
  xpubs: string[];
  threshold: number;
  totalKeys: number;
  scriptType: MultisigScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  expectedDescriptor: string;
  verifiedBy: string[];
}

/**
 * Interface that each implementation wrapper must implement
 */
export interface AddressDeriver {
  name: string;
  version: string;

  /**
   * Derive a single-sig address
   */
  deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string>;

  /**
   * Derive a multisig address
   */
  deriveMultisig(
    xpubs: string[],
    threshold: number,
    index: number,
    scriptType: MultisigScriptType,
    change: boolean,
    network: Network
  ): Promise<string>;

  /**
   * Check if this implementation is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Why isAvailable() last returned false. Set by the implementation so the
   * panel can say *why* it dropped out instead of only that it did -- a bare
   * [UNAVAILABLE] hid a four-way cross-check masquerading as five-way.
   */
  unavailableReason?: string;
}
