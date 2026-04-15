/**
 * PSBT Builder Tests
 *
 * Tests for BIP32 derivation, witness script construction,
 * multisig script parsing, input finalization, and decoy amounts.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import {
  buildMultisigBip32Derivations,
  buildMultisigWitnessScript,
  parseMultisigScript,
  finalizeMultisigInput,
  witnessStackToScriptWitness,
  generateDecoyAmounts,
} from '../../../../src/services/bitcoin/psbtBuilder';
import type { MultisigKeyInfo } from '../../../../src/services/bitcoin/addressDerivation';
import { testMultisigKeys } from './psbtBuilderTestFixtures';

// Initialize ECC library for bitcoinjs-lib and create ECPair factory
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const network = bitcoin.networks.testnet;

describe('PSBT Builder', () => {
  // ========================================
  // buildMultisigBip32Derivations
  // ========================================
  describe('buildMultisigBip32Derivations', () => {
    it('should build derivations for all cosigners at a given path', () => {
      // m/48'/1'/0'/2'/0/5 — external chain, address index 5
      const derivationPath = "m/48'/1'/0'/2'/0/5";
      const result = buildMultisigBip32Derivations(derivationPath, testMultisigKeys, network);

      expect(result).toHaveLength(3);

      // Verify each entry has correct structure
      for (let i = 0; i < result.length; i++) {
        expect(result[i].masterFingerprint).toBeInstanceOf(Buffer);
        expect(result[i].masterFingerprint.toString('hex')).toBe(testMultisigKeys[i].fingerprint);
        expect(result[i].path).toContain("48'");
        expect(result[i].path).toContain('/0/5');
        expect(result[i].pubkey).toBeInstanceOf(Buffer);
        expect(result[i].pubkey.length).toBe(33); // Compressed pubkey
      }
    });

    it('should produce correct full paths for each cosigner', () => {
      const derivationPath = "m/48'/1'/0'/2'/1/10";
      const result = buildMultisigBip32Derivations(derivationPath, testMultisigKeys, network);

      // All keys share accountPath "48'/1'/0'/2'" but with change=1, index=10
      for (const entry of result) {
        expect(entry.path).toMatch(/^m\/48'\/1'\/0'\/2'\/1\/10$/);
      }
    });

    it('should derive unique public keys for each cosigner', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const result = buildMultisigBip32Derivations(derivationPath, testMultisigKeys, network);

      const pubkeyHexes = result.map(r => r.pubkey.toString('hex'));
      const uniquePubkeys = new Set(pubkeyHexes);
      expect(uniquePubkeys.size).toBe(3);
    });

    it('should return empty array for invalid derivation path', () => {
      const result = buildMultisigBip32Derivations('invalid', testMultisigKeys, network);
      expect(result).toEqual([]);
    });

    it('should handle single cosigner', () => {
      const singleKey = [testMultisigKeys[0]];
      const result = buildMultisigBip32Derivations("m/48'/1'/0'/2'/0/0", singleKey, network);
      expect(result).toHaveLength(1);
      expect(result[0].masterFingerprint.toString('hex')).toBe(singleKey[0].fingerprint);
    });

    it('should skip keys that fail to derive and continue', () => {
      const keysWithBadOne: MultisigKeyInfo[] = [
        testMultisigKeys[0],
        { ...testMultisigKeys[1], xpub: 'tpubINVALIDxpub' },
        testMultisigKeys[2],
      ];
      const result = buildMultisigBip32Derivations("m/48'/1'/0'/2'/0/0", keysWithBadOne, network);
      // Should have 2 valid derivations (skipping the bad one)
      expect(result).toHaveLength(2);
    });

    it('should normalize h notation to apostrophe', () => {
      // The function calls normalizeDerivationPath internally
      const derivationPath = "m/48h/1h/0h/2h/0/3";
      const result = buildMultisigBip32Derivations(derivationPath, [testMultisigKeys[0]], network);
      expect(result).toHaveLength(1);
      expect(result[0].path).toContain("48'");
    });

    it('should return empty array when multisig key list is invalid', () => {
      const result = buildMultisigBip32Derivations(
        "m/48'/1'/0'/2'/0/0",
        null as unknown as MultisigKeyInfo[],
        network,
      );
      expect(result).toEqual([]);
    });
  });

  // ========================================
  // buildMultisigWitnessScript
  // ========================================
  describe('buildMultisigWitnessScript', () => {
    it('should build a valid 2-of-3 witness script', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const quorum = 2;

      const script = buildMultisigWitnessScript(derivationPath, testMultisigKeys, quorum, network);

      expect(script).toBeDefined();
      expect(script).toBeInstanceOf(Uint8Array);
      // A 2-of-3 multisig script: OP_2 <pubkey1> <pubkey2> <pubkey3> OP_3 OP_CHECKMULTISIG
      // Should be relatively long (100+ bytes for 3 compressed pubkeys)
      expect(script!.length).toBeGreaterThan(100);
    });

    it('should produce a script that parses as valid multisig', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const script = buildMultisigWitnessScript(derivationPath, testMultisigKeys, 2, network);

      expect(script).toBeDefined();
      const parsed = parseMultisigScript(script!);
      expect(parsed.isMultisig).toBe(true);
      expect(parsed.m).toBe(2);
      expect(parsed.n).toBe(3);
      expect(parsed.pubkeys).toHaveLength(3);
    });

    it('should sort public keys lexicographically (BIP-67)', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/0";
      const script = buildMultisigWitnessScript(derivationPath, testMultisigKeys, 2, network);

      expect(script).toBeDefined();
      const parsed = parseMultisigScript(script!);

      // Verify pubkeys are sorted
      for (let i = 0; i < parsed.pubkeys.length - 1; i++) {
        expect(parsed.pubkeys[i].compare(parsed.pubkeys[i + 1])).toBeLessThan(0);
      }
    });

    it('should return undefined for invalid derivation path', () => {
      const script = buildMultisigWitnessScript('invalid', testMultisigKeys, 2, network);
      expect(script).toBeUndefined();
    });

    it('should return undefined when a key fails to derive', () => {
      const badKeys: MultisigKeyInfo[] = [
        testMultisigKeys[0],
        { ...testMultisigKeys[1], xpub: 'not-a-valid-xpub' },
        testMultisigKeys[2],
      ];
      // When not all pubkeys can be derived, it returns undefined
      const script = buildMultisigWitnessScript("m/48'/1'/0'/2'/0/0", badKeys, 2, network);
      expect(script).toBeUndefined();
    });

    it('should produce consistent scripts for the same inputs', () => {
      const derivationPath = "m/48'/1'/0'/2'/0/7";
      const script1 = buildMultisigWitnessScript(derivationPath, testMultisigKeys, 2, network);
      const script2 = buildMultisigWitnessScript(derivationPath, testMultisigKeys, 2, network);

      expect(script1).toBeDefined();
      expect(Buffer.from(script1!).equals(Buffer.from(script2!))).toBe(true);
    });

    it('should produce different scripts for different address indices', () => {
      const script0 = buildMultisigWitnessScript("m/48'/1'/0'/2'/0/0", testMultisigKeys, 2, network);
      const script1 = buildMultisigWitnessScript("m/48'/1'/0'/2'/0/1", testMultisigKeys, 2, network);

      expect(script0).toBeDefined();
      expect(script1).toBeDefined();
      expect(Buffer.from(script0!).equals(Buffer.from(script1!))).toBe(false);
    });

    it('should return undefined when multisig key list is invalid', () => {
      const script = buildMultisigWitnessScript(
        "m/48'/1'/0'/2'/0/0",
        null as unknown as MultisigKeyInfo[],
        2,
        network,
      );
      expect(script).toBeUndefined();
    });

    it('should return undefined when quorum exceeds cosigner count', () => {
      // With quorum > number of cosigners, p2ms creation should fail
      const script = buildMultisigWitnessScript("m/48'/1'/0'/2'/0/0", testMultisigKeys, 4, network);
      expect(script).toBeUndefined();
    });
  });

  // ========================================
  // parseMultisigScript
  // ========================================
  describe('parseMultisigScript', () => {
    it('should parse a valid 2-of-3 multisig script', () => {
      // Generate 3 keypairs and build a p2ms
      const keys = Array.from({ length: 3 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
      const result = parseMultisigScript(p2ms.output!);

      expect(result.isMultisig).toBe(true);
      expect(result.m).toBe(2);
      expect(result.n).toBe(3);
      expect(result.pubkeys).toHaveLength(3);
    });

    it('should parse a 1-of-2 multisig script', () => {
      const keys = Array.from({ length: 2 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys, network });
      const result = parseMultisigScript(p2ms.output!);

      expect(result.isMultisig).toBe(true);
      expect(result.m).toBe(1);
      expect(result.n).toBe(2);
    });

    it('should parse a 3-of-3 multisig script', () => {
      const keys = Array.from({ length: 3 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 3, pubkeys, network });
      const result = parseMultisigScript(p2ms.output!);

      expect(result.isMultisig).toBe(true);
      expect(result.m).toBe(3);
      expect(result.n).toBe(3);
    });

    it('should return isMultisig false for non-multisig script', () => {
      // P2WPKH script is not multisig
      const key = ECPair.makeRandom({ network });
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(key.publicKey), network });
      const result = parseMultisigScript(p2wpkh.output!);

      expect(result.isMultisig).toBe(false);
      expect(result.m).toBe(0);
      expect(result.n).toBe(0);
      expect(result.pubkeys).toEqual([]);
    });

    it('should return isMultisig false for empty buffer', () => {
      const result = parseMultisigScript(Buffer.alloc(0));
      expect(result.isMultisig).toBe(false);
    });

    it('should return isMultisig false for too-short script', () => {
      const result = parseMultisigScript(Buffer.from([0x51, 0x52, 0xae]));
      expect(result.isMultisig).toBe(false);
    });

    it('should extract correct pubkeys from script', () => {
      const keys = Array.from({ length: 3 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
      const result = parseMultisigScript(p2ms.output!);

      expect(result.pubkeys).toHaveLength(3);
      // Each extracted pubkey should be 33 bytes (compressed)
      for (const pk of result.pubkeys) {
        expect(pk.length).toBe(33);
      }
      // Pubkeys should match the originals (in sorted order)
      for (let i = 0; i < pubkeys.length; i++) {
        expect(result.pubkeys[i].equals(pubkeys[i])).toBe(true);
      }
    });

    it('should return false when terminal opcode is not CHECKMULTISIG', () => {
      // Build a script: OP_2 <33-byte pubkey> <33-byte pubkey> OP_2 OP_CHECKSIG
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_2,
        Buffer.alloc(33, 0x11),
        Buffer.alloc(33, 0x22),
        bitcoin.opcodes.OP_2,
        bitcoin.opcodes.OP_CHECKSIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should parse scripts that encode m and n as raw small integers', () => {
      // Build a valid 2-of-2 multisig script using OP_2 opcodes
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_2,
        Buffer.alloc(33, 0x11),
        Buffer.alloc(33, 0x22),
        bitcoin.opcodes.OP_2,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(true);
      expect(result.m).toBe(2);
      expect(result.n).toBe(2);
    });

    it('should accept 65-byte uncompressed pubkeys when parsing multisig scripts', () => {
      // Build a 1-of-1 multisig with a 65-byte uncompressed pubkey
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        Buffer.alloc(65, 0x11),
        bitcoin.opcodes.OP_1,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(true);
      expect(result.pubkeys).toHaveLength(1);
      expect(result.pubkeys[0].length).toBe(65);
    });

    it('should ignore buffer items that are not valid pubkey lengths', () => {
      // Build a script with a 20-byte data push (not a valid pubkey length)
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        Buffer.alloc(20, 0x11),
        bitcoin.opcodes.OP_1,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should return false when m is numeric but outside supported range', () => {
      // Build a script with OP_0 as m (outside 1-16 range)
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_0,
        Buffer.alloc(33, 0x11),
        bitcoin.opcodes.OP_1,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should return false when m is not numeric', () => {
      // Build a script with a 2-byte data push where m should be (decompiles as Buffer, not number)
      const script = bitcoin.script.compile([
        Buffer.alloc(2, 0x01),
        Buffer.alloc(33, 0x11),
        bitcoin.opcodes.OP_1,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should return false when n is numeric but outside supported range', () => {
      // Build a script: OP_1 <pubkey> OP_17 OP_CHECKMULTISIG
      // OP_17 = 0x61 which is outside valid 1-16 range
      // We need to construct this manually since compile won't accept 17 as opcode directly
      const pubkey = Buffer.alloc(33, 0x11);
      const script = Buffer.concat([
        Buffer.from([bitcoin.opcodes.OP_1!]),  // m=1
        Buffer.from([0x21]),                    // push 33 bytes
        pubkey,
        Buffer.from([0x61]),                    // raw opcode 0x61 (OP_NOP, used to simulate n=17)
        Buffer.from([bitcoin.opcodes.OP_CHECKMULTISIG!]),
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should return false when n is not numeric', () => {
      // Build a script with a 1-byte data push where n should be
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        Buffer.alloc(33, 0x11),
        Buffer.alloc(1, 0x02),
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });

    it('should return false when declared pubkey count does not match n', () => {
      // Build a script: OP_1 <pubkey> OP_2 OP_CHECKMULTISIG
      // Claims n=2 but only has 1 pubkey
      const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        Buffer.alloc(33, 0x11),
        bitcoin.opcodes.OP_2,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);

      const result = parseMultisigScript(script);
      expect(result.isMultisig).toBe(false);
    });
  });

  // ========================================
  // witnessStackToScriptWitness
  // ========================================
  describe('witnessStackToScriptWitness', () => {
    it('should serialize an empty witness stack', () => {
      const result = witnessStackToScriptWitness([]);
      // Just the varint count (0)
      expect(result).toEqual(Buffer.from([0x00]));
    });

    it('should serialize a single empty element', () => {
      const result = witnessStackToScriptWitness([Buffer.alloc(0)]);
      // count=1, element_length=0
      expect(result).toEqual(Buffer.from([0x01, 0x00]));
    });

    it('should serialize a witness stack with multiple elements', () => {
      const stack = [
        Buffer.alloc(0),                         // OP_0 (for CHECKMULTISIG bug)
        Buffer.from('aa'.repeat(71), 'hex'),    // sig1 (71 bytes)
        Buffer.from('bb'.repeat(71), 'hex'),    // sig2 (71 bytes)
        Buffer.from('cc'.repeat(105), 'hex'),   // witnessScript (105 bytes)
      ];

      const result = witnessStackToScriptWitness(stack);

      // First byte should be item count (4)
      expect(result[0]).toBe(4);
      // Total length: 1 (count) + 1 (len=0) + 1+71 + 1+71 + 1+105 = 251
      expect(result.length).toBe(1 + 1 + (1 + 71) + (1 + 71) + (1 + 105));
    });

    it('should handle elements larger than 252 bytes with varint encoding', () => {
      const bigElement = Buffer.alloc(300, 0xab);
      const result = witnessStackToScriptWitness([bigElement]);

      // count=1, varint length (0xfd + 2 bytes for 300) + 300 bytes data
      expect(result[0]).toBe(1); // count
      expect(result[1]).toBe(0xfd); // varint prefix for 2-byte length
      expect(result.length).toBe(1 + 3 + 300); // count + varint(300) + data
    });

    it('should use 4-byte varint prefix for elements larger than 65535 bytes', () => {
      const veryBig = Buffer.alloc(70_000, 0xab);
      const result = witnessStackToScriptWitness([veryBig]);

      // count=1, varint prefix for 4-byte length is 0xfe
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(0xfe);
      expect(result.length).toBe(1 + 5 + 70_000);
    });

    it('should use 8-byte varint prefix when item count exceeds uint32', () => {
      const hugeCount = 0x1_0000_0000; // 2^32
      const fakeWitness = {
        length: hugeCount,
        [Symbol.iterator]: function* () {
          // Intentionally empty: test count varint branch only
        },
      } as unknown as Buffer[];

      const result = witnessStackToScriptWitness(fakeWitness);
      expect(result[0]).toBe(0xff);
      expect(result.subarray(1).readBigUInt64LE(0)).toBe(BigInt(hugeCount));
      expect(result.length).toBe(9);
    });
  });

  // ========================================
  // generateDecoyAmounts
  // ========================================
  describe('generateDecoyAmounts', () => {
    const dustThreshold = 546;

    it('should return single amount when count < 2', () => {
      const result = generateDecoyAmounts(100000, 1, dustThreshold);
      expect(result).toEqual([100000]);
    });

    it('should return single amount when count is 0', () => {
      const result = generateDecoyAmounts(100000, 0, dustThreshold);
      expect(result).toEqual([100000]);
    });

    it('should split into exactly the requested count', () => {
      const result = generateDecoyAmounts(1000000, 3, dustThreshold);
      expect(result).toHaveLength(3);
    });

    it('should sum to the total change amount', () => {
      for (let trial = 0; trial < 10; trial++) {
        const totalChange = 500000;
        const result = generateDecoyAmounts(totalChange, 3, dustThreshold);
        const sum = result.reduce((a, b) => a + b, 0);
        expect(sum).toBe(totalChange);
      }
    });

    it('should produce amounts above dust threshold', () => {
      for (let trial = 0; trial < 10; trial++) {
        const result = generateDecoyAmounts(100000, 3, dustThreshold);
        for (const amount of result) {
          expect(amount).toBeGreaterThanOrEqual(dustThreshold);
        }
      }
    });

    it('should return single output when not enough for split', () => {
      // Total change barely above 2 * dustThreshold = 1092
      const result = generateDecoyAmounts(1000, 3, dustThreshold);
      // Not enough to split 3 ways above dust, falls back to single
      expect(result).toEqual([1000]);
    });

    it('should handle large count with sufficient change', () => {
      const result = generateDecoyAmounts(10000000, 5, dustThreshold);
      expect(result).toHaveLength(5);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBe(10000000);
    });

    it('should produce varied amounts (not all equal)', () => {
      // Run multiple times to check randomness produces variation
      let allSame = true;
      for (let trial = 0; trial < 5; trial++) {
        const result = generateDecoyAmounts(1000000, 3, dustThreshold);
        if (new Set(result).size > 1) {
          allSame = false;
          break;
        }
      }
      expect(allSame).toBe(false);
    });

    it('should clamp an oversized decoy split to half of remaining amount', () => {
      const randomValues = [
        // 3 weight draws
        0.8087661718073307,
        0.6637779357253595,
        0.028267548351639693,
        // 2 variation draws
        0.12559837799690476,
        0.9847832745898579,
        // 2 shuffle draws
        0,
        0,
      ];
      const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => randomValues.shift() ?? 0);

      try {
        const result = generateDecoyAmounts(1639, 3, dustThreshold);
        // Branch at line 538 clamps a would-be 561 sat output to floor(1093 / 2) = 546.
        expect([...result].sort((a, b) => a - b)).toEqual([546, 546, 547]);
        expect(result.reduce((sum, value) => sum + value, 0)).toBe(1639);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  // ========================================
  // finalizeMultisigInput
  // ========================================
  describe('finalizeMultisigInput', () => {
    it('should throw when witnessScript is missing', () => {
      const psbt = new bitcoin.Psbt({ network });

      // Add a dummy input/output so PSBT is valid
      const key = ECPair.makeRandom({ network });
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(key.publicKey), network });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        witnessUtxo: { script: p2wpkh.output!, value: BigInt(100000) },
      });
      psbt.addOutput({ address: p2wpkh.address!, value: BigInt(90000) });

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('missing witnessScript');
    });

    it('should throw when no partial signatures exist', () => {
      const psbt = new bitcoin.Psbt({ network });
      const keys = Array.from({ length: 2 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys, network });
      const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

      psbt.addInput({
        hash: Buffer.alloc(32, 0xbb),
        index: 0,
        witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
        witnessScript: p2ms.output!,
      });
      psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('no partial signatures');
    });

    it('should throw when witnessScript is not a valid multisig script', () => {
      const psbt = new bitcoin.Psbt({ network });
      const key = ECPair.makeRandom({ network });
      const pubkey = Buffer.from(key.publicKey);

      // Use a P2PK script as witnessScript (valid for P2WSH but not multisig)
      const p2pkScript = bitcoin.script.compile([pubkey, bitcoin.opcodes.OP_CHECKSIG]);
      const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: p2pkScript, network }, network });

      psbt.addInput({
        hash: Buffer.alloc(32, 0xcc),
        index: 0,
        witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
        witnessScript: p2pkScript,
      });
      psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

      // Manually add a fake partial sig
      psbt.data.inputs[0].partialSig = [{
        pubkey,
        signature: Buffer.alloc(72, 0x30),
      }];

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('not a valid multisig script');
    });

    it('should throw when signature count does not match quorum', () => {
      const psbt = new bitcoin.Psbt({ network });
      const keys = Array.from({ length: 3 }, () => ECPair.makeRandom({ network }));
      const pubkeys = keys.map(k => Buffer.from(k.publicKey)).sort(Buffer.compare);

      const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys, network });
      const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

      psbt.addInput({
        hash: Buffer.alloc(32, 0xdd),
        index: 0,
        witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
        witnessScript: p2ms.output!,
      });
      psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

      // Only 1 signature for a 2-of-3 (need 2)
      // Build a dummy DER sig
      const dummySig = Buffer.concat([
        Buffer.from('3045022100', 'hex'),
        Buffer.alloc(32, 0x01), // r
        Buffer.from('0220', 'hex'),
        Buffer.alloc(32, 0x02), // s
        Buffer.from([0x01]), // sighash
      ]);

      psbt.data.inputs[0].partialSig = [{
        pubkey: pubkeys[0],
        signature: dummySig,
      }];

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('has 1 signatures but needs exactly 2');
    });

    it('should throw when partial signatures do not match witnessScript pubkeys', () => {
      const psbt = new bitcoin.Psbt({ network });
      const scriptKey = ECPair.makeRandom({ network });
      const wrongKey = ECPair.makeRandom({ network });
      const scriptPubkey = Buffer.from(scriptKey.publicKey);
      const wrongPubkey = Buffer.from(wrongKey.publicKey);

      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [scriptPubkey], network });
      const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

      psbt.addInput({
        hash: Buffer.alloc(32, 0xef),
        index: 0,
        witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
        witnessScript: p2ms.output!,
      });
      psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

      const derLikeSig = Buffer.concat([
        Buffer.from('30440220', 'hex'),
        Buffer.alloc(32, 0x01),
        Buffer.from('0220', 'hex'),
        Buffer.alloc(32, 0x02),
        Buffer.from([0x01]),
      ]);
      psbt.data.inputs[0].partialSig = [{ pubkey: wrongPubkey, signature: derLikeSig }];

      expect(() => finalizeMultisigInput(psbt, 0)).toThrow('no matching signatures found');
    });

    it('continues finalization when witnessUtxo is missing and signature verification errors', () => {
      const key = ECPair.makeRandom({ network });
      const pubkey = Buffer.from(key.publicKey);
      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });

      const fakePsbt = {
        data: {
          inputs: [
            {
              witnessScript: p2ms.output!,
              partialSig: [{ pubkey, signature: Buffer.from([0x01]) }],
              // witnessUtxo intentionally omitted to hit warning branch
            },
          ],
          globalMap: {
            unsignedTx: {
              toBuffer: () => new bitcoin.Transaction().toBuffer(),
            },
          },
        },
        updateInput: vi.fn(),
      } as unknown as bitcoin.Psbt;

      expect(() => finalizeMultisigInput(fakePsbt, 0)).not.toThrow();
      expect((fakePsbt as any).updateInput).toHaveBeenCalledTimes(1);
    });

    it('handles DER signatures with s values longer than 32 bytes during verification', () => {
      const key = ECPair.makeRandom({ network });
      const pubkey = Buffer.from(key.publicKey);
      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
      const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

      // Build DER-like signature where s has 33 bytes (leading zero + 32-byte value)
      const derSig = Buffer.concat([
        Buffer.from([0x30, 0x26, 0x02, 0x01, 0x01, 0x02, 0x21, 0x00]),
        Buffer.alloc(32, 0x02),
      ]);
      const signatureWithHashType = Buffer.concat([derSig, Buffer.from([0x01])]);

      const fakePsbt = {
        data: {
          inputs: [
            {
              witnessScript: p2ms.output!,
              witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
              partialSig: [{ pubkey, signature: signatureWithHashType }],
            },
          ],
          globalMap: {
            unsignedTx: {
              toBuffer: () => new bitcoin.Transaction().toBuffer(),
            },
          },
        },
        updateInput: vi.fn(),
      } as unknown as bitcoin.Psbt;

      expect(() => finalizeMultisigInput(fakePsbt, 0)).not.toThrow();
      expect((fakePsbt as any).updateInput).toHaveBeenCalledTimes(1);
    });

    it('should finalize when signature count matches quorum', () => {
      const psbt = new bitcoin.Psbt({ network });
      const key = ECPair.makeRandom({ network });
      const pubkey = Buffer.from(key.publicKey);

      const p2ms = bitcoin.payments.p2ms({ m: 1, pubkeys: [pubkey], network });
      const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });

      psbt.addInput({
        hash: Buffer.alloc(32, 0xee),
        index: 0,
        witnessUtxo: { script: p2wsh.output!, value: BigInt(100000) },
        witnessScript: p2ms.output!,
      });
      psbt.addOutput({ address: p2wsh.address!, value: BigInt(90000) });

      const derLikeSig = Buffer.concat([
        Buffer.from('30440220', 'hex'),
        Buffer.alloc(32, 0x01),
        Buffer.from('0220', 'hex'),
        Buffer.alloc(32, 0x02),
        Buffer.from([0x01]), // SIGHASH_ALL
      ]);

      psbt.data.inputs[0].partialSig = [{ pubkey, signature: derLikeSig }];

      expect(() => finalizeMultisigInput(psbt, 0)).not.toThrow();
      expect(psbt.data.inputs[0].finalScriptWitness).toBeInstanceOf(Buffer);
    });
  });
});
