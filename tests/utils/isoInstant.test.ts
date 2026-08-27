import { describe, expect, it } from 'vitest';
import { parseStrictIsoInstant } from '../../src/utils/isoInstant';

describe('parseStrictIsoInstant', () => {
  it('accepts real calendar instants with UTC and numeric offsets', () => {
    expect(parseStrictIsoInstant('2024-02-29T23:59:59.123456789Z')).toBeTypeOf('number');
    expect(parseStrictIsoInstant('2026-08-26T12:00:00+14:00')).toBeTypeOf('number');
  });

  it.each([
    'not-an-instant',
    '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+99:00',
  ])('rejects invalid instant %s', (value) => {
    expect(parseStrictIsoInstant(value)).toBeNull();
  });
});
