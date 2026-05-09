import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import { GENERATED_SIGNED_PSBT_VECTORS } from '@fixtures/generated-signed-psbt-vectors';
import {
  HARDWARE_SIGNED_PSBT_VECTORS,
  REQUIRED_HARDWARE_SIGNED_ROWS,
  UNSUPPORTED_HARDWARE_SIGNED_ROWS,
  type HardwareSignedExpectedOutput,
  type HardwareSignedPsbtVector,
} from '@fixtures/hardware-signed-psbt-vectors';
import {
  missingHardwareSignedRows,
  replayHardwareSignedVector,
} from '../../../helpers/hardwareSignedPsbtReplay';

bitcoin.initEccLib(ecc);

const NETWORK = bitcoin.networks.regtest;

function outputAddress(output: bitcoin.Transaction['outs'][number]): string {
  return bitcoin.address.fromOutputScript(output.script, NETWORK);
}

function expectedOutputs(finalTxHex: string): HardwareSignedExpectedOutput[] {
  const tx = bitcoin.Transaction.fromHex(finalTxHex);
  return tx.outs.map((output, index) => ({
    index,
    address: outputAddress(output),
    valueSats: Number(output.value),
    isChange: index === 1,
    derivationPath: index === 1 ? "m/84'/1'/0'/1/0" : undefined,
  }));
}

function inputValueSats(unsignedPsbtBase64: string): number {
  const psbt = bitcoin.Psbt.fromBase64(unsignedPsbtBase64, { network: NETWORK });
  return psbt.data.inputs.reduce((total, input) => total + Number(input.witnessUtxo?.value ?? 0n), 0);
}

function syntheticHardwareVector(overrides: Partial<HardwareSignedPsbtVector> = {}): HardwareSignedPsbtVector {
  const source = GENERATED_SIGNED_PSBT_VECTORS[0];
  return {
    id: 'ledger-p2wpkh-synthetic-replay',
    description: 'Synthetic hardware fixture replay contract using a Core-accepted software-signed PSBT',
    vendor: 'ledger',
    scriptType: source.scriptType,
    network: 'regtest',
    device: {
      model: 'Ledger Nano S Plus',
      firmwareVersion: 'synthetic',
      bitcoinAppVersion: 'synthetic',
      transport: 'webusb',
      transportVersion: 'test',
    },
    account: {
      fingerprint: 'f00dbabe',
      accountPath: "m/84'/1'/0'",
      xpubPrefix: 'tpub-synthetic',
      walletPolicy: 'wpkh(@0/**)',
    },
    unsignedPsbtBase64: source.unsignedPsbtBase64,
    signedPsbtBase64: source.signedPsbtBase64,
    inputValueSats: inputValueSats(source.unsignedPsbtBase64),
    expectedFeeSats: source.expectedFee,
    expectedVsize: source.expectedVsize,
    expectedTxid: source.expectedTxid,
    expectedOutputs: expectedOutputs(source.finalTxHex),
    signedBy: [
      {
        fingerprint: 'f00dbabe',
        derivationPath: "m/84'/1'/0'/0/0",
      },
    ],
    evidence: {
      capturedAt: '2026-04-30T00:00:00.000Z',
      operator: 'synthetic-test',
      bitcoinCoreVersion: 'Bitcoin Core /Satoshi:27.0.0/',
      mempoolAcceptAllowed: true,
    },
    ...overrides,
  };
}

