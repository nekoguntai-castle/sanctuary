import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { finalizeMultisigInput } from '../../src/services/bitcoin/psbtBuilder';
import type {
  BlockedHardwareSignedRow,
  HardwareSignedNetwork,
  HardwareSignedPsbtVector,
  HardwareSignedScriptType,
  RequiredHardwareSignedRow,
  UnsupportedHardwareSignedRow,
} from '../fixtures/hardware-signed-psbt-vectors';
import { assertHardwareSignedFixtureIntake } from './hardwareSignedFixtureIntake';
import {
  assertHardwareDerivationPubkey,
  validateHardwareAddressDerivation,
  validateHardwarePsbtPolicyBinding,
  type HardwareSignedDerivation,
} from './hardwareSignedPolicyBinding';
import {
  EMPTY_HARDWARE_EVIDENCE_TRUST,
  type HardwareEvidenceVerificationContext,
} from './hardwareSignedEvidenceProvenance';

bitcoin.initEccLib(ecc);

interface ReplayOutput {
  index: number;
  address: string;
  valueSats: number;
}

export interface HardwareSignedReplayResult {
  txid: string;
  feeSats: number;
  vsize: number;
  outputs: ReplayOutput[];
}

type PsbtInput = bitcoin.Psbt['data']['inputs'][number];
type PsbtOutput = bitcoin.Psbt['data']['outputs'][number];
type TransactionOutput = bitcoin.Transaction['outs'][number];

const MULTISIG_SCRIPT_TYPES: HardwareSignedScriptType[] = ['p2wsh', 'p2sh-p2wsh'];

const rowKey = (row: RequiredHardwareSignedRow): string => {
  return `${row.vendor}:${row.scriptType}`;
};

const networkParams = (network: HardwareSignedNetwork): bitcoin.Network => {
  return network === 'regtest' ? bitcoin.networks.regtest : bitcoin.networks.testnet;
};

const validateNonEmpty = (value: string, label: string): void => {
  if (value.trim() === '') throw new Error(`Hardware signed fixture is missing ${label}`);
};

