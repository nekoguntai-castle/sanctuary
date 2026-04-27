/**
 * Witness Script Builder
 *
 * Constructs and parses multisig witness scripts for P2WSH inputs.
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { convertToStandardXpub, MultisigKeyInfo } from '../addressDerivation';
import { createLogger } from '../../../utils/logger';
import { extractChangeAndAddressIndex } from '../../../../../shared/utils/bitcoin';

const log = createLogger('BITCOIN:SVC_PSBT_WITNESS');

type ParsedMultisigScript = { isMultisig: boolean; m: number; n: number; pubkeys: Buffer[] };
type DecompiledScript = NonNullable<ReturnType<typeof bitcoin.script.decompile>>;
type ScriptChunk = DecompiledScript[number];

const deriveMultisigPubkeys = (
  derivationPath: string,
  multisigKeys: MultisigKeyInfo[],
  network: bitcoin.Network,
  inputIndex?: number
): Uint8Array[] | undefined => {
  const { changeIdx, addressIdx } = extractChangeAndAddressIndex(derivationPath);
  const pubkeys: Uint8Array[] = [];

  for (const keyInfo of multisigKeys) {
    try {
      const standardXpub = convertToStandardXpub(keyInfo.xpub);
      const keyNode = bip32.fromBase58(standardXpub, network);
      const derivedNode = keyNode.derive(changeIdx).derive(addressIdx);
      pubkeys.push(derivedNode.publicKey!);
    } catch (keyError) {
      log.warn('Failed to derive key for witnessScript', {
        inputIndex,
        fingerprint: keyInfo.fingerprint,
        error: (keyError as Error).message,
      });
    }
  }

  if (pubkeys.length !== multisigKeys.length) {
    log.warn('Not all pubkeys derived for witnessScript', {
      inputIndex,
      expected: multisigKeys.length,
      actual: pubkeys.length,
    });
    return undefined;
  }

  return pubkeys.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
};

const buildP2msOutput = (
  pubkeys: Uint8Array[],
  quorum: number,
  network: bitcoin.Network,
  inputIndex?: number
): Uint8Array | undefined => {
  const p2ms = bitcoin.payments.p2ms({
    m: quorum,
    pubkeys,
    network,
  });

  /* v8 ignore start -- defensive: bitcoinjs p2ms produces output for validated quorum/pubkeys */
  if (!p2ms.output) {
    /* v8 ignore next 2 -- defensive: bitcoinjs p2ms produces output for validated quorum/pubkeys */
    log.warn('Failed to generate p2ms output for witnessScript', { inputIndex });
    /* v8 ignore next -- defensive: bitcoinjs p2ms produces output for validated quorum/pubkeys */
    return undefined;
  }
  /* v8 ignore stop */

  return p2ms.output;
};

/**
 * Build the witnessScript (multisig redeem script) for a P2WSH multisig input.
 *
 * Hardware wallets require the witnessScript to:
 * 1. Verify the scriptPubKey matches (witnessUtxo contains P2WSH hash of witnessScript)
 * 2. Know what they're signing (m-of-n with which public keys)
 *
 * @param derivationPath - Full derivation path for the address (e.g., "m/48'/0'/0'/2'/0/5")
 * @param multisigKeys - Array of cosigner key info from parsed descriptor
 * @param quorum - Number of required signatures (M in M-of-N)
 * @param network - Bitcoin network object
 * @param inputIndex - Optional input index for logging
 * @returns The witnessScript buffer, or undefined if derivation fails
 */
export function buildMultisigWitnessScript(
  derivationPath: string,
  multisigKeys: MultisigKeyInfo[],
  quorum: number,
  network: bitcoin.Network,
  inputIndex?: number
): Uint8Array | undefined {
  try {
    const pubkeys = deriveMultisigPubkeys(derivationPath, multisigKeys, network, inputIndex);
    if (!pubkeys) return undefined;

    const witnessScript = buildP2msOutput(pubkeys, quorum, network, inputIndex);
    /* v8 ignore next -- defensive: bitcoinjs p2ms output failure is guarded in buildP2msOutput */
    if (!witnessScript) return undefined;

    log.info('Multisig witnessScript built', {
      inputIndex,
      quorum,
      keyCount: pubkeys.length,
      scriptSize: witnessScript.length,
    });

    return witnessScript;
  } catch (e) {
    log.warn('Failed to build multisig witnessScript', {
      inputIndex,
      error: (e as Error).message,
    });
    return undefined;
  }
}

function hasMultisigScriptShape(decompiled: DecompiledScript): boolean {
  return decompiled.length >= 4 && isMultisigCheckOp(decompiled[decompiled.length - 1]);
}

function isMultisigCheckOp(op: ScriptChunk): boolean {
  const OPS = bitcoin.script.OPS;
  return op === OPS.OP_CHECKMULTISIG || op === OPS.OP_CHECKMULTISIGVERIFY;
}

function parseScriptSmallInteger(value: ScriptChunk): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  // OP_1 (81) through OP_16 (96) encode Bitcoin Script small integers 1-16.
  if (value >= 81 && value <= 96) {
    return value - 80;
  }

  /* v8 ignore next -- legacy numeric quorum encoding is retained for defensive script parsing */
  if (value >= 1 && value <= 16) {
    return value;
  }

  return undefined;
}

function extractMultisigPubkeys(decompiled: DecompiledScript): Buffer[] {
  const pubkeys: Buffer[] = [];
  for (let i = 1; i < decompiled.length - 2; i++) {
    const item = decompiled[i];
    if (typeof item !== 'number' && (item.length === 33 || item.length === 65)) {
      pubkeys.push(Buffer.from(item));
    }
  }

  return pubkeys;
}

function invalidMultisigScript(): ParsedMultisigScript {
  return { isMultisig: false, m: 0, n: 0, pubkeys: [] };
}

/**
 * Check if a witnessScript is a multisig script (OP_CHECKMULTISIG or OP_CHECKMULTISIGVERIFY)
 * Returns { isMultisig: boolean, m: number, n: number } if it is multisig
 */
export function parseMultisigScript(witnessScript: Buffer | Uint8Array): ParsedMultisigScript {
  const decompiled = bitcoin.script.decompile(witnessScript);

  if (!decompiled || !hasMultisigScriptShape(decompiled)) {
    return invalidMultisigScript();
  }

  const m = parseScriptSmallInteger(decompiled[0]);
  const n = parseScriptSmallInteger(decompiled[decompiled.length - 2]);
  if (m === undefined || n === undefined) {
    return invalidMultisigScript();
  }

  const pubkeys = extractMultisigPubkeys(decompiled);
  if (pubkeys.length !== n) {
    log.warn('Multisig script pubkey count mismatch', { expected: n, actual: pubkeys.length });
    return invalidMultisigScript();
  }

  return { isMultisig: true, m, n, pubkeys };
}
