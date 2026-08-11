import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

const mocks = vi.hoisted(() => ({
  loadSigningIntent: vi.fn(),
  authenticateIntentPrevouts: vi.fn(),
}));

vi.mock('../../../../../src/services/bitcoin/signingIntent/service', () => ({
  loadSigningIntent: mocks.loadSigningIntent,
}));
vi.mock('../../../../../src/services/bitcoin/signingIntent/prevoutValidation', () => ({
  authenticateIntentPrevouts: mocks.authenticateIntentPrevouts,
}));

import {
  assertTransactionMatchesSnapshot,
  createValidatedBroadcastArtifactForTest,
  validatePartialSignedPsbt,
  validateSignedArtifact,
} from '../../../../../src/services/bitcoin/signingIntent/artifactValidation';
import type {
  SigningIntentEnvelope,
  SigningIntentSnapshotV1,
} from '../../../../../src/services/bitcoin/signingIntent';
import { GENERATED_SIGNED_PSBT_VECTORS } from '../../../../fixtures/generated-signed-psbt-vectors';

const inputHash = (hex: string): Uint8Array => Buffer.from(hex, 'hex').reverse();

const transaction = (): bitcoin.Transaction => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 42;
  tx.addInput(inputHash('11'.repeat(32)), 1, 0xfffffffd);
  tx.addInput(inputHash('22'.repeat(32)), 2, 0xfffffffc);
  tx.addOutput(Buffer.from('0014' + '33'.repeat(20), 'hex'), 12_000n);
  tx.addOutput(Buffer.from('0014' + '44'.repeat(20), 'hex'), 7_500n);
  return tx;
};

const snapshot = (): SigningIntentSnapshotV1 => ({
  version: 1,
  walletId: 'wallet-1',
  network: 'testnet3',
  transaction: {
    version: 2,
    locktime: 42,
    inputs: [
      { txid: '11'.repeat(32), vout: 1, sequence: 0xfffffffd, prevout: { amountSats: '13000', scriptPubKeyHex: '0014' + '55'.repeat(20), role: 'wallet' } },
      { txid: '22'.repeat(32), vout: 2, sequence: 0xfffffffc, prevout: { amountSats: '8000', scriptPubKeyHex: '0014' + '66'.repeat(20), role: 'wallet' } },
    ],
    outputs: [
      { amountSats: '12000', scriptPubKeyHex: '0014' + '33'.repeat(20) },
      { amountSats: '7500', scriptPubKeyHex: '0014' + '44'.repeat(20) },
    ],
  },
});

const mutations: Array<[string, (tx: bitcoin.Transaction) => void]> = [
  ['version', tx => { tx.version = 1; }],
  ['locktime', tx => { tx.locktime = 41; }],
  ['input count', tx => { tx.ins.pop(); }],
  ['input order', tx => { tx.ins.reverse(); }],
  ['input txid', tx => { tx.ins[0].hash = inputHash('77'.repeat(32)); }],
  ['input vout', tx => { tx.ins[0].index = 9; }],
  ['input sequence', tx => { tx.ins[0].sequence = 1; }],
  ['output count', tx => { tx.outs.pop(); }],
  ['output order', tx => { tx.outs.reverse(); }],
  ['output amount', tx => { tx.outs[0].value = 12_001n; }],
  ['output script', tx => { tx.outs[0].script = Buffer.from('6a', 'hex'); }],
];

describe('signed transaction intent comparator', () => {
  it('accepts the exact authorized transaction', () => {
    expect(() => assertTransactionMatchesSnapshot(transaction(), snapshot())).not.toThrow();
  });

  it.each(mutations)('rejects %s mutation', (_name, mutate) => {
    const candidate = transaction();
    mutate(candidate);
    expect(() => assertTransactionMatchesSnapshot(candidate, snapshot())).toThrow(
      'Signed transaction does not match the authorized intent',
    );
  });
});

const privateKey = Buffer.from('01'.repeat(32), 'hex');
const publicKey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
const witnessScript = bitcoin.payments.p2wpkh({ pubkey: publicKey }).output!;
const destinationScript = Buffer.from(`0014${'77'.repeat(20)}`, 'hex');