const validateVectorMetadata = (vector: HardwareSignedPsbtVector): void => {
  validateNonEmpty(vector.id, 'id');
  validateNonEmpty(vector.device.model, 'device model');
  validateNonEmpty(vector.device.firmwareVersion, 'device firmware version');
  validateNonEmpty(vector.account.fingerprint, 'account fingerprint');
  validateNonEmpty(vector.account.accountPath, 'account path');
  validateNonEmpty(vector.expectedTxid, 'expected txid');
  if (vector.signedBy.length === 0) {
    throw new Error(`Hardware signed fixture ${vector.id} has no signer evidence`);
  }
  for (const signer of vector.signedBy) {
    const accountPrefix = `${vector.account.accountPath}/`;
    const validPubkey =
      vector.scriptType === 'p2tr'
        ? /^[0-9a-f]{64}$/i.test(signer.pubkey)
        : /^(?:02|03)[0-9a-f]{64}$/i.test(signer.pubkey);
    if (
      signer.fingerprint.toLowerCase() !== vector.account.fingerprint.toLowerCase() ||
      !signer.derivationPath.startsWith(accountPrefix) ||
      !validPubkey
    ) {
      throw new Error(
        `Hardware signed fixture ${vector.id} signer metadata differs from the selected account`
      );
    }
  }
  for (const [label, value] of [
    ['input value', vector.inputValueSats],
    ['fee', vector.expectedFeeSats],
    ['vsize', vector.expectedVsize],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Hardware signed fixture ${vector.id} has invalid ${label}`);
    }
  }
};

const isInputFinalized = (input: PsbtInput): boolean => {
  return Boolean(input.finalScriptSig || input.finalScriptWitness);
};

const finalizeHardwarePsbt = (psbt: bitcoin.Psbt, scriptType: HardwareSignedScriptType): void => {
  for (let inputIndex = 0; inputIndex < psbt.inputCount; inputIndex += 1) {
    if (isInputFinalized(psbt.data.inputs[inputIndex])) continue;
    if (MULTISIG_SCRIPT_TYPES.includes(scriptType)) finalizeMultisigInput(psbt, inputIndex);
    else psbt.finalizeInput(inputIndex);
  }
};

const unsignedTransaction = (psbt: bitcoin.Psbt): bitcoin.Transaction => {
  const tx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(tx.toBuffer());
};

const assertTransactionIntent = (
  vector: HardwareSignedPsbtVector,
  expected: bitcoin.Transaction,
  actual: bitcoin.Transaction
): void => {
  if (expected.version !== actual.version || expected.locktime !== actual.locktime) {
    throw new Error(`Hardware signed fixture ${vector.id} transaction header mismatch`);
  }
  if (expected.ins.length !== actual.ins.length || expected.outs.length !== actual.outs.length) {
    throw new Error(`Hardware signed fixture ${vector.id} transaction count mismatch`);
  }
  expected.ins.forEach((input, index) => {
    const candidate = actual.ins[index];
    if (
      !Buffer.from(input.hash).equals(candidate.hash) ||
      input.index !== candidate.index ||
      input.sequence !== candidate.sequence
    ) {
      throw new Error(`Hardware signed fixture ${vector.id} input ${index} intent mismatch`);
    }
  });
  expected.outs.forEach((output, index) => {
    const candidate = actual.outs[index];
    if (output.value !== candidate.value || !Buffer.from(output.script).equals(candidate.script)) {
      throw new Error(`Hardware signed fixture ${vector.id} output ${index} intent mismatch`);
    }
  });
};

const signatureValidator = (
  pubkey: Uint8Array,
  hash: Uint8Array,
  signature: Uint8Array
): boolean => {
  return pubkey.length === 32
    ? ecc.verifySchnorr(hash, pubkey, signature)
    : ecc.verify(hash, pubkey, signature);
};

const normalizeEcdsaSignature = (
  signatureHex: string,
  sighashType: number,
  vectorId: string
): Buffer => {
  const signature = Buffer.from(signatureHex, 'hex');
  for (const candidate of [signature, Buffer.concat([signature, Buffer.from([sighashType])])]) {
    try {
      const decoded = bitcoin.script.signature.decode(candidate);
      if (decoded.hashType === sighashType) return candidate;
    } catch {
      // Try the alternate Connect encoding.
    }
  }
  throw new Error(`Hardware signed fixture ${vectorId} contains malformed Trezor ECDSA signature`);
};

const normalizeTaprootSignature = (
  signatureHex: string,
  sighashType: number,
  vectorId: string
): Buffer => {
  const signature = Buffer.from(signatureHex, 'hex');
  const validDefault =
    signature.length === 64 && sighashType === bitcoin.Transaction.SIGHASH_DEFAULT;
  const validExplicit =
    signature.length === 65 &&
    signature[64] === sighashType &&
    sighashType !== bitcoin.Transaction.SIGHASH_DEFAULT;
  if (!validDefault && !validExplicit) {
    throw new Error(
      `Hardware signed fixture ${vectorId} contains malformed Trezor Taproot signature`
    );
  }
  return signature;
};

const signerDerivation = (
  vector: HardwareSignedPsbtVector,
  input: PsbtInput,
  inputIndex: number
) => {
  const derivations =
    vector.scriptType === 'p2tr' ? input.tapBip32Derivation : input.bip32Derivation;
  const matches = (derivations ?? []).filter((derivation) =>
    vector.signedBy.some(
      (signer) =>
        Buffer.from(derivation.masterFingerprint).toString('hex') ===
          signer.fingerprint.toLowerCase() &&
        derivation.path === signer.derivationPath &&
        Buffer.from(derivation.pubkey).toString('hex') === signer.pubkey.toLowerCase()
    )
  );
  if (matches.length !== 1) {
    throw new Error(
      `Hardware signed fixture ${vector.id} input ${inputIndex} signer attribution mismatch`
    );
  }
  assertHardwareDerivationPubkey(vector, matches[0]);
  return matches[0];
};

function applyTrezorSignatures(vector: HardwareSignedPsbtVector, psbt: bitcoin.Psbt): bitcoin.Psbt {
  if (vector.artifact.type !== 'trezor-connect-transaction') {
    throw new Error(
      `Hardware signed fixture ${vector.id} does not contain a Trezor artifact tuple`
    );
  }
  if (vector.artifact.connectSignatures.length !== psbt.inputCount) {
    throw new Error(`Hardware signed fixture ${vector.id} Trezor signature count mismatch`);
  }
  const signed = psbt.clone();
  vector.artifact.connectSignatures.forEach((signatureHex, inputIndex) => {
    const input = signed.data.inputs[inputIndex];
    const derivation = signerDerivation(vector, input, inputIndex);
    if (vector.scriptType === 'p2tr') {
      const sighash = input.sighashType ?? bitcoin.Transaction.SIGHASH_DEFAULT;
      input.tapKeySig = normalizeTaprootSignature(signatureHex, sighash, vector.id);
    } else {
      const sighash = input.sighashType ?? bitcoin.Transaction.SIGHASH_ALL;
      const signature = normalizeEcdsaSignature(signatureHex, sighash, vector.id);
      const existing =
        input.partialSig?.filter(
          (partial) => !Buffer.from(partial.pubkey).equals(derivation.pubkey)
        ) ?? [];
      input.partialSig = [...existing, { pubkey: derivation.pubkey, signature }];
    }
    if (!signed.validateSignaturesOfInput(inputIndex, signatureValidator)) {
      throw new Error(
        `Hardware signed fixture ${vector.id} input ${inputIndex} signature is invalid`
      );
    }
  });
  return signed;
}

function validateSignedPsbtAttribution(vector: HardwareSignedPsbtVector, psbt: bitcoin.Psbt): void {
  psbt.data.inputs.forEach((input, inputIndex) => {
    const derivation = signerDerivation(vector, input, inputIndex);
    const hasSignature =
      vector.scriptType === 'p2tr'
        ? Boolean(input.tapKeySig)
        : Boolean(
            input.partialSig?.some((partial) =>
              Buffer.from(partial.pubkey).equals(derivation.pubkey)
            )
          );
    if (!hasSignature || !psbt.validateSignaturesOfInput(inputIndex, signatureValidator)) {
      throw new Error(
        `Hardware signed fixture ${vector.id} input ${inputIndex} signer evidence is invalid`
      );
    }
  });
}

export const expectedLedgerSignaturePubkey = (
  scriptType: HardwareSignedScriptType,
  input: PsbtInput,
  derivationPubkey: Uint8Array,
): Uint8Array => {
  if (scriptType !== 'p2tr') return derivationPubkey;
  const script = input.witnessUtxo?.script;
  if (!script || script.length !== 34 || script[0] !== 0x51 || script[1] !== 0x20) {
    throw new Error('Ledger Taproot evidence is missing its verified output key');
  }
  return script.slice(2);
};

function applyLedgerSignatures(
  vector: HardwareSignedPsbtVector,
  sourcePsbt: bitcoin.Psbt,
): bitcoin.Psbt {
  if (vector.artifact.type !== 'ledger-signed-psbt') {
    throw new Error(`Hardware signed fixture ${vector.id} does not contain a Ledger artifact tuple`);
  }
  if (vector.artifact.sourcePsbtBase64 !== vector.unsignedPsbtBase64) {
    throw new Error(`Hardware signed fixture ${vector.id} Ledger source PSBT mismatch`);
  }
  const inputIndexes = vector.artifact.signatures.map((signature) => signature.inputIndex);
  if (new Set(inputIndexes).size !== inputIndexes.length) {
    throw new Error(`Hardware signed fixture ${vector.id} Ledger signature indexes are duplicated`);
  }
  const signed = sourcePsbt.clone();
  for (const record of vector.artifact.signatures) {
    const input = signed.data.inputs[record.inputIndex];
    if (!input) throw new Error(`Hardware signed fixture ${vector.id} Ledger signature input is absent`);
    const derivation = signerDerivation(vector, input, record.inputIndex);
    const pubkey = Buffer.from(record.pubkey, 'hex');
    const signature = Buffer.from(record.signature, 'hex');
    const expectedPubkey = expectedLedgerSignaturePubkey(
      vector.scriptType,
      input,
      derivation.pubkey,
    );
    if (!pubkey.equals(expectedPubkey)) {
      throw new Error(`Hardware signed fixture ${vector.id} Ledger signature key mismatch`);
    }
    if (record.tapleafHash) {
      throw new Error(`Hardware signed fixture ${vector.id} Ledger Taproot script-path evidence is unsupported`);
    }
    if (vector.scriptType === 'p2tr') {
      if (pubkey.length !== 32 || ![64, 65].includes(signature.length)) {
        throw new Error(`Hardware signed fixture ${vector.id} Ledger Taproot signature is malformed`);
      }
      input.tapKeySig = signature;
    } else {
      if (pubkey.length !== 33 || signature.length === 0) {
        throw new Error(`Hardware signed fixture ${vector.id} Ledger signature is malformed`);
      }
      input.partialSig = [{ pubkey, signature }];
    }
    if (!signed.validateSignaturesOfInput(record.inputIndex, signatureValidator)) {
      throw new Error(`Hardware signed fixture ${vector.id} Ledger signature is invalid`);
    }
  }
  if (signed.toBase64() !== vector.artifact.reconstructedPsbtBase64) {
    throw new Error(`Hardware signed fixture ${vector.id} Ledger reconstructed PSBT mismatch`);
  }
  return signed;
}

const extractHardwareTransaction = (vector: HardwareSignedPsbtVector): {
  transaction: bitcoin.Transaction;
  sourcePsbt: bitcoin.Psbt;
} => {
  const network = networkParams(vector.network);
  const sourcePsbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64, {
    network,
  });
  if (vector.artifact.type === 'signed-psbt') {
    const signedPsbt = bitcoin.Psbt.fromBase64(vector.artifact.signedPsbtBase64, { network });
    assertTransactionIntent(
      vector,
      unsignedTransaction(sourcePsbt),
      unsignedTransaction(signedPsbt)
    );
    validateSignedPsbtAttribution(vector, signedPsbt);
    finalizeHardwarePsbt(signedPsbt, vector.scriptType);
    return { transaction: signedPsbt.extractTransaction(true), sourcePsbt };
  }

  if (vector.artifact.type === 'ledger-signed-psbt') {
    const signedPsbt = applyLedgerSignatures(vector, sourcePsbt);
    assertTransactionIntent(
      vector,
      unsignedTransaction(sourcePsbt),
      unsignedTransaction(signedPsbt),
    );
    finalizeHardwarePsbt(signedPsbt, vector.scriptType);
    return { transaction: signedPsbt.extractTransaction(true), sourcePsbt };
  }

  const signedPsbt = applyTrezorSignatures(vector, sourcePsbt);
  finalizeHardwarePsbt(signedPsbt, vector.scriptType);
  const reconstructed = signedPsbt.extractTransaction(true);
  const returned = bitcoin.Transaction.fromHex(vector.artifact.serializedTxHex);
  assertTransactionIntent(vector, unsignedTransaction(sourcePsbt), returned);
  if (reconstructed.toHex() !== returned.toHex()) {
    throw new Error(
      `Hardware signed fixture ${vector.id} serialized transaction does not bind to Connect signatures`
    );
  }
  return { transaction: returned, sourcePsbt };
};

function previousOutputValue(
  vector: HardwareSignedPsbtVector,
  psbt: bitcoin.Psbt,
  inputIndex: number
): bigint {
  const input = psbt.data.inputs[inputIndex];
  const txInput = psbt.txInputs[inputIndex];
  let value = input.witnessUtxo?.value;
  if (input.nonWitnessUtxo) {
    const previous = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
    const expectedTxid = Buffer.from(txInput.hash).reverse().toString('hex');
    if (previous.getId() !== expectedTxid || !previous.outs[txInput.index]) {
      throw new Error(
        `Hardware signed fixture ${vector.id} input ${inputIndex} previous transaction mismatch`
      );
    }
    const previousValue = previous.outs[txInput.index].value;
    if (value !== undefined && value !== previousValue) {
      throw new Error(
        `Hardware signed fixture ${vector.id} input ${inputIndex} previous output value mismatch`
      );
    }
    if (
      input.witnessUtxo &&
      !Buffer.from(input.witnessUtxo.script).equals(previous.outs[txInput.index].script)
    ) {
      throw new Error(
        `Hardware signed fixture ${vector.id} input ${inputIndex} previous output script mismatch`
      );
    }
    value = previousValue;
  }
  if (value === undefined) {
    throw new Error(
      `Hardware signed fixture ${vector.id} input ${inputIndex} has no authenticated value`
    );
  }
  return value;
}

function authenticatedInputValue(vector: HardwareSignedPsbtVector, psbt: bitcoin.Psbt): number {
  const value = psbt.txInputs.reduce(
    (total, _input, inputIndex) => total + previousOutputValue(vector, psbt, inputIndex),
    0n
  );
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Hardware signed fixture ${vector.id} input total exceeds safe integer range`);
  }
  return Number(value);
}

