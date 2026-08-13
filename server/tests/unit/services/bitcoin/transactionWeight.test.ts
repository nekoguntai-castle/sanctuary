import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compactSizeLength,
  estimateTransactionWeight,
  feeForRate,
  type SpendPolicy,
} from '../../../../src/services/bitcoin/transactionWeight';

const hash20 = new Array<number>(20).fill(0x11);
const hash32 = new Array<number>(32).fill(0x22);

function sha256(script: Uint8Array): Uint8Array {
  return createHash('sha256').update(script).digest();
}

function hash160(script: Uint8Array): Uint8Array {
  return createHash('ripemd160').update(sha256(script)).digest();
}

function sortedMultiScript(m: number, keyCount: number): Uint8Array {
  const keys = Array.from({ length: keyCount }, (_, index) =>
    Uint8Array.from([0x02, ...new Array<number>(32).fill(index + 1)])
  );
  return Uint8Array.from([
    0x50 + m,
    ...keys.flatMap((key) => [0x21, ...key]),
    0x50 + keyCount,
    0xae,
  ]);
}

function p2wshFor(witnessScript: Uint8Array): Uint8Array {
  return Uint8Array.from([0x00, 0x20, ...sha256(witnessScript)]);
}

function p2shFor(redeemScript: Uint8Array): Uint8Array {
  return Uint8Array.from([0xa9, 0x14, ...hash160(redeemScript), 0x87]);
}

function changed(script: Uint8Array, index: number, value: number): Uint8Array {
  const copy = Uint8Array.from(script);
  copy[index] = value;
  return copy;
}

function withDuplicateSecondKey(script: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(script);
  copy.set(script.subarray(2, 35), 36);
  return copy;
}

const redeemP2wpkh = Uint8Array.from([0x00, 0x14, ...hash20]);
const witness2of3 = sortedMultiScript(2, 3);
const witness16of16 = sortedMultiScript(16, 16);
const redeemP2wsh2of3 = p2wshFor(witness2of3);

const scripts = {
  p2pkh: Uint8Array.from([0x76, 0xa9, 0x14, ...hash20, 0x88, 0xac]),
  p2sh: Uint8Array.from([0xa9, 0x14, ...hash20, 0x87]),
  p2shP2wpkh: p2shFor(redeemP2wpkh),
  p2shP2wsh2of3: p2shFor(redeemP2wsh2of3),
  p2wpkh: Uint8Array.from([0x00, 0x14, ...hash20]),
  p2wsh: p2wshFor(witness2of3),
  p2tr: Uint8Array.from([0x51, 0x20, ...hash32]),
};

function estimate(
  spendPolicy: SpendPolicy,
  prevoutScript: Uint8Array,
  outputScript: Uint8Array,
  evidence: { redeemScript?: Uint8Array; witnessScript?: Uint8Array } = {}
) {
  return estimateTransactionWeight({
    inputs: [{ spendPolicy, prevoutScript, ...evidence }],
    outputs: [{ scriptPubKey: outputScript }],
  });
}

