import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type {
  HardwareSignedNetwork,
  HardwareSignedPsbtVector,
} from '../fixtures/hardware-signed-psbt-vectors';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

type PsbtInput = bitcoin.Psbt['data']['inputs'][number];
type PsbtOutput = bitcoin.Psbt['data']['outputs'][number];
type PsbtMap = PsbtInput | PsbtOutput;
export type HardwareSignedDerivation = {
  masterFingerprint: Uint8Array;
  path: string;
  pubkey: Uint8Array;
};

const MULTISIG_SCRIPT_TYPES = new Set(['p2wsh', 'p2sh-p2wsh']);

const networkParams = (network: HardwareSignedNetwork): bitcoin.Network =>
  network === 'regtest' ? bitcoin.networks.regtest : bitcoin.networks.testnet;

function relativeDerivationPath(accountPath: string, path: string, vectorId: string): string {
  const prefix = `${accountPath}/`;
  if (!path.startsWith(prefix)) {
    throw new Error(`Hardware signed fixture ${vectorId} derivation is outside its account path`);
  }
  const relative = path.slice(prefix.length);
  if (!/^(?:0|1)\/(?:0|[1-9][0-9]*)$/.test(relative)) {
    throw new Error(
      `Hardware signed fixture ${vectorId} derivation is not an exact branch/index path`
    );
  }
  return relative;
}

function vectorCosigners(vector: HardwareSignedPsbtVector) {
  return (
    vector.account.multisig?.cosigners ?? [
      {
        fingerprint: vector.account.fingerprint,
        accountPath: vector.account.accountPath,
        accountXpub: vector.account.accountXpub,
      },
    ]
  );
}

function derivationAccount(vector: HardwareSignedPsbtVector, derivation: HardwareSignedDerivation) {
  const fingerprint = Buffer.from(derivation.masterFingerprint).toString('hex');
  const cosigner = vectorCosigners(vector).find(
    (candidate) => candidate.fingerprint.toLowerCase() === fingerprint
  );
  if (!cosigner)
    throw new Error(`Hardware signed fixture ${vector.id} contains an unknown cosigner`);
  return cosigner;
}

function parseAccountXpub(vector: HardwareSignedPsbtVector, accountXpub: string) {
  try {
    return bip32.fromBase58(accountXpub, networkParams(vector.network));
  } catch {
    throw new Error(`Hardware signed fixture ${vector.id} contains an invalid account xpub`);
  }
}

function expectedDerivationPubkey(
  vector: HardwareSignedPsbtVector,
  derivation: HardwareSignedDerivation
): Buffer {
  const cosigner = derivationAccount(vector, derivation);
  const relative = relativeDerivationPath(cosigner.accountPath, derivation.path, vector.id);
  const account = parseAccountXpub(vector, cosigner.accountXpub);
  const derived = Buffer.from(account.derivePath(relative).publicKey);
  return vector.scriptType === 'p2tr' ? derived.subarray(1) : derived;
}

export function assertHardwareDerivationPubkey(
  vector: HardwareSignedPsbtVector,
  derivation: HardwareSignedDerivation
): void {
  if (!expectedDerivationPubkey(vector, derivation).equals(Buffer.from(derivation.pubkey))) {
    throw new Error(`Hardware signed fixture ${vector.id} account xpub derivation mismatch`);
  }
}

const hasTaprootScriptPathData = (map: PsbtMap): boolean =>
  ('tapLeafScript' in map && Boolean(map.tapLeafScript?.length)) ||
  ('tapScriptSig' in map && Boolean(map.tapScriptSig?.length)) ||
  ('tapMerkleRoot' in map && Boolean(map.tapMerkleRoot)) ||
  ('tapTree' in map && Boolean(map.tapTree));

function validateTaprootMap(vector: HardwareSignedPsbtVector, map: PsbtMap, label: string): void {
  const derivations = map.tapBip32Derivation ?? [];
  const invalid =
    derivations.length !== 1 ||
    !map.tapInternalKey ||
    hasTaprootScriptPathData(map) ||
    derivations[0].leafHashes.length !== 0 ||
    !Buffer.from(map.tapInternalKey).equals(Buffer.from(derivations[0].pubkey));
  if (invalid) {
    throw new Error(
      `Hardware signed fixture ${vector.id} ${label} violates BIP371 key-path metadata`
    );
  }
  assertHardwareDerivationPubkey(vector, derivations[0]);
}

function parseMultisigWitness(vector: HardwareSignedPsbtVector, map: PsbtMap, label: string) {
  try {
    return bitcoin.payments.p2ms({ output: map.witnessScript });
  } catch {
    throw new Error(
      `Hardware signed fixture ${vector.id} ${label} multisig witness policy is invalid`
    );
  }
}

const validateMultisigCosigners = (
  vector: HardwareSignedPsbtVector,
  derivations: HardwareSignedDerivation[],
  label: string
): void => {
  const policy = vector.account.multisig!;
  derivations.forEach((derivation) => assertHardwareDerivationPubkey(vector, derivation));
  const fingerprints = new Set(
    derivations.map((derivation) => Buffer.from(derivation.masterFingerprint).toString('hex'))
  );
  if (
    fingerprints.size !== policy.cosigners.length ||
    !policy.cosigners.every((cosigner) => fingerprints.has(cosigner.fingerprint.toLowerCase()))
  ) {
    throw new Error(`Hardware signed fixture ${vector.id} ${label} multisig cosigner set mismatch`);
  }
};