function outputAddress(output: TransactionOutput, network: bitcoin.Network): string {
  try {
    return bitcoin.address.fromOutputScript(output.script, network);
  } catch {
    return Buffer.from(output.script).toString('hex');
  }
}

function replayOutputs(tx: bitcoin.Transaction, network: bitcoin.Network): ReplayOutput[] {
  return tx.outs.map((output, index) => ({
    index,
    address: outputAddress(output, network),
    valueSats: Number(output.value),
  }));
}

function validateOutputs(vector: HardwareSignedPsbtVector, outputs: ReplayOutput[]): void {
  const indices = vector.expectedOutputs.map((output) => output.index);
  const unique = new Set(indices);
  const contiguous = indices.every((index, position) => index === position);
  if (
    unique.size !== indices.length ||
    !contiguous ||
    outputs.length !== vector.expectedOutputs.length
  ) {
    throw new Error(
      `Hardware signed fixture ${vector.id} expected outputs must exactly cover the transaction`
    );
  }
  vector.expectedOutputs.forEach((expected) => {
    const actual = outputs[expected.index];
    if (actual.address !== expected.address || actual.valueSats !== expected.valueSats) {
      throw new Error(`Hardware signed fixture ${vector.id} output ${expected.index} mismatch`);
    }
  });
}

