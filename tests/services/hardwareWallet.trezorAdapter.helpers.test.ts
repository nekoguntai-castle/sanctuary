/**
 * Trezor adapter helper coverage tests
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { describe, expect, it, vi } from 'vitest';
import {
  createMultisigPsbt,
  createSingleSigPsbt,
  hexToBytes,
  slip132Key,
} from './hardwareWallet/trezorAdapterTestHarness';

vi.mock('@trezor/connect-web', () => ({
  asDeviceUniquePath: (path: string) => path,
  default: {
    init: vi.fn(),
    getFeatures: vi.fn(),
    getDeviceState: vi.fn(),
    getPublicKey: vi.fn(),
    getAddress: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

vi.mock('../../src/api/client', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  buildTrezorMultisig,
  convertToStandardXpub,
  getAccountPathPrefix,
  getTrezorScriptType,
  isBip48MultisigPath,
  validateSatoshiAmount,
} from '../../src/services/hardwareWallet/adapters/trezor';
import {
  buildTrezorInputs,
  buildTrezorOutputs,
} from '../../src/services/hardwareWallet/adapters/trezor/signPsbtPayloads';

describe('Trezor helper functions', () => {
  it('validates satoshi amounts for number and bigint', () => {
    expect(validateSatoshiAmount(123, 'test')).toBe('123');
    expect(validateSatoshiAmount(123n, 'test')).toBe('123');
    expect(() => validateSatoshiAmount(undefined, 'ctx')).toThrow('ctx: amount is missing');
    expect(() => validateSatoshiAmount(-1, 'ctx')).toThrow('ctx: invalid amount');
  });

  it('converts SLIP-132 pubkeys to standard xpub/tpub', () => {
    const zpubLike = slip132Key('04b24746');
    const vpubLike = slip132Key('045f1cf6');
    const already = slip132Key('0488b21e');
    const unknownVersion = slip132Key('01020304');
    const invalid = 'not-a-valid-base58';

    const convertedMain = convertToStandardXpub(zpubLike);
    const convertedTest = convertToStandardXpub(vpubLike);
    const unchanged = convertToStandardXpub(already);
    const unknownUnchanged = convertToStandardXpub(unknownVersion);
    const passthrough = convertToStandardXpub(invalid);

    expect(convertedMain.startsWith('xpub')).toBe(true);
    expect(convertedTest.startsWith('tpub')).toBe(true);
    expect(unchanged).toBe(already);
    expect(unknownUnchanged).toBe(unknownVersion);
    expect(passthrough).toBe(invalid);
  });

  it('maps derivation paths to trezor script types', () => {
    expect(getTrezorScriptType("m/44'/0'/0'")).toBe('SPENDADDRESS');
    expect(getTrezorScriptType("m/49'/0'/0'")).toBe('SPENDP2SHWITNESS');
    expect(getTrezorScriptType("m/84'/0'/0'")).toBe('SPENDWITNESS');
    expect(getTrezorScriptType("m/86'/0'/0'")).toBe('SPENDTAPROOT');
    expect(getTrezorScriptType("m/48'/0'/0'/2'")).toBe('SPENDWITNESS');
    expect(getTrezorScriptType("m/48'/0'/0'/1'")).toBe('SPENDP2SHWITNESS');
    expect(getTrezorScriptType('m/99/0/0')).toBe('SPENDWITNESS');
  });

  it('identifies BIP48 paths and account prefixes', () => {
    expect(isBip48MultisigPath("m/48'/0'/0'/2'")).toBe(true);
    expect(isBip48MultisigPath('m/84/0/0')).toBe(false);
    expect(getAccountPathPrefix("m/48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
  });

  it('builds a deterministic no-device Trezor signing payload for spend and change paths', () => {
    const { psbt } = createSingleSigPsbt({
      inputPath: "m/84'/0'/0'/0/7",
      fingerprintHex: 'aabbccdd',
    });
    const changeScript = hexToBytes(`0014${'33'.repeat(20)}`);
    psbt.addOutput({
      script: changeScript,
      value: BigInt(800),
      bip32Derivation: [
        {
          masterFingerprint: hexToBytes('aabbccdd'),
          path: "m/84'/0'/0'/1/2",
          pubkey: hexToBytes(`02${'11'.repeat(32)}`),
        },
      ],
    });

    const request = {
      walletId: 'wallet-1',
      psbt: psbt.toBase64(),
      signingContext: { changeOutputs: [{ outputIndex: 1 }] },
    } as any;
    const deviceFingerprint = Buffer.from('aabbccdd', 'hex');
    const inputs = buildTrezorInputs(psbt, request, 'SPENDWITNESS', deviceFingerprint, 'aabbccdd');
    const outputs = buildTrezorOutputs(
      psbt,
      request,
      'SPENDWITNESS',
      false,
      deviceFingerprint,
      'aabbccdd'
    );

    expect(inputs).toEqual([
      {
        address_n: [0x80000054, 0x80000000, 0x80000000, 0, 7],
        amount: '60000',
        prev_hash: Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex'),
        prev_index: 0,
        sequence: 0xffffffff,
        script_type: 'SPENDWITNESS',
      },
    ]);
    expect(outputs[0]).toEqual({
      address: bitcoin.address.fromOutputScript(psbt.txOutputs[0].script, bitcoin.networks.bitcoin),
      amount: '59000',
      script_type: 'PAYTOADDRESS',
    });
    expect(outputs[1]).toEqual({
      address_n: [0x80000054, 0x80000000, 0x80000000, 1, 2],
      amount: '800',
      script_type: 'PAYTOWITNESS',
    });
  });

  it('builds multisig structure and handles missing/invalid scripts', () => {
    const { psbt, multisigXpubs } = createMultisigPsbt(true);
    const input = psbt.data.inputs[0];
    const script = Buffer.from(input.witnessScript!);
    const derivations = input.bip32Derivation!;
    const multisig = buildTrezorMultisig(script, derivations, multisigXpubs);
    expect(multisig).not.toBeNull();
    expect(multisig?.m).toBe(2);
    expect(multisig?.signatures).toEqual(['', '']);
    expect(multisig?.pubkeys_order).toBe('LEXICOGRAPHIC');
    expect(multisig?.pubkeys).toHaveLength(2);
    expect(multisig?.pubkeys[0].address_n).toEqual([0, 1]);
    expect(multisig?.pubkeys[1].address_n).toEqual([0, 1]);
    expect(multisig?.pubkeys[0].node.startsWith('xpub')).toBe(true);

    expect(() => buildTrezorMultisig(script, derivations, {})).toThrow(
      /missing account xpub evidence/i
    );
    expect(() => buildTrezorMultisig(script, derivations)).toThrow(
      /missing account xpub evidence/i
    );
    expect(() =>
      buildTrezorMultisig(script, derivations as any, {
        deadbeef: multisigXpubs.deadbeef,
      })
    ).toThrow(/missing account xpub evidence.*aaaaaaaa/i);
    expect(() =>
      buildTrezorMultisig(script, derivations.slice(0, 1) as any, multisigXpubs)
    ).toThrow(/requires exactly 2 signer derivations/i);
    expect(() =>
      buildTrezorMultisig(
        script,
        [
          derivations[0],
          {
            ...derivations[1],
            masterFingerprint: derivations[0].masterFingerprint,
          },
        ] as any,
        multisigXpubs
      )
    ).toThrow(/duplicate fingerprints/i);

    expect(buildTrezorMultisig(undefined, derivations, multisigXpubs)).toBeUndefined();
    expect(() =>
      buildTrezorMultisig(Buffer.from([0x01, 0x02, 0x03]), derivations, multisigXpubs)
    ).toThrow(/canonical multisig script/i);

    expect(() =>
      buildTrezorMultisig(
        script,
        [derivations[0], { ...derivations[1], pubkey: hexToBytes(`02${'44'.repeat(32)}`) }] as any,
        multisigXpubs
      )
    ).toThrow(/expected one derivation for pubkey/i);
  });

  it('preserves existing multisig signatures in lexicographic device slots and rejects invalid evidence', () => {
    const { psbt, multisigXpubs } = createMultisigPsbt(true);
    const input = psbt.data.inputs[0];
    const derivations = input.bip32Derivation!;
    const encoded = Buffer.from(
      bitcoin.script.signature.encode(
        ecc.sign(
          Uint8Array.from(Buffer.alloc(32, 7)),
          Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'))
      ),
        bitcoin.Transaction.SIGHASH_ALL
      )
    );
    const partial = [{ pubkey: derivations[1].pubkey, signature: encoded }];
    const multisig = buildTrezorMultisig(
      Buffer.from(input.witnessScript!),
      derivations,
      multisigXpubs,
      partial
    );

    expect(multisig?.signatures).toEqual(['', encoded.subarray(0, -1).toString('hex')]);
    expect(() =>
      buildTrezorMultisig(Buffer.from(input.witnessScript!), derivations, multisigXpubs, [
        { pubkey: hexToBytes(`02${'44'.repeat(32)}`), signature: encoded },
      ])
    ).toThrow(/absent from the witnessScript/i);
    expect(() =>
      buildTrezorMultisig(Buffer.from(input.witnessScript!), derivations, multisigXpubs, [
        partial[0],
        partial[0],
      ])
    ).toThrow(/duplicate partial signatures/i);
    expect(() =>
      buildTrezorMultisig(Buffer.from(input.witnessScript!), derivations, multisigXpubs, [
        { ...partial[0], signature: hexToBytes('00') },
      ])
    ).toThrow(/encoding is invalid/i);
    expect(() =>
      buildTrezorMultisig(
        Buffer.from(input.witnessScript!),
        derivations,
        multisigXpubs,
        partial,
        bitcoin.Transaction.SIGHASH_NONE
      )
    ).toThrow(/sighash differs/i);
  });
});