const buildPsbt = (): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  psbt.setVersion(2);
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: { script: witnessScript, value: 10_000n },
  });
  psbt.addOutput({ script: destinationScript, value: 9_000n });
  return psbt;
};

const envelopeFor = (
  psbt: bitcoin.Psbt,
  network: SigningIntentSnapshotV1['network'] = 'testnet3',
): SigningIntentEnvelope => {
  const unsigned = bitcoin.Transaction.fromBuffer(
    psbt.data.globalMap.unsignedTx.toBuffer(),
  );
  const snapshot: SigningIntentSnapshotV1 = {
    version: 1,
    walletId: 'wallet-1',
    network,
    transaction: {
      version: unsigned.version,
      locktime: unsigned.locktime,
      inputs: unsigned.ins.map((input, index) => {
        const psbtInput = psbt.data.inputs[index];
        const prevout = psbtInput.witnessUtxo ?? (() => {
          if (!psbtInput.nonWitnessUtxo) throw new Error(`Missing prevout evidence for input ${index}`);
          const previous = bitcoin.Transaction.fromBuffer(psbtInput.nonWitnessUtxo);
          const output = previous.outs[input.index];
          if (!output) throw new Error(`Missing previous output for input ${index}`);
          return output;
        })();
        return {
          txid: Buffer.from(input.hash).reverse().toString('hex'),
          vout: input.index,
          sequence: input.sequence,
          prevout: {
            amountSats: prevout.value.toString(),
            scriptPubKeyHex: Buffer.from(prevout.script).toString('hex'),
            role: 'wallet' as const,
          },
        };
      }),
      outputs: unsigned.outs.map(output => ({
        amountSats: output.value.toString(),
        scriptPubKeyHex: Buffer.from(output.script).toString('hex'),
      })),
    },
  };
  return {
    intentId: 'intent-1',
    intentDigest: 'a'.repeat(64),
    snapshot,
    unsignedPsbtBase64: psbt.toBase64(),
    unsignedPsbtSha256: 'b'.repeat(64),
    source: 'standard',
    expiresAt: new Date(Date.now() + 60_000),
  };
};

const signingInput = {
  walletId: 'wallet-1',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
};

