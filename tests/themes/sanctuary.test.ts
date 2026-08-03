import { describe, expect, it } from 'vitest';

import { sanctuaryTheme } from '../../src/themes/sanctuary';

describe('sanctuary theme', () => {
  it('uses zen gold for primary action colors', () => {
    expect(sanctuaryTheme.colors.light.primary[600]).toBe('#96723e');
    expect(sanctuaryTheme.colors.light.primary[700]).toBe('#795932');
    expect(sanctuaryTheme.colors.dark.primary[200]).toBe('#644a2d');
    expect(sanctuaryTheme.colors.dark.primary[300]).toBe('#795932');
  });
});