function derivationMatchesAccount(
  vector: HardwareSignedPsbtVector,
  derivation: {
    masterFingerprint: Uint8Array;
    path: string;
    pubkey: Uint8Array;
  }
): boolean {
  return (
    Buffer.from(derivation.masterFingerprint).toString('hex') ===
      vector.account.fingerprint.toLowerCase() &&
    derivation.path.startsWith(`${vector.account.accountPath}/`)
  );
}

function expectedSingleSigChangeScript(
  vector: HardwareSignedPsbtVector,
  pubkey: Uint8Array
): Uint8Array | undefined {
  const network = networkParams(vector.network);
  if (vector.scriptType === 'p2pkh') return bitcoin.payments.p2pkh({ pubkey, network }).output;
  if (vector.scriptType === 'p2wpkh') return bitcoin.payments.p2wpkh({ pubkey, network }).output;
  if (vector.scriptType === 'p2sh-p2wpkh') {
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
      network,
    }).output;
  }
  if (vector.scriptType === 'p2tr')
    return bitcoin.payments.p2tr({ internalPubkey: pubkey, network }).output;
  return undefined;
}

function expectedMultisigChangeScript(
  vector: HardwareSignedPsbtVector,
  output: PsbtOutput
): Uint8Array | undefined {
  if (!output.witnessScript) return undefined;
  const network = networkParams(vector.network);
  const witness = bitcoin.payments.p2wsh({
    redeem: { output: output.witnessScript },
    network,
  });
  if (vector.scriptType === 'p2wsh') return witness.output;
  if (
    !output.redeemScript ||
    !witness.output ||
    !Buffer.from(output.redeemScript).equals(witness.output)
  )
    return undefined;
  return bitcoin.payments.p2sh({ redeem: witness, network }).output;
}