describe('transactionWeight', () => {
  describe('compactSizeLength', () => {
    it.each([
      [0, 1],
      [252, 1],
      [253, 3],
      [65_535, 3],
      [65_536, 5],
      [0xffff_ffff, 5],
      [0x1_0000_0000, 9],
      [Number.MAX_SAFE_INTEGER, 9],
    ])('encodes the boundary %d using %d bytes', (value, expected) => {
      expect(compactSizeLength(value)).toBe(expected);
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an unsafe value: %s', (value) => {
      expect(() => compactSizeLength(value)).toThrow('CompactSize value');
    });
  });

  describe('estimateTransactionWeight', () => {
    it.each([
      {
        name: 'P2PKH',
        policy: { type: 'p2pkh' } as const,
        prevout: scripts.p2pkh,
        output: scripts.p2pkh,
        weight: 772,
        vsize: 193,
      },
      {
        name: 'P2SH-P2WPKH',
        policy: { type: 'p2sh-p2wpkh' } as const,
        evidence: { redeemScript: redeemP2wpkh },
        prevout: scripts.p2shP2wpkh,
        output: scripts.p2sh,
        weight: 535,
        vsize: 134,
      },
      {
        name: 'P2WPKH',
        policy: { type: 'p2wpkh' } as const,
        prevout: scripts.p2wpkh,
        output: scripts.p2wpkh,
        weight: 439,
        vsize: 110,
      },
      {
        name: 'P2TR key path',
        policy: { type: 'p2tr-keypath' } as const,
        prevout: scripts.p2tr,
        output: scripts.p2tr,
        weight: 445,
        vsize: 112,
      },
      {
        name: '2-of-3 P2WSH sortedmulti',
        policy: { type: 'p2wsh-sortedmulti', m: 2, n: 3 } as const,
        evidence: { witnessScript: witness2of3 },
        prevout: scripts.p2wsh,
        output: scripts.p2wsh,
        weight: 634,
        vsize: 159,
      },
      {
        name: '2-of-3 P2SH-P2WSH sortedmulti',
        policy: {
          type: 'p2sh-p2wsh-sortedmulti',
          m: 2,
          n: 3,
        } as const,
        evidence: { redeemScript: redeemP2wsh2of3, witnessScript: witness2of3 },
        prevout: scripts.p2shP2wsh2of3,
        output: scripts.p2sh,
        weight: 730,
        vsize: 183,
      },
    ])('uses conservative literal weight for $name', ({ policy, prevout, output, evidence, weight, vsize }) => {
      expect(estimate(policy, prevout, output, evidence)).toEqual({ weight, vsize });
    });

    it('uses CompactSize for a 16-of-16 witness script longer than 252 bytes', () => {
      expect(estimate(
        { type: 'p2wsh-sortedmulti', m: 16, n: 16 },
        p2wshFor(witness16of16),
        scripts.p2wsh,
        { witnessScript: witness16of16 }
      )).toEqual({
        weight: 2_114,
        vsize: 529,
      });
    });

    it('serializes an empty witness stack for a legacy input in a mixed transaction', () => {
      expect(
        estimateTransactionWeight({
          inputs: [
            { spendPolicy: { type: 'p2pkh' }, prevoutScript: scripts.p2pkh },
            { spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh },
          ],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toEqual({ weight: 1_036, vsize: 259 });
    });

    it('includes the CompactSize input-count boundary for aggregated templates', () => {
      const at252 = estimateTransactionWeight({
        inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh, count: 252 }],
        outputs: [{ scriptPubKey: scripts.p2wpkh }],
      });
      const at253 = estimateTransactionWeight({
        inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh, count: 253 }],
        outputs: [{ scriptPubKey: scripts.p2wpkh }],
      });

      expect(at252).toEqual({ weight: 68_962, vsize: 17_241 });
      expect(at253).toEqual({ weight: 69_243, vsize: 17_311 });
    });

    it('uses the exact output script length and its CompactSize prefix', () => {
      const at252 = estimate({ type: 'p2wpkh' }, scripts.p2wpkh, new Uint8Array(252));
      const at253 = estimate({ type: 'p2wpkh' }, scripts.p2wpkh, new Uint8Array(253));

      expect(at252).toEqual({ weight: 1_359, vsize: 340 });
      expect(at253).toEqual({ weight: 1_371, vsize: 343 });
    });

    it('includes the CompactSize output-count boundary for aggregated templates', () => {
      const at252 = estimateTransactionWeight({
        inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }],
        outputs: [{ scriptPubKey: scripts.p2wpkh, count: 252 }],
      });
      const at253 = estimateTransactionWeight({
        inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }],
        outputs: [{ scriptPubKey: scripts.p2wpkh, count: 253 }],
      });

      expect(at252).toEqual({ weight: 31_563, vsize: 7_891 });
      expect(at253).toEqual({ weight: 31_695, vsize: 7_924 });
    });

    it('aggregates repeated outputs without approximating their script bytes', () => {
      expect(
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'p2pkh' }, prevoutScript: scripts.p2pkh }],
          outputs: [{ scriptPubKey: scripts.p2tr, count: 2 }],
        })
      ).toEqual({ weight: 980, vsize: 245 });
    });

    it.each([
      [{ type: 'p2pkh' } as const, scripts.p2wpkh, 'P2PKH'],
      [
        { type: 'p2sh-p2wpkh' } as const,
        scripts.p2wpkh,
        'P2SH',
      ],
      [{ type: 'p2wpkh' } as const, scripts.p2tr, 'P2WPKH'],
      [{ type: 'p2tr-keypath' } as const, scripts.p2wsh, 'P2TR'],
      [
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 } as const,
        scripts.p2sh,
        'P2WSH',
      ],
      [
        {
          type: 'p2sh-p2wsh-sortedmulti',
          m: 2,
          n: 3,
        } as const,
        scripts.p2wsh,
        'P2SH',
      ],
    ])('rejects a script that does not match policy %j', (policy, prevout, expected) => {
      expect(() => estimate(policy, prevout, scripts.p2wpkh)).toThrow(expected);
    });

    it('rejects nested and witness scripts that do not match their locking commitments', () => {
      expect(() =>
        estimate(
          { type: 'p2sh-p2wpkh' },
          scripts.p2sh,
          scripts.p2wpkh,
          { redeemScript: redeemP2wpkh }
        )
      ).toThrow('redeemScript does not match');

      expect(() =>
        estimate(
          { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
          Uint8Array.from([0x00, 0x20, ...hash32]),
          scripts.p2wpkh,
          { witnessScript: witness2of3 }
        )
      ).toThrow('witnessScript does not match');

      const alternateWitness = changed(witness2of3, 34, 0x00);
      expect(() =>
        estimate(
          {
            type: 'p2sh-p2wsh-sortedmulti',
            m: 2,
            n: 3,
          },
          scripts.p2shP2wsh2of3,
          scripts.p2wpkh,
          { redeemScript: redeemP2wsh2of3, witnessScript: alternateWitness }
        )
      ).toThrow('witnessScript does not match');
    });

    it('rejects a one-byte P2SH commitment mismatch even when the remaining bytes match', () => {
      const oneByteDrift = changed(
        scripts.p2shP2wpkh,
        2,
        scripts.p2shP2wpkh[2] ^ 0x01,
      );

      expect(() =>
        estimate(
          { type: 'p2sh-p2wpkh' },
          oneByteDrift,
          scripts.p2wpkh,
          { redeemScript: redeemP2wpkh },
        )
      ).toThrow('redeemScript does not match');
    });

    it('rejects every malformed P2SH envelope even when its embedded commitment matches', () => {
      const valid = scripts.p2shP2wpkh;
      const malformed = [
        Uint8Array.from([...valid, 0x00]),
        changed(valid, 0, 0x00),
        changed(valid, 1, 0x00),
        changed(valid, 22, 0x00),
      ];
      for (const prevout of malformed) {
        expect(() => estimate(
          { type: 'p2sh-p2wpkh' },
          prevout,
          scripts.p2wpkh,
          { redeemScript: redeemP2wpkh },
        )).toThrow('P2SH');
      }
    });

    it('rejects malformed witness programs even when their byte length is unchanged', () => {
      expect(() => estimate(
        { type: 'p2wpkh' }, changed(scripts.p2wpkh, 0, 0x51), scripts.p2wpkh,
      )).toThrow('P2WPKH');
      expect(() => estimate(
        { type: 'p2wpkh' }, changed(scripts.p2wpkh, 1, 0x15), scripts.p2wpkh,
      )).toThrow('P2WPKH');
      expect(() => estimate(
        { type: 'p2wpkh' }, Uint8Array.from([...scripts.p2wpkh, 0x00]), scripts.p2wpkh,
      )).toThrow('P2WPKH');
    });

    it('rejects malformed nested redeem and witness scripts before using their weight', () => {
      expect(() =>
        estimate({ type: 'p2sh-p2wpkh' }, scripts.p2shP2wpkh, scripts.p2wpkh)
      ).toThrow('redeemScript must be a Uint8Array');

      expect(() =>
        estimate(
          { type: 'p2sh-p2wpkh' },
          scripts.p2shP2wpkh,
          scripts.p2wpkh,
          { redeemScript: scripts.p2wsh }
        )
      ).toThrow('P2WPKH');

      expect(() =>
        estimate(
          {
            type: 'p2sh-p2wsh-sortedmulti',
            m: 2,
            n: 3,
          },
          scripts.p2shP2wsh2of3,
          scripts.p2wpkh,
          { redeemScript: redeemP2wpkh, witnessScript: witness2of3 }
        )
      ).toThrow('P2WSH');

      expect(() =>
        estimate(
          { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
          scripts.p2wsh,
          scripts.p2wpkh,
          { witnessScript: null as never }
        )
      ).toThrow('witnessScript must be a Uint8Array');
    });

    it.each([
      ['wrong length', witness2of3.subarray(0, witness2of3.length - 1)],
      ['wrong m opcode', changed(witness2of3, 0, 0x51)],
      ['wrong n opcode', changed(witness2of3, witness2of3.length - 2, 0x52)],
      ['wrong CHECKMULTISIG opcode', changed(witness2of3, witness2of3.length - 1, 0xac)],
    ])('rejects a structurally malformed sortedmulti witness script: %s', (_name, witnessScript) => {
      expect(() =>
        estimate(
          { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
          p2wshFor(witnessScript),
          scripts.p2wpkh,
          { witnessScript }
        )
      ).toThrow('witnessScript does not match sortedmulti');
    });

    it('rejects a wrong sortedmulti CHECKMULTISIG opcode as a standalone shape invariant', () => {
      const witnessScript = changed(witness2of3, witness2of3.length - 1, 0xac);
      expect(() => estimate(
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
        p2wshFor(witnessScript),
        scripts.p2wpkh,
        { witnessScript },
      )).toThrow('witnessScript does not match sortedmulti');
    });

    it('rejects trailing bytes after an otherwise valid sortedmulti script', () => {
      const witnessScript = Uint8Array.from([...witness2of3, 0x00]);
      expect(() => estimate(
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
        p2wshFor(witnessScript),
        scripts.p2wpkh,
        { witnessScript },
      )).toThrow('witnessScript does not match sortedmulti');
    });

    it.each([
      ['wrong key push opcode', changed(witness2of3, 1, 0x20)],
      ['uncompressed key prefix', changed(witness2of3, 2, 0x04)],
      ['duplicate key', withDuplicateSecondKey(witness2of3)],
    ])('rejects non-BIP67 sortedmulti keys: %s', (_name, witnessScript) => {
      expect(() =>
        estimate(
          { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
          p2wshFor(witnessScript),
          scripts.p2wpkh,
          { witnessScript }
        )
      ).toThrow('BIP67-sorted');
    });

    it('rejects a duplicate sortedmulti key as a standalone BIP67 invariant', () => {
      const witnessScript = withDuplicateSecondKey(witness2of3);
      expect(() => estimate(
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
        p2wshFor(witnessScript),
        scripts.p2wpkh,
        { witnessScript },
      )).toThrow('BIP67-sorted');
    });

    it('rejects a noncanonical sortedmulti key-push opcode as a standalone invariant', () => {
      const witnessScript = changed(witness2of3, 1, 0x20);
      expect(() => estimate(
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
        p2wshFor(witnessScript),
        scripts.p2wpkh,
        { witnessScript },
      )).toThrow('BIP67-sorted');
    });

    it('rejects an uncompressed sortedmulti key prefix as a standalone invariant', () => {
      const witnessScript = changed(witness2of3, 70, 0x04);
      expect(() => estimate(
        { type: 'p2wsh-sortedmulti', m: 2, n: 3 },
        p2wshFor(witnessScript),
        scripts.p2wpkh,
        { witnessScript },
      )).toThrow('BIP67-sorted');
    });

    it.each([
      [{ type: 'p2wsh-sortedmulti', m: 0, n: 3 }, 'multisig m'],
      [
        { type: 'p2wsh-sortedmulti', m: 1.5, n: 3 },
        'multisig m',
      ],
      [
        { type: 'p2wsh-sortedmulti', m: 2, n: 1 },
        '1 <= m <= n <= 16',
      ],
      [
        { type: 'p2wsh-sortedmulti', m: 2, n: 17 },
        '1 <= m <= n <= 16',
      ],
      [
        { type: 'p2wsh-sortedmulti', m: 2, n: 1.5 },
        'multisig n',
      ],
    ])('rejects an invalid sortedmulti policy %j', (policy, expected) => {
      expect(() =>
        estimate(policy as SpendPolicy, scripts.p2wsh, scripts.p2wpkh, {
          witnessScript: witness2of3,
        })
      ).toThrow(expected);
    });

    it.each([
      [null, 'At least one transaction input'],
      [{ inputs: [], outputs: [{ scriptPubKey: scripts.p2wpkh }] }, 'At least one transaction input'],
      [{ inputs: {}, outputs: [{ scriptPubKey: scripts.p2wpkh }] }, 'At least one transaction input'],
      [{ inputs: [], outputs: [] }, 'At least one transaction input'],
      [{ inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }], outputs: [] }, 'At least one transaction output'],
      [{ inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }], outputs: {} }, 'At least one transaction output'],
    ])('rejects an incomplete request', (request, expected) => {
      expect(() => estimateTransactionWeight(request as never)).toThrow(expected);
    });

    it.each([0, -1, 1.5])('rejects invalid input count %s', (count) => {
      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh, count }],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('input count');
    });

    it('rejects invalid output counts and unsafe aggregate calculations', () => {
      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }],
          outputs: [{ scriptPubKey: scripts.p2wpkh, count: 0 }],
        })
      ).toThrow('output count');

      expect(() =>
        estimateTransactionWeight({
          inputs: [
            {
              spendPolicy: { type: 'p2wpkh' },
              prevoutScript: scripts.p2wpkh,
              count: Number.MAX_SAFE_INTEGER,
            },
          ],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('input base bytes exceeds');
    });

    it('rejects overflow while adding otherwise safe template contributions', () => {
      const individuallySafeCount = Math.floor(Number.MAX_SAFE_INTEGER / 149);
      expect(() =>
        estimateTransactionWeight({
          inputs: [
            { spendPolicy: { type: 'p2pkh' }, prevoutScript: scripts.p2pkh, count: individuallySafeCount },
            { spendPolicy: { type: 'p2pkh' }, prevoutScript: scripts.p2pkh, count: individuallySafeCount },
          ],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('input base bytes exceeds');
    });

    it('rejects non-byte scripts and unknown spend policies', () => {
      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: null as never }],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('prevoutScript must be a Uint8Array');

      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'future-policy' } as never, prevoutScript: scripts.p2wpkh }],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('Unsupported spend policy: future-policy');

      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: undefined as never, prevoutScript: scripts.p2wpkh }],
          outputs: [{ scriptPubKey: scripts.p2wpkh }],
        })
      ).toThrow('Unsupported spend policy: undefined');

      expect(() =>
        estimateTransactionWeight({
          inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: scripts.p2wpkh }],
          outputs: [{ scriptPubKey: null as never }],
        })
      ).toThrow('scriptPubKey must be a Uint8Array');
    });
  });

  describe('feeForRate', () => {
    it.each([
      [110, 1, 110],
      [110, 1.1, 121],
      [111, 0.1, 12],
      [3, 1e3, 3_000],
      [1, Number.MIN_VALUE, 1],
    ])('calculates %d vB at %s sat/vB as %d sats', (vsize, rate, expected) => {
      expect(feeForRate(vsize, rate)).toBe(expected);
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid vsize %s', (vsize) => {
      expect(() => feeForRate(vsize, 1)).toThrow('vsize');
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid fee rate %s', (rate) => {
      expect(() => feeForRate(100, rate)).toThrow('finite positive');
    });

    it('rejects a fee that cannot be safely represented as a number', () => {
      expect(() => feeForRate(Number.MAX_SAFE_INTEGER, 2)).toThrow('fee exceeds');
    });
  });
});
