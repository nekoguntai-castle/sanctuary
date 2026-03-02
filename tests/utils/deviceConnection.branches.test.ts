import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/utils/bitcoin', () => ({
  normalizeDerivationPath: vi.fn(() => 'm'),
}));

import { normalizeDerivationPath } from '../../utils/deviceConnection';

describe('deviceConnection branch fallback', () => {
  it('returns normalized value directly when path has fewer than two segments', () => {
    expect(normalizeDerivationPath('whatever')).toBe('m');
  });
});

