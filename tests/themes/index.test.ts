import { describe, expect, it } from 'vitest';
import type { ThemeDefinition } from '../../themes/types';
import { getPatternIds, getThemeIds, initializeThemes, themeRegistry } from '../../themes';

function ensureSeedTheme(): void {
  if (themeRegistry.getAll().length > 0) return;

  const theme: ThemeDefinition = {
    id: 'test-theme',
    name: 'Test Theme',
    colors: {
      light: {
        bg: { 50: '#ffffff' },
        primary: { 500: '#3b82f6' },
        success: { 500: '#10b981' },
        warning: { 500: '#f59e0b' },
      },
      dark: {
        bg: { 900: '#111827' },
        primary: { 500: '#60a5fa' },
        success: { 500: '#34d399' },
        warning: { 500: '#fbbf24' },
      },
    },
  };

  themeRegistry.register(theme);
}

function ensureSeedPattern(): void {
  if (themeRegistry.getAllPatterns().length > 0) return;
  themeRegistry.registerPattern({ id: 'test-pattern', name: 'Test Pattern' });
}

describe('themes index exports', () => {
  it('initializes and exposes theme/pattern identifiers', () => {
    ensureSeedTheme();
    ensureSeedPattern();

    initializeThemes();

    const themeIds = getThemeIds();
    expect(themeIds.length).toBeGreaterThan(0);

    const patternIds = getPatternIds();
    expect(patternIds.length).toBeGreaterThan(0);

    const themeScopedPatternIds = getPatternIds(themeIds[0]);
    expect(themeScopedPatternIds.length).toBeGreaterThanOrEqual(patternIds.length);
  });
});