const validateChangeScript = (
  vector: HardwareSignedPsbtVector,
  sourcePsbt: bitcoin.Psbt,
  outputIndex: number,
  derivations: HardwareSignedDerivation[]
): void => {
  const output = sourcePsbt.data.outputs[outputIndex];
  const expectedScript = MULTISIG_SCRIPT_TYPES.includes(vector.scriptType)
    ? expectedMultisigChangeScript(vector, output)
    : derivations.length === 1
      ? expectedSingleSigChangeScript(vector, derivations[0].pubkey)
      : undefined;
  const actualScript = sourcePsbt.txOutputs[outputIndex]?.script;
  if (!expectedScript || !actualScript || !Buffer.from(expectedScript).equals(actualScript)) {
    throw new Error(
      `Hardware signed fixture ${vector.id} output ${outputIndex} change script mismatch`
    );
  }
  if (
    MULTISIG_SCRIPT_TYPES.includes(vector.scriptType) &&
    !derivations.every(
      (derivation) =>
        output.witnessScript &&
        Buffer.from(output.witnessScript).includes(Buffer.from(derivation.pubkey))
    )
  ) {
    throw new Error(
      `Hardware signed fixture ${vector.id} output ${outputIndex} change cosigner mismatch`
    );
  }
};

const validateChangeBinding = (
  vector: HardwareSignedPsbtVector,
  sourcePsbt: bitcoin.Psbt
): void => {
  vector.expectedOutputs.forEach((expected) => {
    const output = sourcePsbt.data.outputs[expected.index];
    const derivations =
      vector.scriptType === 'p2tr' ? output.tapBip32Derivation : output.bip32Derivation;
    const selectedAccountDerivations = (derivations ?? []).filter((derivation) =>
      derivationMatchesAccount(vector, derivation)
    );
    if (expected.isChange) {
      if (
        !expected.derivationPath ||
        !selectedAccountDerivations.some(
          (derivation) => derivation.path === expected.derivationPath
        )
      ) {
        throw new Error(
          `Hardware signed fixture ${vector.id} output ${expected.index} change binding mismatch`
        );
      }
      validateChangeScript(vector, sourcePsbt, expected.index, selectedAccountDerivations);
    } else if (selectedAccountDerivations.length > 0) {
      throw new Error(
        `Hardware signed fixture ${vector.id} output ${expected.index} hides device-owned change`
      );
    }
  });
};

