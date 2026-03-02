import { describe, expect, it } from 'vitest';
import { formatModelSize } from '../../../components/AISettings/utils';

describe('AISettings utils branch coverage', () => {
  it('covers both GB and MB formatting branches', () => {
    expect(formatModelSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
    expect(formatModelSize(512 * 1024 * 1024)).toBe('512 MB');
  });
});
