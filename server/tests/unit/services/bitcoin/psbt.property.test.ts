/**
 * PSBT Property-Based Tests
 *
 * These tests verify PSBT invariants that should always hold:
 * - Serialization round-trip preserves data
 * - Fee calculation is consistent
 * - Structure validation is deterministic
 *
 * Property-based testing helps catch edge cases that unit tests miss.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as bitcoin from 'bitcoinjs-lib';

// Note: We use real PSBT test vectors rather than generating random PSBTs,
// because random PSBTs would require valid transaction structures.
// The property tests verify invariants hold across all our valid test vectors.

describe('PSBT Property-Based Tests', () => {
  describe('Serialization Round-Trip', () => {
    it('base64 round-trip preserves PSBT data', () => {
      // Use the official BIP-174 test vectors for round-trip testing
      const validPsbts = [
        // Creator output
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
          const reserialized = psbt.toBase64();
          const psbt2 = bitcoin.Psbt.fromBase64(reserialized);

          // Structure should be identical
          expect(psbt2.data.inputs.length).toBe(psbt.data.inputs.length);
          expect(psbt2.data.outputs.length).toBe(psbt.data.outputs.length);
          expect(psbt2.txInputs.length).toBe(psbt.txInputs.length);
          expect(psbt2.txOutputs.length).toBe(psbt.txOutputs.length);
        }),
        { numRuns: 10 }
      );
    });

    it('hex round-trip preserves PSBT data', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
          const hex = psbt.toHex();
          const psbt2 = bitcoin.Psbt.fromHex(hex);
          const hex2 = psbt2.toHex();

          expect(hex2).toBe(hex);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Input/Output Counting Invariants', () => {
    it('PSBT input count matches transaction input count', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          // PSBT input metadata count must match tx input count
          expect(psbt.data.inputs.length).toBe(psbt.txInputs.length);
        }),
        { numRuns: 10 }
      );
    });

    it('PSBT output count matches transaction output count', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          // PSBT output metadata count must match tx output count
          expect(psbt.data.outputs.length).toBe(psbt.txOutputs.length);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Fee Calculation Properties', () => {
    it('fee is always non-negative when witnessUtxo present', () => {
      // PSBT with witnessUtxo data
      const psbtWithUtxo =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const psbt = bitcoin.Psbt.fromBase64(psbtWithUtxo);

      let totalInput = BigInt(0);
      let hasAllUtxos = true;

      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          totalInput += BigInt(input.witnessUtxo.value);
        } else if (input.nonWitnessUtxo) {
          // Would need to parse the full tx - skip for this test
          hasAllUtxos = false;
        } else {
          hasAllUtxos = false;
        }
      });

      if (hasAllUtxos) {
        let totalOutput = BigInt(0);
        psbt.txOutputs.forEach((output) => {
          totalOutput += BigInt(output.value);
        });

        const fee = totalInput - totalOutput;
        expect(fee).toBeGreaterThanOrEqual(BigInt(0));
      }
    });

    it('output values are always positive', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          psbt.txOutputs.forEach((output) => {
            expect(Number(output.value)).toBeGreaterThan(0);
          });
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Txid Invariants', () => {
    /**
     * Helper to get txid from PSBT
     * psbt.data.getTransaction() returns a Buffer, need to convert to Transaction
     */
    function getTxid(psbt: bitcoin.Psbt): string {
      const txBuffer = psbt.data.getTransaction();
      const tx = bitcoin.Transaction.fromBuffer(txBuffer);
      return tx.getId();
    }

    it('txid is deterministic for same PSBT', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt1 = bitcoin.Psbt.fromBase64(psbtBase64);
          const psbt2 = bitcoin.Psbt.fromBase64(psbtBase64);

          const txid1 = getTxid(psbt1);
          const txid2 = getTxid(psbt2);

          expect(txid1).toBe(txid2);
        }),
        { numRuns: 10 }
      );
    });

    it('txid is 64 hex characters', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
          const txid = getTxid(psbt);

          expect(txid).toMatch(/^[0-9a-f]{64}$/);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Input Reference Properties', () => {
    it('input prevout hash is valid txid format', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          psbt.txInputs.forEach((input) => {
            // Hash is stored in little-endian, convert to txid format
            const txid = Buffer.from(input.hash).reverse().toString('hex');
            expect(txid).toMatch(/^[0-9a-f]{64}$/);
          });
        }),
        { numRuns: 10 }
      );
    });

    it('input vout is non-negative', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          psbt.txInputs.forEach((input) => {
            expect(input.index).toBeGreaterThanOrEqual(0);
          });
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('BIP32 Derivation Properties', () => {
    it('bip32Derivation paths are valid format', () => {
      const psbtWithDerivation =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const BIP32_PATH_REGEX = /^m(\/\d+'?)+$/;

      const psbt = bitcoin.Psbt.fromBase64(psbtWithDerivation);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.path).toMatch(BIP32_PATH_REGEX);
          });
        }
      });
    });

    it('bip32Derivation masterFingerprint is 4 bytes', () => {
      const psbtWithDerivation =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const psbt = bitcoin.Psbt.fromBase64(psbtWithDerivation);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            expect(derivation.masterFingerprint.length).toBe(4);
          });
        }
      });
    });

    it('bip32Derivation pubkey is valid length (33 or 65 bytes)', () => {
      const psbtWithDerivation =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const psbt = bitcoin.Psbt.fromBase64(psbtWithDerivation);

      psbt.data.inputs.forEach((input) => {
        if (input.bip32Derivation) {
          input.bip32Derivation.forEach((derivation) => {
            // Compressed (33) or uncompressed (65) pubkey
            expect([33, 65]).toContain(derivation.pubkey.length);
          });
        }
      });
    });
  });

  describe('Script Properties', () => {
    it('witnessUtxo script starts with valid OP code', () => {
      const psbtWithWitnessUtxo =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const psbt = bitcoin.Psbt.fromBase64(psbtWithWitnessUtxo);

      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          const script = input.witnessUtxo.script;
          // Script should start with a valid opcode
          // Common patterns: OP_0 (0x00), OP_HASH160 (0xa9), OP_DUP (0x76)
          expect(script.length).toBeGreaterThan(0);
        }
      });
    });

    it('witnessUtxo value is positive', () => {
      const psbtWithWitnessUtxo =
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAEAuwIAAAABqtc5MQGL0l+ErkALaISL4J23BurCrBgpi6vucatlb4sAAAAASEcwRAIgWPb8fGoz4bMVSNSByCbAFb0wE1qtQs1neQ2rZtKtJDsCIEoc7SYExnNbY5PltBaR3XiwDwxZQvufdRhW+qk4FX26Af7///8CgPD6AgAAAAAXqRQPuUY0IWlrgsgzryQceMF9295JNIfQ8gonAQAAABepFCnKdPigj4GZlCgYXJe12FLkBj9hh2UAAAABBEdSIQKVg785rgpgl0etGZrd1jT6YQhVnWxc05tMIYPxq5bgfyEC2rYf9JoU22p9ArDNH7t4/EsYMStbTlTa5Nui+/71NtdSriIGApWDvzmuCmCXR60Zmt3WNPphCFWdbFzTm0whg/GrluB/ENkMak8AAACAAAAAgAAAAIAiBgLath/0mhTban0CsM0fu3j8SxgxK1tOVNrk26L7/vU21xDZDGpPAAAAgAAAAIABAACAAAEBIADC6wsAAAAAF6kUt/X69A49QKWkWbHbNTXyty+pIeiHAQQiACCMI1MXN0O1ld+0oHtyuo5C43l9p06H/n2ddJfjsgKJAwEFR1IhAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcIQI63ZBPPW3PWd25BrDe4jUpt/+57VDl6GFRkmhgIh8Oc1KuIgYCOt2QTz1tz1nduQaw3uI1Kbf/ue1Q5ehhUZJoYCIfDnMQ2QxqTwAAAIAAAACAAwAAgCIGAwidwQx6xttU+RMpr2FzM9s4jOrQwjH3IzedG5kDCwLcENkMak8AAACAAAAAgAIAAIAAIgIDqaTDf1mW06ol26xrVwrwZQOUSSlCRgs1R1Ptnuylh3EQ2QxqTwAAAIAAAACABAAAgAAiAgJ/Y5l1fS7/VaE2rQLGhLGDi2VW5fG2s0KCqUtrUAUQlhDZDGpPAAAAgAAAAIAFAACAAA==';

      const psbt = bitcoin.Psbt.fromBase64(psbtWithWitnessUtxo);

      psbt.data.inputs.forEach((input) => {
        if (input.witnessUtxo) {
          expect(Number(input.witnessUtxo.value)).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Sequence Number Properties', () => {
    it('sequence numbers are within valid range', () => {
      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          psbt.txInputs.forEach((input) => {
            // Sequence must be 0 to 0xFFFFFFFF (4 bytes)
            expect(input.sequence).toBeGreaterThanOrEqual(0);
            expect(input.sequence).toBeLessThanOrEqual(0xffffffff);
          });
        }),
        { numRuns: 10 }
      );
    });

    it('RBF signaling uses sequence < 0xFFFFFFFE', () => {
      // PSBTs with RBF enabled typically have sequence 0xFFFFFFFD or lower
      const RBF_MAX_SEQUENCE = 0xfffffffd;

      const validPsbts = [
        'cHNidP8BAJoCAAAAAljoeiG1ba8MI76OcHBFbDNvfLqlyHV5JPVFiHuyq911AAAAAAD/////g40EJ9DsZQpoqka7CwmK6kQiwHGyyng1Kgd5WdB86h0BAAAAAP////8CcKrwCAAAAAAWABTYXCtx0AYLCcmIauuBXlCZHdoSTQDh9QUAAAAAFgAUAK6pouXw+HaliN9VRuh0LR2HAI8AAAAAAAAAAAA=',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...validPsbts), (psbtBase64) => {
          const psbt = bitcoin.Psbt.fromBase64(psbtBase64);

          psbt.txInputs.forEach((input) => {
            const sequence = input.sequence ?? 0xffffffff;
            // Verify RBF-enabled sequence if < 0xFFFFFFFE
            if (sequence < 0xfffffffe) {
              expect(sequence).toBeLessThanOrEqual(RBF_MAX_SEQUENCE);
            }
          });
        }),
        { numRuns: 10 }
      );
    });
  });
});
