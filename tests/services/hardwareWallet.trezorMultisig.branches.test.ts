import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { describe, expect, it } from 'vitest';
import {
  buildTrezorMultisig,
  isMultisigInput,
} from '../../src/services/hardwareWallet/adapters/trezor/multisig';
import { createMultisigPsbt, hexToBytes } from './hardwareWallet/trezorAdapterTestHarness';

const bip32 = BIP32Factory(ecc);

function compileMultisig(
  thresholdOpcode: number | Uint8Array,
  pubkeys: readonly Uint8Array[],
  signerOpcode: number | Uint8Array
): Buffer {
  return Buffer.from(
    bitcoin.script.compile([
      thresholdOpcode,
      ...pubkeys,
      signerOpcode,
      bitcoin.opcodes.OP_CHECKMULTISIG,
    ])
  );
}

function fixture() {
  const { psbt, multisigXpubs } = createMultisigPsbt(true);
  const input = psbt.data.inputs[0];
  return {
    derivations: input.bip32Derivation!,
    pubkeys: input.bip32Derivation!.map((origin) => origin.pubkey),
    script: Buffer.from(input.witnessScript!),
    multisigXpubs,
  };
}

function buildWithPath(path: string, xpub?: string): unknown {
  const value = fixture();
  const derivations = value.derivations.map((origin, index) =>
    index === 0 ? { ...origin, path } : origin
  );
  const fingerprint = Buffer.from(derivations[0].masterFingerprint).toString('hex');
  return buildTrezorMultisig(value.script, derivations, {
    ...value.multisigXpubs,
    ...(xpub ? { [fingerprint]: xpub } : {}),
  });
}

describe('Trezor multisig branch contracts', () => {
  it('rejects every malformed threshold, signer-count, key-length, and ordering shape', () => {
    const { derivations, pubkeys, multisigXpubs } = fixture();
    const invalidScripts = [
      compileMultisig(bitcoin.opcodes.OP_0, pubkeys, bitcoin.opcodes.OP_2),
      compileMultisig(bitcoin.opcodes.OP_2, pubkeys, bitcoin.opcodes.OP_0),
      compileMultisig(bitcoin.opcodes.OP_3, pubkeys, bitcoin.opcodes.OP_2),
      compileMultisig(bitcoin.opcodes.OP_2, pubkeys, bitcoin.opcodes.OP_3),
      compileMultisig(
        bitcoin.opcodes.OP_2,
        [pubkeys[0].slice(0, 32), pubkeys[1]],
        bitcoin.opcodes.OP_2
      ),
    ];
    for (const script of invalidScripts) {
      expect(() => buildTrezorMultisig(script, derivations, multisigXpubs)).toThrow(
        /threshold or signer count is invalid/i
      );
    }

    const reversed = compileMultisig(
      bitcoin.opcodes.OP_2,
      [...pubkeys].reverse(),
      bitcoin.opcodes.OP_2
    );
    expect(() => buildTrezorMultisig(reversed, derivations, multisigXpubs)).toThrow(
      /not lexicographically ordered/i
    );
  });

  it.each([
    ['too short', "m/48'", /invalid signer path/i],
    ['hardened branch', "m/48'/0'/0'/2'/0'/1", /invalid unhardened child path/i],
    ['non-numeric branch', "m/48'/0'/0'/2'/change/1", /invalid unhardened child path/i],
    ['oversized child', "m/48'/0'/0'/2'/0/2147483648", /child index is out of range/i],
    ['unsupported coin', "m/48'/2'/0'/2'/0/1", /invalid account xpub/i],
  ])('rejects a %s signer path', (_label, path, message) => {
    expect(() => buildWithPath(path)).toThrow(message);
  });

  it('accepts a correctly bound testnet account xpub', () => {
    const accounts = [
      bip32
        .fromSeed(hexToBytes('31'.repeat(32)), bitcoin.networks.testnet)
        .derivePath("m/48'/1'/0'/2'"),
      bip32
        .fromSeed(hexToBytes('32'.repeat(32)), bitcoin.networks.testnet)
        .derivePath("m/48'/1'/0'/2'"),
    ];
    const origins = accounts
      .map((account, index) => ({
        masterFingerprint: hexToBytes(index === 0 ? '01020304' : '05060708'),
        path: "m/48'/1'/0'/2'/0/7",
        pubkey: Uint8Array.from(account.derive(0).derive(7).publicKey),
      }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.pubkey), Buffer.from(right.pubkey)));
    const script = compileMultisig(
      bitcoin.opcodes.OP_2,
      origins.map((origin) => origin.pubkey),
      bitcoin.opcodes.OP_2
    );
    const xpubs = Object.fromEntries(
      origins.map((origin) => {
        const account = accounts.find((candidate) =>
          Buffer.from(candidate.derive(0).derive(7).publicKey).equals(Buffer.from(origin.pubkey))
        )!;
        return [
          Buffer.from(origin.masterFingerprint).toString('hex'),
          account.neutered().toBase58(),
        ];
      })
    );

    expect(buildTrezorMultisig(script, origins, xpubs)?.pubkeys).toEqual(
      expect.arrayContaining([expect.objectContaining({ address_n: [0, 7] })])
    );
  });

  it('rejects whitespace, malformed, wrong-depth, and non-deriving account xpub evidence', () => {
    const value = fixture();
    const fingerprint = Buffer.from(value.derivations[0].masterFingerprint).toString('hex');
    const validXpub = value.multisigXpubs[fingerprint];
    expect(() => buildWithPath(value.derivations[0].path, ` ${validXpub}`)).toThrow(
      /missing account xpub evidence/i
    );
    expect(() => buildWithPath(value.derivations[0].path, 'not-an-xpub')).toThrow(
      /invalid account xpub/i
    );

    const shallow = bip32.fromSeed(hexToBytes('41'.repeat(32))).derivePath("m/48'/0'/0'");
    expect(() => buildWithPath(value.derivations[0].path, shallow.neutered().toBase58())).toThrow(
      /depth or child number differs/i
    );

    const changed = value.derivations
      .map((origin, index) =>
        index === 0 ? { ...origin, pubkey: hexToBytes(`02${'44'.repeat(32)}`) } : origin
      )
      .sort((left, right) => Buffer.compare(Buffer.from(left.pubkey), Buffer.from(right.pubkey)));
    const changedScript = compileMultisig(
      bitcoin.opcodes.OP_2,
      changed.map((origin) => origin.pubkey),
      bitcoin.opcodes.OP_2
    );
    expect(() => buildTrezorMultisig(changedScript, changed, value.multisigXpubs)).toThrow(
      /does not derive the PSBT pubkey/i
    );
  });

  it('classifies witness-script and multiple-origin inputs without false positives', () => {
    expect(isMultisigInput({})).toBe(false);
    expect(isMultisigInput({ bip32Derivation: [] })).toBe(false);
    expect(isMultisigInput({ bip32Derivation: fixture().derivations.slice(0, 1) })).toBe(false);
    expect(isMultisigInput({ bip32Derivation: fixture().derivations })).toBe(true);
    expect(isMultisigInput({ witnessScript: Uint8Array.of(1) })).toBe(true);
  });
});
