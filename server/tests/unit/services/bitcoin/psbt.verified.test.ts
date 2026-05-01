/**
 * PSBT Cross-Implementation Verification Tests
 *
 * These tests verify our PSBT handling against:
 * 1. BIP-174 official test vectors
 * 2. Local deterministic extended vectors (P2WPKH/P2WSH)
 */

import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  ALL_BIP174_VECTORS,
  ALL_BIP174_INVALID_VECTORS,
  P2WPKH_VECTORS,
  P2WSH_MULTISIG_VECTORS,
} from '@fixtures/bip174-test-vectors';
import {
  GENERATED_P2WPKH_VECTORS,
  GENERATED_P2SH_P2WPKH_VECTORS,
  GENERATED_P2TR_VECTORS,
  GENERATED_P2WSH_VECTORS,
  GENERATED_P2SH_P2WSH_VECTORS,
} from '@fixtures/generated-psbt-vectors';

const P2WPKH_TEST_VECTORS = [...P2WPKH_VECTORS, ...GENERATED_P2WPKH_VECTORS];
const P2SH_P2WPKH_TEST_VECTORS = [...GENERATED_P2SH_P2WPKH_VECTORS];
const P2TR_TEST_VECTORS = [...GENERATED_P2TR_VECTORS];
const P2WSH_TEST_VECTORS = [...P2WSH_MULTISIG_VECTORS, ...GENERATED_P2WSH_VECTORS];
const P2SH_P2WSH_TEST_VECTORS = [...GENERATED_P2SH_P2WSH_VECTORS];
const ALL_EXTENDED_TEST_VECTORS = [
  ...P2WPKH_TEST_VECTORS,
  ...P2SH_P2WPKH_TEST_VECTORS,
  ...P2TR_TEST_VECTORS,
  ...P2WSH_TEST_VECTORS,
  ...P2SH_P2WSH_TEST_VECTORS,
];
const GENERATED_SCRIPT_GROUPS = [
  GENERATED_P2WPKH_VECTORS,
  GENERATED_P2SH_P2WPKH_VECTORS,
  GENERATED_P2TR_VECTORS,
  GENERATED_P2WSH_VECTORS,
  GENERATED_P2SH_P2WSH_VECTORS,
];

function expectP2shScript(script: Uint8Array | undefined): void {
  expect(script).toBeDefined();
  expect(script![0]).toBe(bitcoin.opcodes.OP_HASH160);
  expect(script![1]).toBe(0x14);
  expect(script![22]).toBe(bitcoin.opcodes.OP_EQUAL);
}

function expectWitnessProgram(script: Uint8Array | undefined, byteLength: number): void {
  expect(script).toBeDefined();
  expect(script![0]).toBe(0x00);
  expect(script![1]).toBe(byteLength);
  expect(script!.length).toBe(byteLength + 2);
}

describe('Generated Bitcoin Core-backed PSBT Vectors', () => {
  it('has non-empty generated vectors for every required script family', () => {
    GENERATED_SCRIPT_GROUPS.forEach((group) => {
      expect(group.length).toBeGreaterThan(0);
    });
  });

  it('records Bitcoin Core and Sanctuary verification provenance', () => {
    const generatedVectors = GENERATED_SCRIPT_GROUPS.flat();

    generatedVectors.forEach((vector) => {
      expect(vector.verifiedBy.some((impl) => impl.includes('Bitcoin Core'))).toBe(true);
      expect(vector.verifiedBy.some((impl) => impl.includes('Sanctuary'))).toBe(true);
    });
  });

  it('covers the nested SegWit, Taproot, and nested multisig script families', () => {
    expect(GENERATED_SCRIPT_GROUPS.flat().map((vector) => vector.scriptType)).toEqual(
      expect.arrayContaining(['p2sh-p2wpkh', 'p2tr', 'p2sh-p2wsh'])
    );
  });
});

describe('PSBT BIP-174 Compliance', () => {
  describe('Valid PSBT Parsing', () => {
    ALL_BIP174_VECTORS.forEach((vector) => {
      const psbtBase64 = vector.inputPsbtBase64 || vector.expectedOutputBase64;
      if (!psbtBase64) return;

      it(`should parse: ${vector.description}`, () => {
        expect(() => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
          expect(psbt).toBeDefined();
          expect(psbt.data.inputs.length).toBeGreaterThanOrEqual(0);
        }).not.toThrow();
      });
    });
  });

  describe('Invalid PSBT Rejection', () => {
    ALL_BIP174_INVALID_VECTORS.forEach((vector) => {
      it(`should reject: ${vector.description}`, () => {
        expect(() => {
          bitcoin.Psbt.fromBase64(vector.inputPsbtBase64!);
        }).toThrow();
      });
    });
  });

  describe('PSBT Round-Trip Serialization', () => {
    ALL_BIP174_VECTORS.forEach((vector) => {
      const psbtBase64 = vector.expectedOutputBase64;
      if (!psbtBase64) return;

      it(`should round-trip: ${vector.description}`, () => {
        const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
        const reserialized = psbt.toBase64();

        const psbt2 = bitcoin.Psbt.fromBase64(reserialized);
        expect(psbt2.data.inputs.length).toBe(psbt.data.inputs.length);
        expect(psbt2.data.outputs.length).toBe(psbt.data.outputs.length);
      });
    });
  });
});

