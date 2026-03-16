/**
 * BIP-329 Official Test Vector Verification (Wallet Labels Export Format)
 *
 * Tests wallet label export format against the BIP-329 specification:
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 *
 * These vectors verify that:
 * - Label records have correct JSON structure
 * - JSONL format is properly produced (one JSON object per line)
 * - All required fields are present
 * - Invalid records are properly identified
 * - Round-trip encoding/decoding preserves data
 */

import { describe, it, expect } from 'vitest';
import {
  BIP329_EXAMPLE_RECORDS,
  BIP329_VALID_JSONL,
  BIP329_INVALID_RECORDS,
  BIP329_ROUNDTRIP_VECTORS,
  type Bip329Label,
} from '@fixtures/bip329-test-vectors';

/** Valid BIP-329 record types */
const VALID_TYPES = ['tx', 'addr', 'pubkey', 'input', 'output', 'xpub'];

/**
 * Validate a BIP-329 label record
 */
function validateBip329Record(record: unknown): { valid: boolean; error?: string } {
  if (typeof record !== 'object' || record === null) {
    return { valid: false, error: 'Record must be a non-null object' };
  }

  const obj = record as Record<string, unknown>;

  if (!obj.type || typeof obj.type !== 'string') {
    return { valid: false, error: 'Missing or invalid type field' };
  }

  if (!VALID_TYPES.includes(obj.type)) {
    return { valid: false, error: `Invalid type: ${obj.type}` };
  }

  if (!obj.ref || typeof obj.ref !== 'string' || obj.ref === '') {
    return { valid: false, error: 'Missing or empty ref field' };
  }

  return { valid: true };
}

/**
 * Serialize a BIP-329 record to a JSONL line
 */
function serializeBip329Record(record: Bip329Label): string {
  const obj: Record<string, unknown> = {
    type: record.type,
    ref: record.ref,
  };
  if (record.label !== undefined) obj.label = record.label;
  if (record.origin !== undefined) obj.origin = record.origin;
  if (record.spendable !== undefined) obj.spendable = record.spendable;
  return JSON.stringify(obj);
}

/**
 * Parse a JSONL line into a BIP-329 record
 */
function parseBip329Line(line: string): Bip329Label | null {
  try {
    const obj = JSON.parse(line);
    const validation = validateBip329Record(obj);
    if (!validation.valid) return null;
    return obj as Bip329Label;
  } catch {
    return null;
  }
}

describe('BIP-329 Official Test Vectors', () => {
  describe('Example records structure', () => {
    BIP329_EXAMPLE_RECORDS.forEach((record) => {
      it(`should have valid structure for ${record.type} record`, () => {
        const validation = validateBip329Record(record);
        expect(validation.valid).toBe(true);
      });

      it(`should have correct type field for ${record.type} record`, () => {
        expect(VALID_TYPES).toContain(record.type);
      });

      it(`should have non-empty ref field for ${record.type} record`, () => {
        expect(record.ref).toBeTruthy();
        expect(typeof record.ref).toBe('string');
        expect(record.ref.length).toBeGreaterThan(0);
      });
    });

    it('should cover all BIP-329 record types', () => {
      const types = BIP329_EXAMPLE_RECORDS.map((r) => r.type);
      expect(types).toContain('tx');
      expect(types).toContain('addr');
      expect(types).toContain('pubkey');
      expect(types).toContain('input');
      expect(types).toContain('output');
      expect(types).toContain('xpub');
    });
  });

  describe('JSONL format', () => {
    it('should produce valid JSONL (one JSON object per line)', () => {
      const lines = BIP329_VALID_JSONL.split('\n');

      lines.forEach((line) => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('each JSONL line should be a valid BIP-329 record', () => {
      const lines = BIP329_VALID_JSONL.split('\n');

      lines.forEach((line) => {
        const record = JSON.parse(line);
        const validation = validateBip329Record(record);
        expect(validation.valid).toBe(true);
      });
    });

    it('should have the correct number of lines', () => {
      const lines = BIP329_VALID_JSONL.split('\n');
      expect(lines.length).toBe(BIP329_EXAMPLE_RECORDS.length);
    });

    it('should serialize example records to match expected JSONL', () => {
      const serialized = BIP329_EXAMPLE_RECORDS.map(serializeBip329Record).join('\n');
      expect(serialized).toBe(BIP329_VALID_JSONL);
    });
  });

  describe('Invalid records rejection', () => {
    BIP329_INVALID_RECORDS.forEach((vector) => {
      it(`should reject: ${vector.reason}`, () => {
        const parsed = parseBip329Line(vector.json);
        expect(parsed).toBeNull();
      });
    });
  });

  describe('Round-trip encoding/decoding', () => {
    BIP329_ROUNDTRIP_VECTORS.forEach((record, index) => {
      it(`should round-trip vector ${index}: ${record.type} record`, () => {
        // Serialize to JSONL
        const serialized = serializeBip329Record(record);

        // Parse back
        const parsed = parseBip329Line(serialized);
        expect(parsed).not.toBeNull();

        // Verify fields match
        expect(parsed!.type).toBe(record.type);
        expect(parsed!.ref).toBe(record.ref);

        if (record.label !== undefined) {
          expect(parsed!.label).toBe(record.label);
        }
        if (record.origin !== undefined) {
          expect(parsed!.origin).toBe(record.origin);
        }
        if (record.spendable !== undefined) {
          expect(parsed!.spendable).toBe(record.spendable);
        }
      });
    });
  });

  describe('Transaction label format', () => {
    it('tx ref should be a 64-character hex string (txid)', () => {
      const txRecords = BIP329_EXAMPLE_RECORDS.filter((r) => r.type === 'tx');
      txRecords.forEach((record) => {
        expect(record.ref).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  });

  describe('Input/Output label format', () => {
    it('input ref should be txid:vout format', () => {
      const inputRecords = BIP329_EXAMPLE_RECORDS.filter((r) => r.type === 'input');
      inputRecords.forEach((record) => {
        expect(record.ref).toMatch(/^[0-9a-f]{64}:\d+$/);
      });
    });

    it('output ref should be txid:vout format', () => {
      const outputRecords = BIP329_EXAMPLE_RECORDS.filter((r) => r.type === 'output');
      outputRecords.forEach((record) => {
        expect(record.ref).toMatch(/^[0-9a-f]{64}:\d+$/);
      });
    });
  });

  describe('Special character handling', () => {
    it('should preserve special characters in labels through JSON encoding', () => {
      const specialRecord = BIP329_ROUNDTRIP_VECTORS.find(
        (r) => r.label && r.label.includes('"')
      );
      expect(specialRecord).toBeDefined();

      const serialized = serializeBip329Record(specialRecord!);
      const parsed = JSON.parse(serialized);
      expect(parsed.label).toBe(specialRecord!.label);
    });
  });
});