const validateCoreAcceptance = (
  vector: HardwareSignedPsbtVector,
  transaction: bitcoin.Transaction,
  feeSats: number
): void => {
  const transcript = vector.evidence.coreAcceptance;
  let request: { id?: unknown; method?: unknown; params?: unknown };
  let response: { id?: unknown; error?: unknown; result?: unknown };
  try {
    request = JSON.parse(transcript.requestJson) as typeof request;
    response = JSON.parse(transcript.responseJson) as typeof response;
  } catch {
    throw new Error(
      `Hardware signed fixture ${vector.id} Core acceptance transcript is not valid JSON`
    );
  }
  const rawTxHex = transaction.toHex();
  const wtxid = Buffer.from(transaction.getHash(true)).reverse().toString('hex');
  const requestMatches =
    request.id === transcript.invocationId &&
    request.method === 'testmempoolaccept' &&
    Array.isArray(request.params) &&
    request.params.length === 1 &&
    Array.isArray(request.params[0]) &&
    request.params[0].length === 1 &&
    request.params[0][0] === rawTxHex;
  const results = Array.isArray(response.result) ? response.result : [];
  const result = results[0] as Record<string, unknown> | undefined;
  const fees = result?.fees as Record<string, unknown> | undefined;
  const responseMatches =
    response.id === transcript.invocationId &&
    response.error === null &&
    results.length === 1 &&
    result?.txid === transaction.getId() &&
    result?.wtxid === wtxid &&
    result?.allowed === true &&
    result?.vsize === transaction.virtualSize() &&
    typeof fees?.base === 'number' &&
    Math.round(fees.base * 100_000_000) === feeSats;
  if (!requestMatches || !responseMatches) {
    throw new Error(
      `Hardware signed fixture ${vector.id} Bitcoin Core acceptance evidence mismatch`
    );
  }
};