describe('PSBT Structure Validation', () => {
  describe('P2WPKH Vectors', () => {
    it('has P2WPKH vectors', () => {
      expect(P2WPKH_TEST_VECTORS.length).toBeGreaterThan(0);
    });

    P2WPKH_TEST_VECTORS.forEach((vector) => {
      describe(vector.description, () => {
        let psbt: bitcoin.Psbt;

        beforeAll(() => {
          psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);
        });

        it('should have valid structure', () => {
          expect(psbt.data.inputs.length).toBeGreaterThan(0);
          expect(psbt.data.outputs.length).toBeGreaterThan(0);
        });

        it('should have witnessUtxo for all inputs', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.witnessUtxo).toBeDefined();
            expect(Number(input.witnessUtxo?.value)).toBeGreaterThan(0);
          });
        });

        it('should have correct network prefix in outputs', () => {
          const network = vector.network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

          psbt.txOutputs.forEach((output) => {
            const address = bitcoin.address.fromOutputScript(output.script, network);
            if (vector.network === 'testnet') {
              expect(address.startsWith('tb1') || address.startsWith('2')).toBe(true);
            } else {
              expect(address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')).toBe(true);
            }
          });
        });
      });
    });
  });

  describe('P2WSH Multisig Vectors', () => {
    it('has P2WSH multisig vectors', () => {
      expect(P2WSH_TEST_VECTORS.length).toBeGreaterThan(0);
    });

    P2WSH_TEST_VECTORS.forEach((vector) => {
      describe(vector.description, () => {
        let psbt: bitcoin.Psbt;

        beforeAll(() => {
          psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);
        });

        it('should have valid structure', () => {
          expect(psbt.data.inputs.length).toBeGreaterThan(0);
          expect(psbt.data.outputs.length).toBeGreaterThan(0);
        });

        it('should have witnessScript for multisig inputs', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.witnessScript).toBeDefined();
          });
        });

        it('should have bip32Derivation for all signers', () => {
          psbt.data.inputs.forEach((input) => {
            expect(input.bip32Derivation).toBeDefined();
            expect(input.bip32Derivation!.length).toBeGreaterThanOrEqual(2);
          });
        });

        it('witnessScript should be valid sortedmulti', () => {
          psbt.data.inputs.forEach((input) => {
            const script = input.witnessScript!;
            expect(script[0]).toBeGreaterThanOrEqual(0x51);
            expect(script[0]).toBeLessThanOrEqual(0x60);
          });
        });
      });
    });
  });

  describe('Generated Nested SegWit and Taproot Vectors', () => {
    it('has P2SH-P2WPKH, P2TR, and P2SH-P2WSH vectors', () => {
      expect(P2SH_P2WPKH_TEST_VECTORS.length).toBeGreaterThan(0);
      expect(P2TR_TEST_VECTORS.length).toBeGreaterThan(0);
      expect(P2SH_P2WSH_TEST_VECTORS.length).toBeGreaterThan(0);
    });

    P2SH_P2WPKH_TEST_VECTORS.forEach((vector) => {
      it(`has nested P2WPKH redeemScript and P2SH witnessUtxo: ${vector.description}`, () => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          expectP2shScript(input.witnessUtxo?.script);
          expectWitnessProgram(input.redeemScript, 20);
          expect(input.witnessScript).toBeUndefined();
        });
      });
    });

    P2TR_TEST_VECTORS.forEach((vector) => {
      it(`has Taproot key-path metadata: ${vector.description}`, () => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          expect(input.witnessUtxo?.script[0]).toBe(bitcoin.opcodes.OP_1);
          expect(input.witnessUtxo?.script[1]).toBe(0x20);
          expect(input.tapInternalKey?.length).toBe(32);
          expect(input.tapBip32Derivation).toBeDefined();
          expect(input.tapBip32Derivation![0].pubkey.length).toBe(32);
          expect(input.tapBip32Derivation![0].leafHashes).toEqual([]);
        });
      });
    });

    P2SH_P2WSH_TEST_VECTORS.forEach((vector) => {
      it(`has nested multisig redeemScript, witnessScript, and signer derivations: ${vector.description}`, () => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          expectP2shScript(input.witnessUtxo?.script);
          expectWitnessProgram(input.redeemScript, 32);
          expect(input.witnessScript).toBeDefined();
          expect(input.bip32Derivation?.length).toBeGreaterThanOrEqual(2);
        });
      });
    });
  });
});