describe('Hardware-signed PSBT fixture replay harness', () => {
  it('keeps the required hardware signing matrix explicit', () => {
    expect(REQUIRED_HARDWARE_SIGNED_ROWS).toHaveLength(15);
    expect(REQUIRED_HARDWARE_SIGNED_ROWS).toContainEqual({ vendor: 'ledger', scriptType: 'p2wpkh' });
    expect(REQUIRED_HARDWARE_SIGNED_ROWS).toContainEqual({ vendor: 'trezor', scriptType: 'p2sh-p2wsh' });
    expect(REQUIRED_HARDWARE_SIGNED_ROWS).toContainEqual({ vendor: 'bitbox', scriptType: 'p2tr' });
  });

  it('keeps unsupported product rows explicit and documented', () => {
    expect(UNSUPPORTED_HARDWARE_SIGNED_ROWS).toHaveLength(4);
    expect(UNSUPPORTED_HARDWARE_SIGNED_ROWS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vendor: 'ledger', scriptType: 'p2wsh', productDecision: 'blocked' }),
        expect.objectContaining({ vendor: 'ledger', scriptType: 'p2sh-p2wsh', productDecision: 'blocked' }),
        expect.objectContaining({ vendor: 'bitbox', scriptType: 'p2wsh', productDecision: 'blocked' }),
        expect.objectContaining({ vendor: 'bitbox', scriptType: 'p2sh-p2wsh', productDecision: 'blocked' }),
      ])
    );
    expect(UNSUPPORTED_HARDWARE_SIGNED_ROWS.every((row) => row.reason.length > 20)).toBe(true);
  });

  it('replays every committed hardware-signed fixture when evidence is present', () => {
    HARDWARE_SIGNED_PSBT_VECTORS.forEach((vector) => {
      const result = replayHardwareSignedVector(vector);
      expect(result.txid).toBe(vector.expectedTxid);
      expect(result.feeSats).toBe(vector.expectedFeeSats);
      expect(result.vsize).toBe(vector.expectedVsize);
    });
  });

  it('reports missing hardware rows until fixtures or explicit unsupported decisions exist', () => {
    const missing = missingHardwareSignedRows(
      REQUIRED_HARDWARE_SIGNED_ROWS,
      HARDWARE_SIGNED_PSBT_VECTORS,
      UNSUPPORTED_HARDWARE_SIGNED_ROWS
    );
    const accountedRows = HARDWARE_SIGNED_PSBT_VECTORS.length + UNSUPPORTED_HARDWARE_SIGNED_ROWS.length + missing.length;

    expect(accountedRows).toBe(REQUIRED_HARDWARE_SIGNED_ROWS.length);
    expect(missing).toHaveLength(11);
    expect(missing).not.toContainEqual({ vendor: 'ledger', scriptType: 'p2wsh' });
    expect(missing).not.toContainEqual({ vendor: 'bitbox', scriptType: 'p2sh-p2wsh' });
    if (process.env.REQUIRE_HARDWARE_SIGNED_FIXTURES === '1') {
      expect(missing).toEqual([]);
    }
  });

  it('replays a signed PSBT artifact through finalization and transaction invariants', () => {
    const vector = syntheticHardwareVector();
    const result = replayHardwareSignedVector(vector);

    expect(result).toMatchObject({
      txid: vector.expectedTxid,
      feeSats: vector.expectedFeeSats,
      vsize: vector.expectedVsize,
    });
    expect(result.outputs).toEqual(
      vector.expectedOutputs.map(({ index, address, valueSats }) => ({ index, address, valueSats }))
    );
  });

  it('replays a raw transaction artifact returned by Trezor', () => {
    const source = GENERATED_SIGNED_PSBT_VECTORS[0];
    const vector = syntheticHardwareVector({
      id: 'trezor-raw-tx-synthetic-replay',
      vendor: 'trezor',
      signedPsbtBase64: undefined,
      rawTxHex: source.finalTxHex,
      device: {
        model: 'Trezor Safe 5',
        firmwareVersion: 'synthetic',
        transport: 'trezor-connect',
        transportVersion: 'test',
      },
    });

    expect(replayHardwareSignedVector(vector).txid).toBe(source.expectedTxid);
  });

  it('accounts for rows covered by fixtures and unsupported decisions', () => {
    const missing = missingHardwareSignedRows(
      [
        { vendor: 'ledger', scriptType: 'p2wpkh' },
        { vendor: 'bitbox', scriptType: 'p2tr' },
        { vendor: 'trezor', scriptType: 'p2wsh' },
      ],
      [syntheticHardwareVector()],
      [{ vendor: 'bitbox', scriptType: 'p2tr', reason: 'firmware unsupported', productDecision: 'blocked' }]
    );

    expect(missing).toEqual([{ vendor: 'trezor', scriptType: 'p2wsh' }]);
  });

  it('rejects missing or ambiguous signed artifacts', () => {
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ signedPsbtBase64: undefined }))).toThrow(
      'must include exactly one signed PSBT or raw transaction'
    );
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ rawTxHex: '00' }))).toThrow(
      'must include exactly one signed PSBT or raw transaction'
    );
  });

  it('rejects malformed fixture metadata before replay', () => {
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ id: '   ' }))).toThrow('missing id');
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ signedBy: [] }))).toThrow(
      'has no signer evidence'
    );
  });

  it('rejects transaction invariant mismatches', () => {
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ expectedTxid: '00' }))).toThrow(
      'txid mismatch'
    );
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ expectedFeeSats: 1 }))).toThrow(
      'fee mismatch'
    );
    expect(() => replayHardwareSignedVector(syntheticHardwareVector({ expectedVsize: 1 }))).toThrow(
      'vsize mismatch'
    );
    expect(() =>
      replayHardwareSignedVector(syntheticHardwareVector({
        expectedOutputs: [{ ...expectedOutputs(GENERATED_SIGNED_PSBT_VECTORS[0].finalTxHex)[0], valueSats: 1 }],
      }))
    ).toThrow('output 0 mismatch');
  });
});
