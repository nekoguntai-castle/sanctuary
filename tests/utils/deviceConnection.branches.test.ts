import { describe,expect,it,vi } from 'vitest';

vi.mock('@sanctuary/shared/utils/bitcoin', () => ({
  normalizeDerivationPath: vi.fn(() => 'm'),
}));

import { normalizeDerivationPath } from '../../src/utils/deviceConnection';

describe('deviceConnection branch fallback', () => {
  it('returns normalized value directly when path has fewer than two segments', () => {
    expect(normalizeDerivationPath('whatever')).toBe('m');
  });
});

