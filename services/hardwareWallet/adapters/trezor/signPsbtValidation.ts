import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { uint8ArrayEquals, toHex } from '../../../../utils/bufferUtils';
import type { TrezorPsbt } from './signPsbtTypes';

const log = createLogger('TrezorAdapter');

export const logRefTxAmountMismatches = (psbt: TrezorPsbt, refTxs: any[]): void => {
  for (let i = 0; i < psbt.txInputs.length; i++) {
    const txInput = psbt.txInputs[i];
    const psbtInput = psbt.data.inputs[i];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');
    const refOutput = refTxs.find(rt => rt.hash === txid)?.bin_outputs?.[txInput.index];

    if (refOutput && psbtInput.witnessUtxo && psbtInput.witnessUtxo.value != refOutput.amount) { // eslint-disable-line eqeqeq
      log.error('Input amount mismatch between PSBT and reference transaction', {
        inputIndex: i,
        txid,
        vout: txInput.index,
        psbtAmount: psbtInput.witnessUtxo.value,
        refAmount: refOutput.amount,
      });
    }
  }
};

export const getUnsignedTransactionFromPsbt = (psbt: TrezorPsbt): bitcoin.Transaction => {
  const psbtTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  return bitcoin.Transaction.fromBuffer(psbtTx.toBuffer());
};

export const getSerializedTrezorTx = (result: any): string | undefined => {
  if (result.success) {
    return result.payload.serializedTx;
  }

  const errorMsg = 'error' in result.payload ? result.payload.error : 'Signing failed';
  throw new Error(errorMsg);
};

const logVersionLocktimeMismatches = (
  txFromPsbt: bitcoin.Transaction,
  signedTx: bitcoin.Transaction
): void => {
  if (txFromPsbt.version !== signedTx.version) {
    log.error('Transaction version mismatch - Trezor signed different version', {
      psbtVersion: txFromPsbt.version,
      trezorVersion: signedTx.version,
    });
  }

  if (txFromPsbt.locktime !== signedTx.locktime) {
    log.error('Transaction locktime mismatch', {
      psbtLocktime: txFromPsbt.locktime,
      trezorLocktime: signedTx.locktime,
    });
  }
};

const logOutputMismatches = (txFromPsbt: bitcoin.Transaction, signedTx: bitcoin.Transaction): void => {
  for (let i = 0; i < Math.min(txFromPsbt.outs.length, signedTx.outs.length); i++) {
    const psbtOut = txFromPsbt.outs[i];
    const trezorOut = signedTx.outs[i];
    if (psbtOut.value !== trezorOut.value || !uint8ArrayEquals(psbtOut.script, trezorOut.script)) {
      log.error('Output mismatch between PSBT and Trezor signed transaction', {
        outputIndex: i,
        psbtValue: psbtOut.value,
        trezorValue: trezorOut.value,
        psbtScriptHex: toHex(psbtOut.script),
        trezorScriptHex: toHex(trezorOut.script),
      });
    }
  }
};

const logInputMismatches = (txFromPsbt: bitcoin.Transaction, signedTx: bitcoin.Transaction): void => {
  for (let i = 0; i < Math.min(txFromPsbt.ins.length, signedTx.ins.length); i++) {
    const psbtIn = txFromPsbt.ins[i];
    const trezorIn = signedTx.ins[i];
    if (!uint8ArrayEquals(psbtIn.hash, trezorIn.hash) ||
      psbtIn.index !== trezorIn.index ||
      psbtIn.sequence !== trezorIn.sequence) {
      log.error('Input mismatch between PSBT and Trezor signed transaction', {
        inputIndex: i,
        psbtPrevHash: toHex(Buffer.from(psbtIn.hash).reverse()),
        trezorPrevHash: toHex(Buffer.from(trezorIn.hash).reverse()),
        psbtPrevIndex: psbtIn.index,
        trezorPrevIndex: trezorIn.index,
        psbtSequence: psbtIn.sequence,
        trezorSequence: trezorIn.sequence,
      });
    }
  }
};

export const logSignedTxMismatches = (txFromPsbt: bitcoin.Transaction, signedTxHex: string): void => {
  const signedTx = bitcoin.Transaction.fromHex(signedTxHex);
  logVersionLocktimeMismatches(txFromPsbt, signedTx);
  logOutputMismatches(txFromPsbt, signedTx);
  logInputMismatches(txFromPsbt, signedTx);
};
