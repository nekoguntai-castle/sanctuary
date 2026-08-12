/**
 * Safe JSON Parsing Utilities Tests
 *
 * Tests for type-safe JSON parsing with Zod schema validation.
 * Covers both schema-validated and untyped parsing functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  safeJsonParse,
  safeJsonParseSensitive,
  safeJsonParseUntyped,
  SystemSettingSchemas,
} from '../../../src/utils/safeJson';

describe('Safe JSON Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('safeJsonParse', () => {
    describe('with boolean schema', () => {
      it('should parse valid boolean true', () => {
        const result = safeJsonParse('true', z.boolean(), false, 'test');
        expect(result).toBe(true);
      });

      it('should parse valid boolean false', () => {
        const result = safeJsonParse('false', z.boolean(), true, 'test');
        expect(result).toBe(false);
      });

      it('should return default for invalid boolean', () => {
        const result = safeJsonParse('"yes"', z.boolean(), false, 'test');
        expect(result).toBe(false);
      });

      it('should return default for number when expecting boolean', () => {
        const result = safeJsonParse('1', z.boolean(), false, 'test');
        expect(result).toBe(false);
      });
    });

    describe('with number schema', () => {
      it('should parse valid integer', () => {
        const result = safeJsonParse('42', z.number(), 0, 'test');
        expect(result).toBe(42);
      });

      it('should parse valid float', () => {
        const result = safeJsonParse('3.14', z.number(), 0, 'test');
        expect(result).toBe(3.14);
      });

      it('should parse negative number', () => {
        const result = safeJsonParse('-100', z.number(), 0, 'test');
        expect(result).toBe(-100);
      });

      it('should return default for string when expecting number', () => {
        const result = safeJsonParse('"42"', z.number(), 0, 'test');
        expect(result).toBe(0);
      });

      it('should parse zero', () => {
        const result = safeJsonParse('0', z.number(), 999, 'test');
        expect(result).toBe(0);
      });
    });

    describe('with string schema', () => {
      it('should parse valid string', () => {
        const result = safeJsonParse('"hello"', z.string(), '', 'test');
        expect(result).toBe('hello');
      });

      it('should parse empty string', () => {
        const result = safeJsonParse('""', z.string(), 'default', 'test');
        expect(result).toBe('');
      });

      it('should return default for number when expecting string', () => {
        const result = safeJsonParse('42', z.string(), 'default', 'test');
        expect(result).toBe('default');
      });

      it('should parse string with special characters', () => {
        const result = safeJsonParse('"hello\\nworld"', z.string(), '', 'test');
        expect(result).toBe('hello\nworld');
      });
    });

    describe('with array schema', () => {
      it('should parse string array', () => {
        const result = safeJsonParse(
          '["a","b","c"]',
          z.array(z.string()),
          [],
          'test'
        );
        expect(result).toEqual(['a', 'b', 'c']);
      });

      it('should parse number array', () => {
        const result = safeJsonParse(
          '[1,2,3]',
          z.array(z.number()),
          [],
          'test'
        );
        expect(result).toEqual([1, 2, 3]);
      });

      it('should parse empty array', () => {
        const result = safeJsonParse('[]', z.array(z.string()), ['default'], 'test');
        expect(result).toEqual([]);
      });

      it('should return default for mixed type array when expecting number array', () => {
        const result = safeJsonParse(
          '[1,"two",3]',
          z.array(z.number()),
          [0],
          'test'
        );
        expect(result).toEqual([0]);
      });
    });

    describe('with object schema', () => {
      const configSchema = z.object({
        enabled: z.boolean(),
        limit: z.number(),
        name: z.string().optional(),
      });

      it('should parse valid object', () => {
        const json = '{"enabled":true,"limit":100}';
        const result = safeJsonParse(json, configSchema, { enabled: false, limit: 0 }, 'test');

        expect(result).toEqual({ enabled: true, limit: 100 });
      });

      it('should parse object with optional field', () => {
        const json = '{"enabled":true,"limit":100,"name":"test"}';
        const result = safeJsonParse(json, configSchema, { enabled: false, limit: 0 }, 'test');

        expect(result).toEqual({ enabled: true, limit: 100, name: 'test' });
      });

      it('should return default for invalid object', () => {
        const json = '{"enabled":"yes","limit":"100"}';
        const defaultValue = { enabled: false, limit: 0 };
        const result = safeJsonParse(json, configSchema, defaultValue, 'test');

        expect(result).toEqual(defaultValue);
      });

      it('should return default for missing required field', () => {
        const json = '{"enabled":true}';
        const defaultValue = { enabled: false, limit: 0 };
        const result = safeJsonParse(json, configSchema, defaultValue, 'test');

        expect(result).toEqual(defaultValue);
      });
    });

    describe('error handling', () => {
      it('should return default for null input', () => {
        const result = safeJsonParse(null, z.boolean(), true, 'test');
        expect(result).toBe(true);
      });

      it('should return default for undefined input', () => {
        const result = safeJsonParse(undefined, z.number(), 42, 'test');
        expect(result).toBe(42);
      });

      it('should return default for invalid JSON syntax', () => {
        const result = safeJsonParse('{invalid}', z.object({}), {}, 'test');
        expect(result).toEqual({});
      });

      it('should return default for truncated JSON', () => {
        const result = safeJsonParse('{"key": "val', z.object({}), {}, 'test');
        expect(result).toEqual({});
      });

      it('should return default for empty string', () => {
        const result = safeJsonParse('', z.boolean(), false, 'test');
        expect(result).toBe(false);
      });

      it('should return default for whitespace-only string', () => {
        const result = safeJsonParse('   ', z.number(), 0, 'test');
        expect(result).toBe(0);
      });
    });

    describe('context parameter', () => {
      it('should work without context', () => {
        const result = safeJsonParse('true', z.boolean(), false);
        expect(result).toBe(true);
      });

      it('should work with context for valid input', () => {
        const result = safeJsonParse('true', z.boolean(), false, 'registrationEnabled');
        expect(result).toBe(true);
      });

      it('should work with context for invalid input', () => {
        const result = safeJsonParse('invalid', z.boolean(), false, 'myConfig');
        expect(result).toBe(false);
      });
    });
  });

  describe('safeJsonParseUntyped', () => {
    it('should parse valid JSON object', () => {
      const result = safeJsonParseUntyped<{ key: string }>(
        '{"key":"value"}',
        { key: '' },
        'test'
      );
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse valid JSON array', () => {
      const result = safeJsonParseUntyped<number[]>('[1,2,3]', [], 'test');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should parse valid JSON primitive', () => {
      const result = safeJsonParseUntyped<boolean>('true', false, 'test');
      expect(result).toBe(true);
    });

    it('should return default for null input', () => {
      const result = safeJsonParseUntyped<object>(null, { default: true }, 'test');
      expect(result).toEqual({ default: true });
    });

    it('should return default for undefined input', () => {
      const result = safeJsonParseUntyped<string>(undefined, 'default', 'test');
      expect(result).toBe('default');
    });

    it('should return default for invalid JSON', () => {
      const result = safeJsonParseUntyped<object>('{invalid', { fallback: true }, 'test');
      expect(result).toEqual({ fallback: true });
    });

    it('should work without context', () => {
      const result = safeJsonParseUntyped<number>('42', 0);
      expect(result).toBe(42);
    });

    it('should handle nested objects', () => {
      const json = '{"nested":{"deep":{"value":123}}}';
      type DeepNested = { nested: { deep: { value: number } } };
      const result = safeJsonParseUntyped<DeepNested>(json, { nested: { deep: { value: 0 } } }, 'test');

      expect(result.nested.deep.value).toBe(123);
    });

    it('should handle arrays of objects', () => {
      const json = '[{"id":1},{"id":2}]';
      type Item = { id: number };
      const result = safeJsonParseUntyped<Item[]>(json, [], 'test');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });
  });

  describe('safeJsonParseSensitive', () => {
    it('returns schema-validated JSON without logging input content', () => {
      expect(safeJsonParseSensitive('{"secret":"value"}', z.json()))
        .toEqual({ secret: 'value' });
    });

    it('returns undefined for invalid syntax or schema data', () => {
      expect(safeJsonParseSensitive('{"secret":', z.json())).toBeUndefined();
      expect(safeJsonParseSensitive('42', z.object({ secret: z.string() }))).toBeUndefined();
    });
  });

  describe('SystemSettingSchemas', () => {
    it('should have boolean schema', () => {
      expect(SystemSettingSchemas.boolean).toBeDefined();

      const validResult = SystemSettingSchemas.boolean.safeParse(true);
      expect(validResult.success).toBe(true);

      const invalidResult = SystemSettingSchemas.boolean.safeParse('true');
      expect(invalidResult.success).toBe(false);
    });

    it('should have number schema', () => {
      expect(SystemSettingSchemas.number).toBeDefined();

      const validResult = SystemSettingSchemas.number.safeParse(42);
      expect(validResult.success).toBe(true);

      const invalidResult = SystemSettingSchemas.number.safeParse('42');
      expect(invalidResult.success).toBe(false);
    });

    it('should have string schema', () => {
      expect(SystemSettingSchemas.string).toBeDefined();

      const validResult = SystemSettingSchemas.string.safeParse('hello');
      expect(validResult.success).toBe(true);

      const invalidResult = SystemSettingSchemas.string.safeParse(123);
      expect(invalidResult.success).toBe(false);
    });

    it('should have stringArray schema', () => {
      expect(SystemSettingSchemas.stringArray).toBeDefined();

      const validResult = SystemSettingSchemas.stringArray.safeParse(['a', 'b']);
      expect(validResult.success).toBe(true);

      const invalidResult = SystemSettingSchemas.stringArray.safeParse([1, 2]);
      expect(invalidResult.success).toBe(false);
    });

    it('should have numberArray schema', () => {
      expect(SystemSettingSchemas.numberArray).toBeDefined();

      const validResult = SystemSettingSchemas.numberArray.safeParse([1, 2, 3]);
      expect(validResult.success).toBe(true);

      const invalidResult = SystemSettingSchemas.numberArray.safeParse(['a', 'b']);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('integration with SystemSettingSchemas', () => {
    it('should parse boolean setting', () => {
      const result = safeJsonParse('true', SystemSettingSchemas.boolean, false, 'registrationEnabled');
      expect(result).toBe(true);
    });

    it('should parse number setting', () => {
      const result = safeJsonParse('1000', SystemSettingSchemas.number, 0, 'maxUploadSize');
      expect(result).toBe(1000);
    });

    it('should parse string setting', () => {
      const result = safeJsonParse('"custom"', SystemSettingSchemas.string, 'default', 'siteName');
      expect(result).toBe('custom');
    });

    it('should parse stringArray setting', () => {
      const result = safeJsonParse(
        '["admin","user"]',
        SystemSettingSchemas.stringArray,
        [],
        'allowedRoles'
      );
      expect(result).toEqual(['admin', 'user']);
    });

    it('should parse numberArray setting', () => {
      const result = safeJsonParse(
        '[1,3,6]',
        SystemSettingSchemas.numberArray,
        [],
        'confirmationMilestones'
      );
      expect(result).toEqual([1, 3, 6]);
    });
  });
});