describe('PSBT Fee Calculation', () => {
  const allVectors = ALL_EXTENDED_TEST_VECTORS;

  it('has vectors for fee calculation tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  it('should calculate correct fee for all vectors', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      let inputValue = 0;
      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          inputValue += Number(input.witnessUtxo.value);
        }
      });

      let outputValue = 0;
      psbt.txOutputs.forEach((output) => {
        outputValue += Number(output.value);
      });

      const calculatedFee = inputValue - outputValue;
      expect(calculatedFee).toBe(vector.expectedFee);
    });
  });
});

describe('PSBT Invariants (Property-Based)', () => {
  const allVectors = ALL_EXTENDED_TEST_VECTORS;

  it('has vectors for invariant tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  describe('Fee Invariants', () => {
    it('fee should always be positive', () => {
      allVectors.forEach((vector) => {
        expect(vector.expectedFee).toBeGreaterThan(0);
      });
    });

    it('fee should be less than total input value', () => {
      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        let inputValue = 0;
        psbt.data.inputs.forEach((input) => {
          if (input.witnessUtxo) {
            inputValue += Number(input.witnessUtxo.value);
          }
        });

        expect(vector.expectedFee).toBeLessThan(inputValue);
      });
    });
  });

  describe('Output Invariants', () => {
    it('no output should be dust (< 546 sats for non-segwit)', () => {
      const DUST_THRESHOLD = 546;

      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.txOutputs.forEach((output) => {
          expect(Number(output.value)).toBeGreaterThanOrEqual(DUST_THRESHOLD);
        });
      });
    });
  });

  describe('Input Invariants', () => {
    it('all inputs should have UTXO data', () => {
      allVectors.forEach((vector) => {
        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          const hasUtxoData = input.witnessUtxo || input.nonWitnessUtxo;
          expect(hasUtxoData).toBeDefined();
        });
      });
    });

    it('SegWit inputs should have witnessUtxo', () => {
      allVectors.forEach((vector) => {
        if (!['p2wpkh', 'p2wsh', 'p2sh-p2wpkh', 'p2sh-p2wsh'].includes(vector.scriptType)) {
          return;
        }

        const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

        psbt.data.inputs.forEach((input) => {
          expect(input.witnessUtxo).toBeDefined();
        });
      });
    });
  });
});

describe('PSBT BIP32 Derivation', () => {
  const allVectors = ALL_EXTENDED_TEST_VECTORS;

  it('has vectors for BIP32 derivation tests', () => {
    expect(allVectors.length).toBeGreaterThan(0);
  });

  it('bip32Derivation should have valid masterFingerprint (4 bytes)', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.masterFingerprint.length).toBe(4);
          });
        }
      });
    });
  });

  it('bip32Derivation path should be valid BIP32 format', () => {
    const BIP32_PATH_REGEX = /^m(\/\d+'?)+$/;

    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.path).toMatch(BIP32_PATH_REGEX);
          });
        }
      });
    });
  });

  it('bip32Derivation pubkey should be valid compressed or uncompressed', () => {
    allVectors.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect([33, 65]).toContain(derivation.pubkey.length);
          });
        }
      });
    });
  });

  it('tapBip32Derivation pubkey should be valid x-only BIP340 keys', () => {
    P2TR_TEST_VECTORS.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.data.inputs.forEach((input) => {
        expect(input.tapBip32Derivation).toBeDefined();
        input.tapBip32Derivation!.forEach((derivation) => {
          expect(derivation.masterFingerprint.length).toBe(4);
          expect(derivation.path).toMatch(/^m(\/\d+'?)+$/);
          expect(derivation.pubkey.length).toBe(32);
        });
      });
    });
  });
});

describe('PSBT Sequence Numbers (RBF)', () => {
  it('has P2WPKH vectors for RBF tests', () => {
    expect(P2WPKH_TEST_VECTORS.length).toBeGreaterThan(0);
  });

  it('should detect RBF-enabled transactions', () => {
    const RBF_SEQUENCE = 0xfffffffd;

    P2WPKH_TEST_VECTORS.forEach((vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.psbtBase64);

      psbt.txInputs.forEach((input) => {
        if (input.sequence !== undefined && input.sequence < 0xffffffff) {
          expect(input.sequence).toBeLessThanOrEqual(RBF_SEQUENCE);
        }
      });
    });
  });
});
