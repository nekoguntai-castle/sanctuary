/**
 * BIP78 original PSBT construction.
 *
 * BIP78 requires the original sent to a receiver to be finalized and
 * broadcastable, with every input's UTXO data and without global xpubs or key
 * paths. The intent's stored PSBT supplies the transaction shape and UTXO
 * data; the artifact-validated signed transaction supplies the final scripts.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { witnessStackToScriptWitness } from '../bitcoin/psbtBuilder';

const mismatch = (): Error => new Error('BIP78 original does not reproduce the signed transaction');

/**
 * Rebuild the intent's PSBT as a finalized BIP78 original carrying the signed
 * transaction's scripts. Throws when the input counts differ or the rebuilt
 * PSBT does not extract to exactly `rawTx`, so the receiver never sees a
 * transaction other than the one the artifact validation approved.
 */
export const buildBip78OriginalPsbt = (
  unsignedPsbtBase64: string,
  rawTx: string,
  network: bitcoin.Network,
): string => {
  const source = bitcoin.Psbt.fromBase64(unsignedPsbtBase64, { network });
  const signed = bitcoin.Transaction.fromHex(rawTx);
  if (signed.ins.length !== source.inputCount) throw mismatch();
  const original = new bitcoin.Psbt({ network });
  original.setVersion(source.version);
  original.setLocktime(source.locktime);
  source.txInputs.forEach((input, index) => {
    const { witnessUtxo, nonWitnessUtxo } = source.data.inputs[index];
    original.addInput({
      hash: input.hash,
      index: input.index,
      sequence: input.sequence,
      ...(witnessUtxo && { witnessUtxo }),
      ...(nonWitnessUtxo && { nonWitnessUtxo }),
    });
    const { witness, script } = signed.ins[index];
    original.updateInput(index, {
      ...(witness.length > 0 && {
        finalScriptWitness: witnessStackToScriptWitness(witness.map(item => Buffer.from(item))),
      }),
      ...(script.length > 0 && { finalScriptSig: script }),
    });
  });
  source.txOutputs.forEach(output => original.addOutput({ script: output.script, value: output.value }));
  if (original.extractTransaction(true).toHex() !== rawTx) throw mismatch();
  return original.toBase64();
};
