import * as bitcoin from 'bitcoinjs-lib';
import { createHash } from 'node:crypto';
import type {
  PsbtChangeBinding,
  PsbtInputBinding,
  PsbtSignerOrigin,
  PsbtSigningContext,
} from '@sanctuary/shared/schemas/psbtSigningContext';

type SigningInputRole = 'wallet' | 'payjoin_peer';
type PsbtDerivation = NonNullable<bitcoin.Psbt['data']['inputs'][number]['bip32Derivation']>[number];
type PsbtTapDerivation = NonNullable<bitcoin.Psbt['data']['inputs'][number]['tapBip32Derivation']>[number];
type BoundMap = bitcoin.Psbt['data']['inputs'][number] | bitcoin.Psbt['data']['outputs'][number];
type BoundMapKind = 'input' | 'output';

const bindingError = (message: string): Error => new Error(`PSBT account binding failed: ${message}`);

function expectedDerivations(origins: readonly PsbtSignerOrigin[]): PsbtDerivation[] {
  return origins.map(origin => ({
    masterFingerprint: Buffer.from(origin.masterFingerprint, 'hex'),
    path: origin.path,
    pubkey: Buffer.from(origin.pubkey, 'hex'),
  }));
}

const derivationIdentity = (item: PsbtDerivation): string => {
  const fingerprint = Buffer.from(item.masterFingerprint).toString('hex');
  const pubkey = Buffer.from(item.pubkey).toString('hex');
  return fingerprint.concat(':', item.path, ':', pubkey);
};

const sameDerivations = (
  actual: readonly PsbtDerivation[] | undefined,
  expected: readonly PsbtDerivation[],
): boolean => {
  if (!actual || actual.length !== expected.length) return false;
  const actualIdentities = actual.map(derivationIdentity).sort();
  const expectedIdentities = expected.map(derivationIdentity).sort();
  for (let index = 0; index < actualIdentities.length; index += 1) {
    if (actualIdentities[index] !== expectedIdentities[index]) return false;
  }
  return true;
};

function expectedTapDerivations(origins: readonly PsbtSignerOrigin[]): PsbtTapDerivation[] {
  return expectedDerivations(origins).map(origin => ({ ...origin, leafHashes: [] }));
}

const sameTapDerivations = (
  actual: readonly PsbtTapDerivation[] | undefined,
  expected: readonly PsbtTapDerivation[],
): boolean => {
  if (!actual) return false;
  for (const item of actual) {
    if (item.leafHashes.length !== 0) return false;
  }
  return sameDerivations(actual, expected);
};

const hasTaprootFields = (map: BoundMap, kind: BoundMapKind): boolean => {
  if (map.tapBip32Derivation !== undefined || map.tapInternalKey !== undefined) return true;
  if (kind === 'input') {
    const input = map as bitcoin.Psbt['data']['inputs'][number];
    return input.tapKeySig !== undefined
      || input.tapScriptSig !== undefined
      || input.tapLeafScript !== undefined
      || input.tapMerkleRoot !== undefined;
  }
  return (map as bitcoin.Psbt['data']['outputs'][number]).tapTree !== undefined;
};

const assertExactDerivationMap = (
  map: BoundMap,
  origins: readonly PsbtSignerOrigin[],
  taproot: boolean,
  kind: BoundMapKind,
): boolean => {
  if (!taproot) {
    return !hasTaprootFields(map, kind)
      && sameDerivations(map.bip32Derivation, expectedDerivations(origins));
  }
  if (origins.length !== 1 || origins[0].pubkey.length !== 64
    || map.bip32Derivation?.length || map.redeemScript || map.witnessScript) return false;
  return Buffer.from(map.tapInternalKey ?? []).toString('hex') === origins[0].pubkey
    && sameTapDerivations(map.tapBip32Derivation, expectedTapDerivations(origins));
};

function hasUnsupportedTaprootInputFields(
  input: bitcoin.Psbt['data']['inputs'][number],
): boolean {
  return Boolean(input.tapLeafScript?.length || input.tapScriptSig?.length || input.tapMerkleRoot);
}

