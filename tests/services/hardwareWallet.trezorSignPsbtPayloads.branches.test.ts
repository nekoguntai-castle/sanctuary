import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTrezorInputs,
  buildTrezorOutputs,
} from '../../src/services/hardwareWallet/adapters/trezor/signPsbtPayloads';
import {
  createMultisigPsbt,
  createSingleSigPsbt,
  hexToBytes,
} from './hardwareWallet/trezorAdapterTestHarness';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

const FINGERPRINT = Buffer.from('deadbeef', 'hex');
const LEGACY_ORIGIN = {
  masterFingerprint: Uint8Array.from(FINGERPRINT),
  path: "m/84'/0'/0'/0/3",
  pubkey: hexToBytes(`02${'11'.repeat(32)}`),
};
const TAP_ORIGIN = {
  masterFingerprint: Uint8Array.from(FINGERPRINT),
  path: "m/86'/0'/0'/0/3",
  pubkey: hexToBytes('11'.repeat(32)),
  leafHashes: [] as Uint8Array[],
};

function request(changeOutputs: number[] = []) {
  return {
    walletId: 'wallet-1',
    psbt: 'fixture',
    signingContext: {
      changeOutputs: changeOutputs.map((outputIndex) => ({ outputIndex })),
    },
  } as any;
}

function inputPsbt(input: Record<string, unknown>): any {
  return {
    data: { inputs: [input], outputs: [] },
    txInputs: [
      {
        hash: Uint8Array.from(Buffer.from('22'.repeat(32), 'hex')),
        index: 4,
        sequence: 9,
      },
    ],
    txOutputs: [],
  };
}

function outputPsbt(output: Record<string, unknown>, script?: Uint8Array): any {
  return {
    data: { inputs: [], outputs: [output] },
    txInputs: [],
    txOutputs: [
      {
        script: script ?? bitcoin.payments.p2wpkh({ hash: hexToBytes('33'.repeat(20)) }).output!,
        value: 321n,
      },
    ],
  };
}

function buildInput(
  input: Record<string, unknown>,
  scriptType: any = 'SPENDWITNESS',
  fingerprint: Buffer | null = FINGERPRINT
) {
  return buildTrezorInputs(
    inputPsbt(input),
    request(),
    scriptType,
    fingerprint,
    fingerprint?.toString('hex')
  );
}

function buildOutput(
  output: Record<string, unknown>,
  scriptType: any = 'SPENDWITNESS',
  changeOutputs: number[] = [0],
  fingerprint: Buffer | null = FINGERPRINT,
  isTestnet = false
) {
  return buildTrezorOutputs(
    outputPsbt(output),
    request(changeOutputs),
    scriptType,
    isTestnet,
    fingerprint,
    fingerprint?.toString('hex')
  );
}

