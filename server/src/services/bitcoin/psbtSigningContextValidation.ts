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

const bindingError = (message: string): Error => new Error(`PSBT account binding failed: ${message}`);

function expectedDerivations(origins: readonly PsbtSignerOrigin[]): PsbtDerivation[] {
  return origins.map(origin => ({
    masterFingerprint: Buffer.from(origin.masterFingerprint, 'hex'),
    path: origin.path,
    pubkey: Buffer.from(origin.pubkey, 'hex'),
  }));
}

function sameDerivations(actual: readonly PsbtDerivation[] | undefined, expected: readonly PsbtDerivation[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const identity = (item: PsbtDerivation) => [
    Buffer.from(item.masterFingerprint).toString('hex'),
    item.path,
    Buffer.from(item.pubkey).toString('hex'),
  ].join(':');
  const actualIdentities = actual.map(identity).sort();
  const expectedIdentities = expected.map(identity).sort();
  return actualIdentities.every((value, index) => value === expectedIdentities[index]);
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
): void {
  // Role coverage above proves every context index is an existing PSBT input.
  const txInput = psbt.txInputs[binding.inputIndex]!;
  const prevout = inputPrevout(psbt, binding.inputIndex, requiresNonWitnessUtxo);
  if (Buffer.from(txInput.hash).reverse().toString('hex') !== binding.txid
    || txInput.index !== binding.vout || prevout.value.toString() !== binding.amountSats
    || Buffer.from(prevout.script).toString('hex') !== binding.scriptPubKey
    || !sameDerivations(
      psbt.data.inputs[binding.inputIndex].bip32Derivation,
      expectedDerivations(binding.signerOrigins),
    )) throw bindingError(`context input ${binding.inputIndex} does not match the PSBT`);
}

function assertContextChange(psbt: bitcoin.Psbt, binding: PsbtChangeBinding): void {
  const output = psbt.txOutputs[binding.outputIndex];
  if (!output || output.value.toString() !== binding.amountSats
    || Buffer.from(output.script).toString('hex') !== binding.scriptPubKey
    || !sameDerivations(
      psbt.data.outputs[binding.outputIndex].bip32Derivation,
      expectedDerivations(binding.signerOrigins),
    )) throw bindingError(`context change output ${binding.outputIndex} does not match the PSBT`);
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
  for (const input of context.inputs) {
    assertContextInput(psbt, input, requiresNonWitnessUtxo);
  }
  const changeIndexes = context.changeOutputs.map(output => output.outputIndex);
  if (new Set(changeIndexes).size !== changeIndexes.length) {
    throw bindingError('context contains duplicate change output claims');
  }
  for (const output of context.changeOutputs) assertContextChange(psbt, output);
}
