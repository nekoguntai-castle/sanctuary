import { describe, expect, it } from 'vitest';
import { safeJsonParse } from '../../src/utils/safeJson';

describe('safeJsonParse', () => {
  it.each(['null', '0', 'false', '""', '[]', '{}'])(
    'preserves valid JSON %s without imposing a domain schema', text => {
      expect(safeJsonParse(text)).toEqual({ success: true, data: JSON.parse(text) });
    },
  );

  it('discards malformed input and syntax-error details', () => {
    expect(safeJsonParse('PRIVATE_BACKUP_SECRET')).toEqual({ success: false });
    expect(safeJsonParse('')).toEqual({ success: false });
  });
});