describe('signed artifact authentication boundary', () => {
  let original: bitcoin.Psbt;
  let envelope: SigningIntentEnvelope;

  beforeEach(() => {
    vi.clearAllMocks();
    original = buildPsbt();
    envelope = envelopeFor(original);
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockResolvedValue(
      envelope.snapshot.transaction.inputs.map(input => input.prevout),
    );
  });

  it('keeps the test artifact constructor unavailable outside the test runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createValidatedBroadcastArtifactForTest({
      rawTx: '00',
      txid: 'a'.repeat(64),
      walletId: 'wallet-1',
      network: 'testnet3',
      intent: { intentId: 'intent-1', intentDigest: 'b'.repeat(64) },
      snapshot: snapshot(),
    })).toThrow('unavailable outside tests');
    vi.unstubAllEnvs();
  });

  it('rejects raw-only artifacts until the adapter supplies verifiable signing proof', async () => {
    const rawTxHex = bitcoin.Transaction.fromBuffer(
      original.data.globalMap.unsignedTx.toBuffer(),
    ).toHex();

    await expect(validateSignedArtifact({ ...signingInput, rawTxHex, draftId: 'draft-1' }))
      .rejects.toThrow('verifiable adapter proof');
    expect(mocks.authenticateIntentPrevouts).toHaveBeenCalledWith(
      'wallet-1', 'testnet3', expect.any(bitcoin.Psbt), ['wallet'], 'draft-1', undefined,
    );
  });

  it.each([
    [{}, 'exactly one signed artifact'],
    [{ rawTxHex: '00', signedPsbtBase64: 'cHNi' }, 'exactly one signed artifact'],
    [{ rawTxHex: 'not-hex' }, 'Invalid raw transaction'],
    [{ signedPsbtBase64: 'not-psbt' }, 'Invalid signed PSBT'],
  ])('rejects malformed or ambiguous signed artifacts', async (artifact, message) => {
    await expect(validateSignedArtifact({ ...signingInput, ...artifact })).rejects.toThrow(message);
  });

  it.each([
    (hex: string) => `${hex}zz`,
    (hex: string) => hex.slice(0, -1),
    (hex: string) => ` ${hex}`,
    (hex: string) => `${hex.slice(0, 8)}zz${hex.slice(10)}`,
  ])('rejects non-canonical raw transaction hex before adapter-proof evaluation', async (mutate) => {
    const raw = bitcoin.Transaction.fromBuffer(
      original.data.globalMap.unsignedTx.toBuffer(),
    ).toHex();
    await expect(validateSignedArtifact({ ...signingInput, rawTxHex: mutate(raw) }))
      .rejects.toThrow('Invalid raw transaction');
  });

  it('accepts uppercase full hex syntax before enforcing the adapter-proof gate', async () => {
    const raw = bitcoin.Transaction.fromBuffer(
      original.data.globalMap.unsignedTx.toBuffer(),
    ).toHex().toUpperCase();
    await expect(validateSignedArtifact({ ...signingInput, rawTxHex: raw }))
      .rejects.toThrow('verifiable adapter proof');
  });

  it('validates, finalizes, and extracts an exactly preserved signed PSBT', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, {
      publicKey,
      sign: hash => ecc.sign(hash, privateKey),
    });

    const artifact = await validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: signed.toBase64(),
    });

    expect(artifact.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(bitcoin.Transaction.fromHex(artifact.rawTx).hasWitnesses()).toBe(true);
  });

  it('rejects a valid signed PSBT encoded with non-canonical base64 padding', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, { publicKey, sign: hash => ecc.sign(hash, privateKey) });
    const nonCanonical = signed.toBase64().replace(/=+$/, '');

    await expect(validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: nonCanonical,
    })).rejects.toThrow('Invalid signed PSBT');
  });

  it('authenticates an accepted HTTP replay against the exact stored txid and raw transaction', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, { publicKey, sign: hash => ecc.sign(hash, privateKey) });
    const first = await validateSignedArtifact({ ...signingInput, signedPsbtBase64: signed.toBase64() });
    envelope = {
      ...envelope,
      broadcastReplay: { state: 'accepted', txid: first.txid, rawTx: first.rawTx },
    };
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockClear();

    await expect(validateSignedArtifact({
      ...signingInput, signedPsbtBase64: signed.toBase64(),
    })).resolves.toMatchObject({ txid: first.txid, rawTx: first.rawTx });
    expect(mocks.authenticateIntentPrevouts).not.toHaveBeenCalled();

    mocks.loadSigningIntent.mockResolvedValue({
      ...envelope,
      broadcastReplay: { ...envelope.broadcastReplay!, rawTx: `${first.rawTx}00` },
    });
    await expect(validateSignedArtifact({
      ...signingInput, signedPsbtBase64: signed.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');

    mocks.loadSigningIntent.mockResolvedValue({
      ...envelope,
      broadcastReplay: { ...envelope.broadcastReplay!, txid: 'f'.repeat(64) },
    });
    await expect(validateSignedArtifact({
      ...signingInput, signedPsbtBase64: signed.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');
  });

  it.each(GENERATED_SIGNED_PSBT_VECTORS)(
    'accepts Core-backed signed vector: $scriptType',
    async (vector) => {
      const unsigned = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64);
      envelope = envelopeFor(unsigned, 'regtest');
      mocks.loadSigningIntent.mockResolvedValue(envelope);
      mocks.authenticateIntentPrevouts.mockResolvedValue(
        envelope.snapshot.transaction.inputs.map(input => input.prevout),
      );

      const artifact = await validateSignedArtifact({
        ...signingInput,
        signedPsbtBase64: vector.signedPsbtBase64,
      });

      expect(vector.mempoolAccept).toEqual({ allowed: true, txid: vector.expectedTxid });
      expect(artifact).toMatchObject({
        rawTx: vector.finalTxHex,
        txid: vector.expectedTxid,
        network: 'regtest',
      });
      expect(Object.isFrozen(artifact)).toBe(true);
    },
  );

  it('keeps Taproot signing disabled pending a Core-accepted signed vector', async () => {
    bitcoin.initEccLib(ecc);
    const internalPrivateKey = Buffer.from('03'.repeat(32), 'hex');
    const internalPublicKey = Buffer.from(ecc.pointFromScalar(internalPrivateKey, true)!);
    const internalXOnly = internalPublicKey.subarray(1, 33);
    const normalizedPrivateKey = internalPublicKey[0] === 3
      ? Buffer.from(ecc.privateNegate(internalPrivateKey))
      : internalPrivateKey;
    const tweak = bitcoin.crypto.taggedHash('TapTweak', internalXOnly);
    const tweakedPrivateKey = Buffer.from(ecc.privateAdd(normalizedPrivateKey, tweak)!);
    const tweakedPublicKey = Buffer.from(ecc.pointFromScalar(tweakedPrivateKey, true)!);
    const taprootOutput = bitcoin.payments.p2tr({
      internalPubkey: internalXOnly,
      network: bitcoin.networks.regtest,
    }).output!;
    const taproot = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    taproot.addInput({
      hash: 'dd'.repeat(32),
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { script: taprootOutput, value: 10_000n },
      tapInternalKey: internalXOnly,
    });
    taproot.addOutput({ script: destinationScript, value: 9_000n });
    taproot.signInput(0, {
      publicKey: tweakedPublicKey,
      sign: hash => ecc.sign(hash, tweakedPrivateKey),
      signSchnorr: hash => ecc.signSchnorr(hash, tweakedPrivateKey),
    });
    envelope = envelopeFor(bitcoin.Psbt.fromBase64(taproot.toBase64()), 'regtest');
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockResolvedValue(
      envelope.snapshot.transaction.inputs.map(input => input.prevout),
    );

    await expect(validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: taproot.toBase64(),
    })).rejects.toThrow('Taproot signing is disabled');
  });

  it('blocks a mixed-input PSBT when any input is Taproot', async () => {
    bitcoin.initEccLib(ecc);
    const internalPublicKey = Buffer.from(ecc.pointFromScalar(Buffer.from('03'.repeat(32), 'hex'), true)!);
    const taprootOutput = bitcoin.payments.p2tr({
      internalPubkey: internalPublicKey.subarray(1, 33),
      network: bitcoin.networks.regtest,
    }).output!;
    const mixed = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    mixed.addInput({
      hash: 'dd'.repeat(32),
      index: 0,
      witnessUtxo: { script: taprootOutput, value: 10_000n },
    });
    mixed.addInput({
      hash: 'ee'.repeat(32),
      index: 1,
      witnessUtxo: { script: witnessScript, value: 8_000n },
    });
    mixed.addOutput({ script: destinationScript, value: 17_000n });
    envelope = envelopeFor(mixed, 'regtest');
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockResolvedValue(
      envelope.snapshot.transaction.inputs.map(input => input.prevout),
    );

    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: mixed.toBase64(),
    })).rejects.toThrow('Taproot signing is disabled');
  });

  it('rejects an unsigned PSBT before finalization is attempted', async () => {
    await expect(validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: original.toBase64(),
    })).rejects.toThrow('verifiable signature evidence');
  });

  it('rejects altered immutable PSBT input metadata', async () => {
    const candidate = bitcoin.Psbt.fromBase64(original.toBase64());
    candidate.addUnknownKeyValToInput(0, {
      key: Buffer.from('fc01', 'hex'),
      value: Buffer.from('01', 'hex'),
    });

    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: candidate.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');
  });

  it('rejects changed or removed immutable PSBT input evidence', async () => {
    const changed = bitcoin.Psbt.fromBase64(original.toBase64());
    changed.data.inputs[0].witnessUtxo!.value = 10_001n;
    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: changed.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');

    const removed = bitcoin.Psbt.fromBase64(original.toBase64());
    delete removed.data.inputs[0].witnessUtxo;
    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: removed.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');
  });

  it('rejects altered output and global PSBT metadata', async () => {
    const changedOutput = bitcoin.Psbt.fromBase64(original.toBase64());
    changedOutput.addUnknownKeyValToOutput(0, {
      key: Buffer.from('fc02', 'hex'),
      value: Buffer.from('01', 'hex'),
    });
    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: changedOutput.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');

    const changedGlobal = bitcoin.Psbt.fromBase64(original.toBase64());
    changedGlobal.addUnknownKeyValToGlobal({
      key: Buffer.from('fc03', 'hex'),
      value: Buffer.from('01', 'hex'),
    });
    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: changedGlobal.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');
  });

  it('rejects a cryptographically invalid partial signature', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, {
      publicKey,
      sign: hash => ecc.sign(hash, privateKey),
    });
    signed.data.inputs[0].partialSig![0].signature[10] ^= 1;

    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: signed.toBase64(),
    })).rejects.toThrow('invalid signature');
  });

  it('rejects already-finalized PSBTs whose cleared maps cannot be authenticated', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, {
      publicKey,
      sign: hash => ecc.sign(hash, privateKey),
    });
    signed.finalizeAllInputs();

    await expect(validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: signed.toBase64(),
    })).rejects.toThrow('Pre-finalized PSBT inputs are not accepted');
  });

  it('finalizes a multisig input through the explicit quorum finalizer', async () => {
    const secondPrivateKey = Buffer.from('02'.repeat(32), 'hex');
    const secondPublicKey = Buffer.from(ecc.pointFromScalar(secondPrivateKey, true)!);
    const multisigScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_2,
      publicKey,
      secondPublicKey,
      bitcoin.opcodes.OP_2,
      bitcoin.opcodes.OP_CHECKMULTISIG,
    ]);
    const multisigOutput = bitcoin.payments.p2wsh({ redeem: { output: multisigScript } }).output!;
    const multisig = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    multisig.setVersion(2);
    multisig.addInput({
      hash: 'bb'.repeat(32),
      index: 1,
      sequence: 0xfffffffd,
      witnessUtxo: { script: multisigOutput, value: 10_000n },
      witnessScript: multisigScript,
      bip32Derivation: [publicKey, secondPublicKey].map(pubkey => ({
        masterFingerprint: Buffer.from('f00dbabe', 'hex'),
        path: "m/48'/1'/0'/2'/0/0",
        pubkey,
      })),
    });
    multisig.addOutput({ script: destinationScript, value: 9_000n });
    multisig.signInput(0, {
      publicKey,
      sign: hash => ecc.sign(hash, privateKey),
    });
    envelope = envelopeFor(multisig);
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockResolvedValue(
      envelope.snapshot.transaction.inputs.map(input => input.prevout),
    );
    await expect(validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: multisig.toBase64(),
    })).rejects.toThrow('not finalizable');

    multisig.signInput(0, {
      publicKey: secondPublicKey,
      sign: hash => ecc.sign(hash, secondPrivateKey),
    });
    envelope = envelopeFor(multisig);
    mocks.loadSigningIntent.mockResolvedValue(envelope);
    mocks.authenticateIntentPrevouts.mockResolvedValue(
      envelope.snapshot.transaction.inputs.map(input => input.prevout),
    );

    const artifact = await validateSignedArtifact({
      ...signingInput,
      signedPsbtBase64: multisig.toBase64(),
    });

    expect(bitcoin.Transaction.fromHex(artifact.rawTx).hasWitnesses()).toBe(true);
  });

  it('validates present partial signatures before accepting a draft update', async () => {
    const signed = bitcoin.Psbt.fromBase64(original.toBase64());
    signed.signInput(0, {
      publicKey,
      sign: hash => ecc.sign(hash, privateKey),
    });

    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: signed.toBase64(),
      draftId: 'draft-1',
    })).resolves.toBeUndefined();
    expect(mocks.authenticateIntentPrevouts).toHaveBeenCalledWith(
      'wallet-1', 'testnet3', expect.any(bitcoin.Psbt), ['wallet'], 'draft-1', undefined,
    );
  });

  it('rejects prevout evidence that changed since intent creation', async () => {
    mocks.authenticateIntentPrevouts.mockResolvedValueOnce([{
      ...envelope.snapshot.transaction.inputs[0].prevout,
      amountSats: '10001',
    }]);

    await expect(validatePartialSignedPsbt({
      ...signingInput,
      signedPsbtBase64: original.toBase64(),
    })).rejects.toThrow('does not match the authorized intent');
  });
});
