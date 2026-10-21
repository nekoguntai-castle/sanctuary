/**
 * Payjoin PSBT fixtures shared by the review-step suites.
 *
 * The P2TR scripts are raw bytes: building or decoding a P2TR address with
 * bitcoinjs needs an initialised ECC library, and these fixtures must not
 * initialise one (the code under test is responsible for that).
 */
import * as bitcoin from 'bitcoinjs-lib';

export const PAYMENT = new Uint8Array([0x00, 0x14, ...new Array(20).fill(0x11)]);
export const CHANGE = new Uint8Array([0x00, 0x14, ...new Array(20).fill(0x22)]);

const p2trScript = (xOnlyKeyHex: string): Uint8Array =>
  Uint8Array.from([0x51, 0x20, ...Buffer.from(xOnlyKeyHex, 'hex')]);

/** BIP86 test vector m/86'/0'/0'/0/0. */
export const P2TR_ADDRESS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
export const P2TR_SCRIPT = p2trScript('a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c');

/** BIP86 test vector m/86'/0'/0'/1/0. */
export const P2TR_CHANGE_ADDRESS = 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7';
export const P2TR_CHANGE_SCRIPT = p2trScript('882d74e5d0572d5a816cef0041a96b6c1de832f6f9676d9605c44d5e9a97d3dc');

/** An unsigned PSBT with these outputs (and `inputCount` placeholder inputs). */
export const psbtWithOutputs = (outputs: Array<[Uint8Array, number]>, inputCount = 1): string => {
  const psbt = new bitcoin.Psbt();
  for (let index = 0; index < inputCount; index += 1) {
    psbt.addInput({ hash: String.fromCharCode(97 + index).repeat(64), index: 0 });
  }
  outputs.forEach(([script, value]) => psbt.addOutput({ script, value: BigInt(value) }));
  return psbt.toBase64();
};
