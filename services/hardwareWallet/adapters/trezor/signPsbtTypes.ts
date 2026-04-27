import * as bitcoin from 'bitcoinjs-lib';

export type TrezorSpendScriptType =
  'SPENDADDRESS' |
  'SPENDP2SHWITNESS' |
  'SPENDWITNESS' |
  'SPENDTAPROOT';

export type TrezorPayToScriptType =
  'PAYTOADDRESS' |
  'PAYTOP2SHWITNESS' |
  'PAYTOWITNESS' |
  'PAYTOTAPROOT';

export type TrezorPsbt = bitcoin.Psbt;
export type TrezorPsbtInput = TrezorPsbt['data']['inputs'][number];
export type TrezorPsbtOutput = TrezorPsbt['data']['outputs'][number];
export type TrezorTxInput = TrezorPsbt['txInputs'][number];
export type TrezorTxOutput = TrezorPsbt['txOutputs'][number];
export type TrezorBip32Derivation = NonNullable<TrezorPsbtInput['bip32Derivation']>[number];
