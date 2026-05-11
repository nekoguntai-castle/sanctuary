import { describe, expect, it } from 'vitest';

import { extractErrorMessage as viaWorkspace } from '@sanctuary/shared/utils/errors';
import { extractErrorMessage as viaRelative } from '@sanctuary/shared/utils/errors';

describe('Phase C: gateway resolves @sanctuary/shared via workspace', () => {
  it('workspace import is callable as a function', () => {
    expect(typeof viaWorkspace).toBe('function');
  });

  it('produces the same output as the relative-path import for matching inputs', () => {
    const cases: unknown[] = [
      new Error('phase-C-smoke'),
      'plain string',
      { message: 'object with message' },
      undefined,
      null,
      42,
    ];
    for (const input of cases) {
      expect(viaWorkspace(input)).toBe(viaRelative(input));
    }
  });
});