function inputPrevout(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  requiresNonWitnessUtxo: boolean,
) {
  const data = psbt.data.inputs[inputIndex];
  if (requiresNonWitnessUtxo && !data.nonWitnessUtxo) {
    throw bindingError(`legacy context input ${inputIndex} requires a nonWitnessUtxo`);
  }
  let authenticatedPrevious: { script: Uint8Array; value: bigint } | undefined;
  if (data.nonWitnessUtxo) {
    const tx = bitcoin.Transaction.fromBuffer(data.nonWitnessUtxo);
    const expectedTxid = Buffer.from(psbt.txInputs[inputIndex].hash).reverse().toString('hex');
    if (tx.getId() !== expectedTxid) {
      throw bindingError(`context input ${inputIndex} has the wrong nonWitnessUtxo`);
    }
    authenticatedPrevious = tx.outs[psbt.txInputs[inputIndex].index];
    if (!authenticatedPrevious) throw bindingError(`context input ${inputIndex} prevout is missing`);
  }
  if (data.witnessUtxo && authenticatedPrevious
    && (data.witnessUtxo.value !== authenticatedPrevious.value
      || !Buffer.from(data.witnessUtxo.script).equals(Buffer.from(authenticatedPrevious.script)))) {
    throw bindingError(`context input ${inputIndex} witnessUtxo does not match its nonWitnessUtxo`);
  }
  const prevout = data.witnessUtxo ?? authenticatedPrevious;
  if (!prevout) throw bindingError(`context input ${inputIndex} has no prevout`);
  return prevout;
}

function assertContextInput(
  psbt: bitcoin.Psbt,
  binding: PsbtInputBinding,
  requiresNonWitnessUtxo: boolean,
  taproot: boolean,
): void {
  // Role coverage above proves every context index is an existing PSBT input.
  const txInput = psbt.txInputs[binding.inputIndex]!;
  const prevout = inputPrevout(psbt, binding.inputIndex, requiresNonWitnessUtxo);
  if (Buffer.from(txInput.hash).reverse().toString('hex') !== binding.txid
    || txInput.index !== binding.vout || prevout.value.toString() !== binding.amountSats
    || Buffer.from(prevout.script).toString('hex') !== binding.scriptPubKey
    || !assertExactDerivationMap(
      psbt.data.inputs[binding.inputIndex],
      binding.signerOrigins,
      taproot,
      'input',
    ) || (taproot && hasUnsupportedTaprootInputFields(psbt.data.inputs[binding.inputIndex]))) {
    throw bindingError(`context input ${binding.inputIndex} does not match the PSBT`);
  }
}

function assertContextChange(
  psbt: bitcoin.Psbt,
  binding: PsbtChangeBinding,
  taproot: boolean,
): void {
  const output = psbt.txOutputs[binding.outputIndex];
  const map = psbt.data.outputs[binding.outputIndex];
  if (!output || output.value.toString() !== binding.amountSats
    || Buffer.from(output.script).toString('hex') !== binding.scriptPubKey
    || !assertExactDerivationMap(map, binding.signerOrigins, taproot, 'output')
    || (taproot && map.tapTree)) {
    throw bindingError(`context change output ${binding.outputIndex} does not match the PSBT`);
  }
}

/** Re-authenticate persisted context against the exact unsigned PSBT before intent issuance. */
export function assertPsbtMatchesSigningContext(
  psbt: bitcoin.Psbt,
  context: PsbtSigningContext,
  inputRoles: readonly SigningInputRole[],
): void {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  const digest = createHash('sha256').update(Buffer.from(unsignedTx.toBuffer())).digest('hex');
  if (digest !== context.unsignedTransactionDigest) {
    throw bindingError('context unsigned transaction digest does not match PSBT');
  }
  if (inputRoles.length !== psbt.inputCount) throw bindingError('input role count does not match PSBT');
  const walletIndexes = inputRoles.flatMap((role, index) => role === 'wallet' ? [index] : []);
  const contextIndexes = context.inputs.map(input => input.inputIndex);
  if (new Set(contextIndexes).size !== contextIndexes.length
    || walletIndexes.length !== contextIndexes.length
    || walletIndexes.some(index => !contextIndexes.includes(index))) {
    throw bindingError('context does not cover every wallet-owned input exactly once');
  }
  const requiresNonWitnessUtxo = context.scriptType === 'legacy';
  const taproot = context.scriptType === 'taproot';
  for (const input of context.inputs) {
    assertContextInput(psbt, input, requiresNonWitnessUtxo, taproot);
  }
  const changeIndexes = context.changeOutputs.map(output => output.outputIndex);
  if (new Set(changeIndexes).size !== changeIndexes.length) {
    throw bindingError('context contains duplicate change output claims');
  }
  for (const output of context.changeOutputs) assertContextChange(psbt, output, taproot);
}