const validateMultisigThreshold = (
  vector: HardwareSignedPsbtVector,
  derivations: HardwareSignedDerivation[],
  parsed: bitcoin.Payment,
  label: string
): void => {
  const policy = vector.account.multisig!;
  const scriptPubkeys = (parsed.pubkeys ?? []).map((pubkey) => Buffer.from(pubkey));
  const derivedPubkeys = derivations
    .map((derivation) => Buffer.from(derivation.pubkey))
    .sort(Buffer.compare);
  const keyMismatch = scriptPubkeys.some((pubkey, index) => !pubkey.equals(derivedPubkeys[index]));
  if (parsed.m !== policy.threshold || parsed.n !== policy.cosigners.length || keyMismatch) {
    throw new Error(
      `Hardware signed fixture ${vector.id} ${label} multisig threshold or key order mismatch`
    );
  }
};

const validateMultisigWrapper = (
  vector: HardwareSignedPsbtVector,
  map: PsbtMap,
  label: string
): void => {
  const network = networkParams(vector.network);
  const witness = bitcoin.payments.p2wsh({
    redeem: { output: map.witnessScript },
    network,
  });
  const expectedScript =
    vector.scriptType === 'p2wsh'
      ? witness.output
      : bitcoin.payments.p2sh({ redeem: witness, network }).output;
  const actualScript = 'witnessUtxo' in map ? map.witnessUtxo?.script : undefined;
  if (
    !expectedScript ||
    (actualScript && !Buffer.from(expectedScript).equals(Buffer.from(actualScript)))
  ) {
    throw new Error(`Hardware signed fixture ${vector.id} ${label} multisig wrapper mismatch`);
  }
  const invalidNested =
    vector.scriptType === 'p2sh-p2wsh' &&
    (!map.redeemScript ||
      !witness.output ||
      !Buffer.from(map.redeemScript).equals(Buffer.from(witness.output)));
  if (invalidNested) {
    throw new Error(
      `Hardware signed fixture ${vector.id} ${label} nested multisig redeem script mismatch`
    );
  }
};

const validateMultisigMap = (
  vector: HardwareSignedPsbtVector,
  map: PsbtMap,
  label: string
): void => {
  const policy = vector.account.multisig;
  const derivations = map.bip32Derivation ?? [];
  if (!policy || !map.witnessScript || derivations.length !== policy.cosigners.length) {
    throw new Error(`Hardware signed fixture ${vector.id} ${label} multisig policy is incomplete`);
  }
  validateMultisigCosigners(vector, derivations, label);
  validateMultisigThreshold(vector, derivations, parseMultisigWitness(vector, map, label), label);
  validateMultisigWrapper(vector, map, label);
};

const validateMap = (vector: HardwareSignedPsbtVector, map: PsbtMap, label: string): void => {
  if (vector.scriptType === 'p2tr') return validateTaprootMap(vector, map, label);
  if (MULTISIG_SCRIPT_TYPES.has(vector.scriptType)) return validateMultisigMap(vector, map, label);
  (map.bip32Derivation ?? []).forEach((derivation) =>
    assertHardwareDerivationPubkey(vector, derivation)
  );
};

export const validateHardwarePsbtPolicyBinding = (
  vector: HardwareSignedPsbtVector,
  psbt: bitcoin.Psbt
): void => {
  psbt.data.inputs.forEach((input, index) => validateMap(vector, input, `input ${index}`));
  psbt.data.outputs.forEach((output, index) => {
    if (vector.expectedOutputs[index]?.isChange) validateMap(vector, output, `output ${index}`);
  });
};

function paymentForAddress(
  vector: HardwareSignedPsbtVector,
  pubkeys: Buffer[],
  network: bitcoin.Network
): bitcoin.Payment {
  if (vector.scriptType === 'p2pkh')
    return bitcoin.payments.p2pkh({ pubkey: pubkeys[0], network });
  if (vector.scriptType === 'p2wpkh')
    return bitcoin.payments.p2wpkh({ pubkey: pubkeys[0], network });
  if (vector.scriptType === 'p2sh-p2wpkh') {
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey: pubkeys[0], network }),
      network,
    });
  }
  if (vector.scriptType === 'p2tr') {
    return bitcoin.payments.p2tr({
      internalPubkey: pubkeys[0].subarray(1),
      network,
    });
  }
  const p2ms = bitcoin.payments.p2ms({
    m: vector.account.multisig!.threshold,
    pubkeys,
    network,
  });
  const witness = bitcoin.payments.p2wsh({ redeem: p2ms, network });
  return vector.scriptType === 'p2wsh'
    ? witness
    : bitcoin.payments.p2sh({ redeem: witness, network });
}

function derivedAddress(vector: HardwareSignedPsbtVector, path: string): string {
  const network = networkParams(vector.network);
  const pubkeys = vectorCosigners(vector)
    .map((cosigner) => {
      const relative = relativeDerivationPath(cosigner.accountPath, path, vector.id);
      return Buffer.from(
        parseAccountXpub(vector, cosigner.accountXpub).derivePath(relative).publicKey
      );
    })
    .sort(Buffer.compare);
  const address = paymentForAddress(vector, pubkeys, network).address;
  if (!address)
    throw new Error(`Hardware signed fixture ${vector.id} cannot derive evidence address`);
  return address;
}

export function validateHardwareAddressDerivation(vector: HardwareSignedPsbtVector): void {
  vector.addressEvidence.forEach((evidence) => {
    const wrongAccount = !evidence.path.startsWith(`${vector.account.accountPath}/`);
    if (wrongAccount || derivedAddress(vector, evidence.path) !== evidence.sanctuaryAddress) {
      throw new Error(
        `Hardware signed fixture ${vector.id} address evidence does not derive from the account policy`
      );
    }
  });
}
