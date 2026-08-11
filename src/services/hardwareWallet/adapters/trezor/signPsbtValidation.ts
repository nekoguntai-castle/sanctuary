import * as bitcoin from 'bitcoinjs-lib';
import { uint8ArrayEquals } from '../../../../utils/bufferUtils';
import type { TrezorPsbt } from './signPsbtTypes';

const artifactError = (detail: string): Error =>
  new Error(`Trezor signed artifact mismatch: ${detail}`);

export const assertRefTxAmountsMatch = (psbt: TrezorPsbt, refTxs: any[]): void => {
  for (const [index, txInput] of psbt.txInputs.entries()) {
    const psbtInput = psbt.data.inputs[index];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const refTx = refTxs.find((refTx) => refTx.hash === txid);
    if (!refTx) continue;
    const refOutput = refTx.bin_outputs?.[txInput.index];
    if (!refOutput) throw artifactError(`reference output is missing on input ${index}`);
    if (
      psbtInput.witnessUtxo &&
      (BigInt(refOutput.amount) !== psbtInput.witnessUtxo.value ||
        typeof refOutput.script_pubkey !== 'string' ||
        refOutput.script_pubkey.toLowerCase() !==
          Buffer.from(psbtInput.witnessUtxo.script).toString('hex'))
    ) {
      throw artifactError(`reference output differs on input ${index}`);
    }
  }
};

export const getUnsignedTransactionFromPsbt = (psbt: TrezorPsbt): bitcoin.Transaction => {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(psbtTx.toBuffer());
};

export const getSerializedTrezorTx = (result: any): string => {
  if (!result.success) {
    const errorMsg = 'error' in result.payload ? result.payload.error : 'Signing failed';
    throw new Error(errorMsg);
  }
  if (typeof result.payload.serializedTx !== 'string' || result.payload.serializedTx.length === 0) {
    throw artifactError('Connect returned no serialized transaction');
  }
  return result.payload.serializedTx;
};

function assertTransactionHeader(expected: bitcoin.Transaction, actual: bitcoin.Transaction): void {
  if (expected.version !== actual.version) throw artifactError('transaction version differs');
  if (expected.locktime !== actual.locktime) throw artifactError('transaction locktime differs');
  if (expected.ins.length !== actual.ins.length) throw artifactError('input count differs');
  if (expected.outs.length !== actual.outs.length) throw artifactError('output count differs');
}

function assertTransactionInputs(expected: bitcoin.Transaction, actual: bitcoin.Transaction): void {
  for (const [index, expectedInput] of expected.ins.entries()) {
    const actualInput = actual.ins[index];
    if (
      !uint8ArrayEquals(expectedInput.hash, actualInput.hash) ||
      expectedInput.index !== actualInput.index ||
      expectedInput.sequence !== actualInput.sequence
    ) {
      throw artifactError(`input ${index} outpoint or sequence differs`);
    }
  }
}

function assertTransactionOutputs(
  expected: bitcoin.Transaction,
  actual: bitcoin.Transaction
): void {
  for (const [index, expectedOutput] of expected.outs.entries()) {
    const actualOutput = actual.outs[index];
    if (
      expectedOutput.value !== actualOutput.value ||
      !uint8ArrayEquals(expectedOutput.script, actualOutput.script)
    ) {
      throw artifactError(`output ${index} value or script differs`);
    }
  }
}

/** Require the device serialization to preserve every unsigned transaction field. */
export const assertSignedTransactionIntent = (
  unsignedTransaction: bitcoin.Transaction,
  signedTxHex: string
): bitcoin.Transaction => {
  let signedTransaction: bitcoin.Transaction;
  try {
    signedTransaction = bitcoin.Transaction.fromHex(signedTxHex);
  } catch {
    throw artifactError('serialized transaction is malformed');
  }
  assertTransactionHeader(unsignedTransaction, signedTransaction);
  assertTransactionInputs(unsignedTransaction, signedTransaction);
  assertTransactionOutputs(unsignedTransaction, signedTransaction);
  return signedTransaction;
};

function inputStack(transaction: bitcoin.Transaction, inputIndex: number): Buffer[] {
  const input = transaction.ins[inputIndex];
  const scriptItems = bitcoin.script.decompile(Uint8Array.from(input.script)) ?? [];
  return [
    ...scriptItems
      .filter((item): item is Uint8Array => item instanceof Uint8Array)
      .map(Buffer.from),
    ...input.witness.map(Buffer.from),
  ];
}

function assertSignaturePresent(stack: Buffer[], signature: Uint8Array, inputIndex: number): void {
  const expected = Buffer.from(signature);
  const matches = stack.filter((item) => item.equals(expected));
  if (matches.length !== 1) {
    throw artifactError(`input ${inputIndex} does not contain exactly one authenticated signature`);
  }
}

function assertKnownSignaturesEmbedded(
  psbt: TrezorPsbt,
  signedTransaction: bitcoin.Transaction
): void {
  for (const [inputIndex, input] of psbt.data.inputs.entries()) {
    const stack = inputStack(signedTransaction, inputIndex);
    for (const partial of input.partialSig ?? []) {
      assertSignaturePresent(stack, partial.signature, inputIndex);
    }
    if (input.tapKeySig) assertSignaturePresent(stack, input.tapKeySig, inputIndex);
  }
}

function assertFinalTransactionMatchesPsbt(
  psbt: TrezorPsbt,
  signedTransaction: bitcoin.Transaction
): void {
  const finalPsbt = psbt.clone();
  try {
    finalPsbt.finalizeAllInputs();
  } catch {
    throw artifactError(
      'complete Trezor artifact cannot be finalized from the authenticated signatures'
    );
  }
  const expected = finalPsbt.extractTransaction();
  if (!Buffer.from(expected.toBuffer()).equals(Buffer.from(signedTransaction.toBuffer()))) {
    throw artifactError('serialized transaction differs from the authenticated finalized PSBT');
  }
}

/** Prove serialized output embeds the validated signatures and, when complete, exact final PSBT. */
export function assertAuthenticatedTrezorArtifact(
  validatedPsbt: TrezorPsbt,
  signedTxHex: string,
  requireFinalTransaction: boolean
): void {
  const unsigned = getUnsignedTransactionFromPsbt(validatedPsbt);
  const signed = assertSignedTransactionIntent(unsigned, signedTxHex);
  assertKnownSignaturesEmbedded(validatedPsbt, signed);
  if (requireFinalTransaction) assertFinalTransactionMatchesPsbt(validatedPsbt, signed);
}
