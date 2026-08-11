import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import { GENERATED_SIGNED_PSBT_VECTORS } from '@fixtures/generated-signed-psbt-vectors';
import {
  COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  HARDWARE_SIGNED_PSBT_VECTORS,
  MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
  REQUIRED_HARDWARE_SIGNED_ROWS,
  REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES,
  UNSUPPORTED_HARDWARE_SIGNED_ROWS,
  type HardwareSignedAddressEvidence,
  type HardwareSignedExpectedOutput,
  type HardwareSignedNegativeControlEvidence,
  type HardwareSignedPsbtVector,
  type HardwareSignedSoftwareGateEvidence,
} from '@fixtures/hardware-signed-psbt-vectors';
import {
  assertHardwareSignedFixtureIntake,
  validateHardwareSignedFixtureSet,
} from '../../../helpers/hardwareSignedFixtureIntake';
import {
  missingHardwareSignedRows,
  replayHardwareSignedVector,
} from '../../../helpers/hardwareSignedPsbtReplay';

bitcoin.initEccLib(ecc);

const NETWORK = bitcoin.networks.regtest;

function generatedSignedVector(scriptType: 'p2wpkh') {
  for (const vector of GENERATED_SIGNED_PSBT_VECTORS) {
    if (vector.scriptType === scriptType) return vector;
  }
  throw new Error(`Missing generated signed ${scriptType} test vector`);
}

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

function syntheticAddressEvidence(accountPath = "m/84'/1'/0'"): HardwareSignedAddressEvidence[] {
  return REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES.map((suffix, index) => ({
    path: `${accountPath}${suffix}`,
    sanctuaryAddress: `bcrt1qfixtureaddress${index}`,
    deviceAddress: `bcrt1qfixtureaddress${index}`,
    coreAddress: `bcrt1qfixtureaddress${index}`,
  }));
}

function syntheticSoftwareGates(): HardwareSignedSoftwareGateEvidence[] {
  return REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES.map(command => ({
    command,
    status: 'passed',
    capturedAt: '2026-05-09T00:00:00.000Z',
  }));
}

function syntheticNegativeControls(scriptType = 'p2wpkh'): HardwareSignedNegativeControlEvidence[] {
  const multisigControls = scriptType === 'p2wsh' || scriptType === 'p2sh-p2wsh'
    ? MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS
    : [];
  return [...COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS, ...multisigControls].map(caseName => ({
    caseName,
    expectedFailure: 'fixture must fail closed',
    observedFailure: 'fixture failed before signing or replay',
    passed: true,
  }));
}

function syntheticHardwareVector(overrides: Partial<HardwareSignedPsbtVector> = {}): HardwareSignedPsbtVector {
  const source = generatedSignedVector('p2wpkh');
  const scriptType = overrides.scriptType ?? 'p2wpkh';
  return {
    id: 'ledger-p2wpkh-synthetic-replay',
    description: 'Synthetic hardware fixture replay contract using a Core-accepted software-signed PSBT',
    vendor: 'ledger',
    scriptType,
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
    addressEvidence: syntheticAddressEvidence(),
    negativeControls: syntheticNegativeControls(scriptType),
    softwareGates: syntheticSoftwareGates(),
    sanitization: {
      reviewer: 'fixture-reviewer',
      nonMainnetFunds: true,
      dedicatedOrWipeableDevice: true,
      noSeedsPinsPassphrasesPairingSecrets: true,
      noHostAuthTokens: true,
      sanitizedArtifactsReviewed: true,
    },
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
    const source = generatedSignedVector('p2wpkh');
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

  it('accepts complete hardware fixture intake evidence before replay', () => {
    const vector = syntheticHardwareVector();

    expect(() => assertHardwareSignedFixtureIntake(vector)).not.toThrow();
    expect(validateHardwareSignedFixtureSet([vector], UNSUPPORTED_HARDWARE_SIGNED_ROWS)).toEqual([]);
  });

  it('rejects missing or mismatched address evidence before replay', () => {
    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      addressEvidence: syntheticAddressEvidence().filter(evidence => !evidence.path.endsWith('/1/19')),
    }))).toThrow('missing address evidence for /1/19');

    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      addressEvidence: syntheticAddressEvidence().map((evidence, index) => index === 0
        ? { ...evidence, deviceAddress: 'bcrt1qmismatch' }
        : evidence),
    }))).toThrow('address mismatch');
  });

  it('rejects missing software gates and secret-shaped notes before replay', () => {
    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      softwareGates: syntheticSoftwareGates().slice(1),
    }))).toThrow('missing passed software gate');

    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      evidence: {
        capturedAt: '2026-04-30T00:00:00.000Z',
        operator: 'synthetic-test',
        bitcoinCoreVersion: 'Bitcoin Core /Satoshi:27.0.0/',
        mempoolAcceptAllowed: true,
        notes: 'operator accidentally pasted seed words here',
      },
    }))).toThrow('secret-shaped material');
  });

  it('rejects missing negative controls and non-test networks before replay', () => {
    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      negativeControls: syntheticNegativeControls().filter(control => control.caseName !== 'tampered-recipient'),
    }))).toThrow('missing passed negative control tampered-recipient');

    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      network: 'mainnet' as HardwareSignedPsbtVector['network'],
    }))).toThrow('regtest, signet, or testnet only');
  });

  it('rejects missing Core replay evidence before replay', () => {
    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      evidence: {
        capturedAt: '2026-04-30T00:00:00.000Z',
        operator: 'synthetic-test',
        mempoolAcceptAllowed: true,
      },
    }))).toThrow('missing Bitcoin Core replay version');

    expect(() => assertHardwareSignedFixtureIntake(syntheticHardwareVector({
      evidence: {
        capturedAt: '2026-04-30T00:00:00.000Z',
        operator: 'synthetic-test',
        bitcoinCoreVersion: 'Bitcoin Core /Satoshi:27.0.0/',
        mempoolAcceptAllowed: false,
      },
    }))).toThrow('Core testmempoolaccept must be allowed');
  });

  it('rejects duplicate fixture rows and rows blocked by product decisions', () => {
    expect(validateHardwareSignedFixtureSet([
      syntheticHardwareVector({ id: 'first-ledger-p2wpkh' }),
      syntheticHardwareVector({ id: 'second-ledger-p2wpkh' }),
    ], UNSUPPORTED_HARDWARE_SIGNED_ROWS)).toEqual([
      expect.objectContaining({ field: 'fixtureSet', message: expect.stringContaining('duplicate') }),
    ]);

    expect(validateHardwareSignedFixtureSet([
      syntheticHardwareVector({
        vendor: 'ledger',
        scriptType: 'p2wsh',
        negativeControls: syntheticNegativeControls('p2wsh'),
      }),
    ], UNSUPPORTED_HARDWARE_SIGNED_ROWS)).toEqual([
      expect.objectContaining({ field: 'fixtureSet', message: expect.stringContaining('conflicts') }),
    ]);
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
        expectedOutputs: [{ ...expectedOutputs(generatedSignedVector('p2wpkh').finalTxHex)[0], valueSats: 1 }],
      }))
    ).toThrow('output 0 mismatch');
  });
});