describe('Trezor PSBT payload branch contracts', () => {
  it('requires one device-bound legacy origin and rejects Taproot metadata on legacy spends', () => {
    expect(() => buildInput({})).toThrow(/missing wallet-bound BIP32/i);
    expect(() =>
      buildInput({
        bip32Derivation: [LEGACY_ORIGIN],
        tapBip32Derivation: [TAP_ORIGIN],
      })
    ).toThrow(/unexpected Taproot derivation metadata/i);
    expect(() =>
      buildInput({
        bip32Derivation: [LEGACY_ORIGIN],
        tapInternalKey: TAP_ORIGIN.pubkey,
      })
    ).toThrow(/unexpected Taproot derivation metadata/i);
    expect(() => buildInput({ bip32Derivation: [LEGACY_ORIGIN] }, 'SPENDWITNESS', null)).toThrow(
      /master fingerprint is unavailable/i
    );
    expect(() =>
      buildInput(
        { bip32Derivation: [LEGACY_ORIGIN] },
        'SPENDWITNESS',
        Buffer.from('aaaaaaaa', 'hex')
      )
    ).toThrow(/No PSBT derivation matches.*input 0/i);
  });

  it('requires pure key-path BIP371 metadata for Taproot inputs', () => {
    expect(() => buildInput({ bip32Derivation: [LEGACY_ORIGIN] }, 'SPENDTAPROOT')).toThrow(
      /mixes legacy and Taproot/i
    );
    expect(() => buildInput({}, 'SPENDTAPROOT')).toThrow(/missing wallet-bound Taproot/i);
    expect(() =>
      buildInput(
        { tapBip32Derivation: [{ ...TAP_ORIGIN, pubkey: Uint8Array.of(1) }] },
        'SPENDTAPROOT'
      )
    ).toThrow(/unsupported Taproot script-path metadata/i);
    expect(() =>
      buildInput(
        {
          tapBip32Derivation: [{ ...TAP_ORIGIN, leafHashes: [Uint8Array.of(1)] }],
        },
        'SPENDTAPROOT'
      )
    ).toThrow(/unsupported Taproot script-path metadata/i);

    expect(buildInput({ tapBip32Derivation: [TAP_ORIGIN] }, 'SPENDTAPROOT')).toEqual([
      {
        address_n: [0x80000056, 0x80000000, 0x80000000, 0, 3],
        prev_hash: '22'.repeat(32),
        prev_index: 4,
        sequence: 9,
        script_type: 'SPENDTAPROOT',
      },
    ]);
  });

  it('requires a canonical witness script when multiple input origins imply multisig', () => {
    const second = {
      ...LEGACY_ORIGIN,
      masterFingerprint: hexToBytes('aaaaaaaa'),
    };
    expect(() => buildInput({ bip32Derivation: [LEGACY_ORIGIN, second] })).toThrow(
      /Input 0 is missing a canonical multisig witnessScript/i
    );

    expect(
      buildInput(
        {
          witnessScript: Uint8Array.of(1),
          tapBip32Derivation: [TAP_ORIGIN],
        },
        'SPENDTAPROOT'
      )[0]
    ).not.toHaveProperty('multisig');
  });

  it('builds input amounts only when authenticated witness UTXOs are present', () => {
    const withoutAmount = buildInput({ bip32Derivation: [LEGACY_ORIGIN] })[0];
    expect(withoutAmount).not.toHaveProperty('amount');
    const withAmount = buildInput({
      bip32Derivation: [LEGACY_ORIGIN],
      witnessUtxo: { value: 50n, script: hexToBytes('0014' + '44'.repeat(20)) },
    })[0];
    expect(withAmount.amount).toBe('50');
  });

  it.each([
    ['SPENDADDRESS', 'PAYTOADDRESS'],
    ['SPENDP2SHWITNESS', 'PAYTOP2SHWITNESS'],
    ['SPENDWITNESS', 'PAYTOWITNESS'],
    ['SPENDTAPROOT', 'PAYTOTAPROOT'],
  ])('maps %s change to %s', (scriptType, outputType) => {
    const origin =
      scriptType === 'SPENDTAPROOT'
        ? { tapBip32Derivation: [TAP_ORIGIN] }
        : { bip32Derivation: [LEGACY_ORIGIN] };
    expect(buildOutput(origin, scriptType)[0]).toEqual({
      address_n: expect.any(Array),
      amount: '321',
      script_type: outputType,
    });
  });

  it('keeps unbound or unmarked outputs external on mainnet and testnet', () => {
    const main = buildOutput({ bip32Derivation: [LEGACY_ORIGIN] }, 'SPENDWITNESS', [1])[0];
    expect(main.address).toMatch(/^bc1/);
    const testScript = bitcoin.payments.p2wpkh({
      hash: hexToBytes('33'.repeat(20)),
      network: bitcoin.networks.testnet,
    }).output!;
    const testPsbt = outputPsbt({}, testScript);
    const test = buildTrezorOutputs(
      testPsbt,
      { walletId: 'w', psbt: 'p' } as any,
      'SPENDWITNESS',
      true,
      FINGERPRINT,
      'deadbeef'
    )[0];
    expect(test.address).toMatch(/^tb1/);

    const tapWithoutOrigin = buildOutput({}, 'SPENDTAPROOT', [0])[0];
    expect(tapWithoutOrigin).toHaveProperty('address');
  });

  it('rejects a change origin belonging to another Trezor with output-specific context', () => {
    expect(() =>
      buildOutput(
        { bip32Derivation: [LEGACY_ORIGIN] },
        'SPENDWITNESS',
        [0],
        Buffer.from('aaaaaaaa', 'hex')
      )
    ).toThrow(/connected Trezor on input output/i);
  });

  it('does not attach incomplete output multisig metadata and rejects an empty canonical script', () => {
    const second = {
      ...LEGACY_ORIGIN,
      masterFingerprint: hexToBytes('aaaaaaaa'),
    };
    expect(buildOutput({ bip32Derivation: [LEGACY_ORIGIN] })[0]).not.toHaveProperty('multisig');
    expect(
      buildOutput({ bip32Derivation: [LEGACY_ORIGIN, second] }, 'SPENDWITNESS', [1])[0]
    ).toHaveProperty('address');
    expect(() =>
      buildOutput({
        bip32Derivation: [LEGACY_ORIGIN, second],
        witnessScript: new Uint8Array(0),
      })
    ).toThrow(/Output 0 is missing a canonical multisig witnessScript/i);
  });

  it('attaches complete multisig metadata to both input and change payloads', () => {
    const { psbt, multisigXpubs } = createMultisigPsbt(true);
    const multisigRequest = {
      ...request([1]),
      psbt: psbt.toBase64(),
      multisigXpubs,
    };
    expect(
      buildTrezorInputs(psbt as any, multisigRequest, 'SPENDWITNESS', FINGERPRINT, 'deadbeef')[0]
        .multisig
    ).toMatchObject({ m: 2, pubkeys_order: 'LEXICOGRAPHIC' });
    expect(
      buildTrezorOutputs(
        psbt as any,
        multisigRequest,
        'SPENDWITNESS',
        false,
        FINGERPRINT,
        'deadbeef'
      )[1].multisig
    ).toMatchObject({ m: 2, pubkeys_order: 'LEXICOGRAPHIC' });
  });

  it('does not mistake a witnessScript-only Taproot input for legacy multisig', () => {
    const { psbt } = createSingleSigPsbt();
    psbt.data.inputs[0].witnessScript = Uint8Array.of(1);
    psbt.data.inputs[0].bip32Derivation = undefined;
    psbt.data.inputs[0].tapBip32Derivation = [TAP_ORIGIN];
    expect(
      buildTrezorInputs(psbt as any, request(), 'SPENDTAPROOT', FINGERPRINT, 'deadbeef')[0]
    ).not.toHaveProperty('multisig');
  });
});