export function replayHardwareSignedVector(
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext = EMPTY_HARDWARE_EVIDENCE_TRUST
): HardwareSignedReplayResult {
  validateVectorMetadata(vector);
  assertHardwareSignedFixtureIntake(vector, context);
  const policyPsbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64, {
    network: networkParams(vector.network),
  });
  validateHardwarePsbtPolicyBinding(vector, policyPsbt);
  validateHardwareAddressDerivation(vector);
  const { transaction, sourcePsbt } = extractHardwareTransaction(vector);
  const outputs = replayOutputs(transaction, networkParams(vector.network));
  const inputValueSats = authenticatedInputValue(vector, sourcePsbt);
  if (inputValueSats !== vector.inputValueSats) {
    throw new Error(`Hardware signed fixture ${vector.id} declared input value mismatch`);
  }
  const outputValueSats = outputs.reduce((total, output) => total + output.valueSats, 0);
  const result = {
    txid: transaction.getId(),
    feeSats: inputValueSats - outputValueSats,
    vsize: transaction.virtualSize(),
    outputs,
  };
  if (result.txid !== vector.expectedTxid)
    throw new Error(`Hardware signed fixture ${vector.id} txid mismatch`);
  if (result.feeSats !== vector.expectedFeeSats)
    throw new Error(`Hardware signed fixture ${vector.id} fee mismatch`);
  if (result.vsize !== vector.expectedVsize)
    throw new Error(`Hardware signed fixture ${vector.id} vsize mismatch`);
  validateOutputs(vector, outputs);
  validateChangeBinding(vector, sourcePsbt);
  validateCoreAcceptance(vector, transaction, result.feeSats);
  return result;
}

export function missingHardwareSignedRows(
  requiredRows: RequiredHardwareSignedRow[],
  fixtures: HardwareSignedPsbtVector[],
  unsupportedRows: UnsupportedHardwareSignedRow[]
): RequiredHardwareSignedRow[] {
  const coveredRows = new Set(fixtures.map(rowKey));
  const unsupported = new Set(unsupportedRows.map(rowKey));
  return requiredRows.filter(
    (row) => !coveredRows.has(rowKey(row)) && !unsupported.has(rowKey(row))
  );
}

export function unaccountedHardwareSignedRows(
  requiredRows: RequiredHardwareSignedRow[],
  fixtures: HardwareSignedPsbtVector[],
  unsupportedRows: UnsupportedHardwareSignedRow[],
  blockedRows: BlockedHardwareSignedRow[]
): RequiredHardwareSignedRow[] {
  const accounted = new Set([...fixtures, ...unsupportedRows, ...blockedRows].map(rowKey));
  return requiredRows.filter((row) => !accounted.has(rowKey(row)));
}
