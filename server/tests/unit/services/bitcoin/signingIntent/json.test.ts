import { describe, expect, it } from 'vitest';
import { toPrismaInputJson } from '../../../../../src/services/bitcoin/signingIntent/json';

describe('toPrismaInputJson', () => {
  it('preserves JSON primitives and nested null values', () => {
    expect(toPrismaInputJson({
      label: 'intent',
      accepted: true,
      amount: 42,
      note: null,
      nested: [null, { script: '0014abcd' }],
    })).toEqual({
      label: 'intent',
      accepted: true,
      amount: 42,
      note: null,
      nested: [null, { script: '0014abcd' }],
    });
  });

  it('omits undefined object fields', () => {
    expect(toPrismaInputJson({ kept: 1, omitted: undefined })).toEqual({ kept: 1 });
  });

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['symbol', Symbol('evidence')],
    ['function', () => undefined],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['date', new Date('2026-01-01T00:00:00.000Z')],
    ['buffer', Buffer.from('evidence')],
    ['undefined array item', [undefined]],
  ])('rejects unsupported %s evidence', (_label, value) => {
    expect(() => toPrismaInputJson(value)).toThrow(
      'Signing evidence contains a value that cannot be stored as JSON'
    );
  });
});
