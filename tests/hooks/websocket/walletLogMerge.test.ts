import { describe, expect, it } from 'vitest';
import {
  mergeWalletLogEntries,
  normalizeWalletLogMaxEntries,
} from '../../../src/hooks/websocket/walletLogMerge';

const entry = (id: string, timestamp: string) => ({ id, timestamp });

describe('walletLogMerge', () => {
  it.each([
    [undefined, 500],
    [-1, 500],
    [Number.NaN, 500],
    [Number.POSITIVE_INFINITY, 500],
    [0, 0],
    [1, 1],
    [2.9, 2],
    [501, 500],
  ])('normalizes cap %s to %s', (input, expected) => {
    expect(normalizeWalletLogMaxEntries(input)).toBe(expected);
  });

  it('orders valid ISO rows by time and id, then keeps malformed rows stable', () => {
    expect(mergeWalletLogEntries(
      [
        entry('malformed-first', 'not-a-date'),
        entry('same-b', '2026-08-26T10:00:00.000Z'),
      ],
      [
        entry('same-a', '2026-08-26T10:00:00Z'),
        entry('earlier', '2026-08-26T09:00:00-01:00'),
        entry('malformed-second', 'still-not-a-date'),
        entry('invalid-calendar', '2026-02-30T10:00:00Z'),
      ],
      500,
    ).map(item => item.id)).toEqual([
      'earlier',
      'same-a',
      'same-b',
      'malformed-first',
      'malformed-second',
      'invalid-calendar',
    ]);
  });

  it('keeps the first row for duplicate ids and caps the committed list', () => {
    const live = entry('duplicate', '2026-08-26T10:00:00Z');
    const history = entry('duplicate', '2026-08-26T09:00:00Z');

    expect(mergeWalletLogEntries(
      [live, entry('old', '2026-08-26T08:00:00Z')],
      [history, entry('new', '2026-08-26T11:00:00Z')],
      2,
    )).toEqual([live, entry('new', '2026-08-26T11:00:00Z')]);
    expect(mergeWalletLogEntries([live], [], 0)).toEqual([]);
  });
});
