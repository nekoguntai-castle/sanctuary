import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeDefinition } from '../../themes/types';

const { mockLogWarn, mockLogError, mockGetCurrentSeason, mockGetSeasonalColors, mockGetSeasonName, mockGetSeasonalBackground } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockGetCurrentSeason: vi.fn(() => 'spring'),
  mockGetSeasonalColors: vi.fn(() => ({
    light: {
      bg: { 50: '#f5f5f5', 100: '#ececec' },
      primary: { 500: '#3366aa' },
      success: { 500: '#00aa66' },
      warning: { 500: '#ff9900' },
    },
    dark: {
      bg: { 800: '#222222', 900: '#111111' },
      primary: { 500: '#6699cc' },
      success: { 500: '#44cc88' },
      warning: { 500: '#ffbb55' },
    },
  })),
  mockGetSeasonName: vi.fn(() => 'Spring'),
  mockGetSeasonalBackground: vi.fn((season: string) => `bg-${season}`),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

vi.mock('../../themes/seasonal', () => ({
  getCurrentSeason: (...args: unknown[]) => mockGetCurrentSeason(...args),
  getSeasonalColors: (...args: unknown[]) => mockGetSeasonalColors(...args),
  getSeasonName: (...args: unknown[]) => mockGetSeasonName(...args),
  getSeasonalBackground: (...args: unknown[]) => mockGetSeasonalBackground(...args),
}));

import { themeRegistry } from '../../themes/registry';

function createRegistry() {
  return new ((themeRegistry as any).constructor)();
}

function createTheme(id: string, overrides: Partial<ThemeDefinition> = {}): ThemeDefinition {
  return {
    id,
    name: `${id} theme`,
    author: 'test',
    description: `${id} description`,
    colors: {
      light: {
        bg: { 50: '#f8f8f8', 100: '#efefef' },
        primary: { 500: '#336699', 600: '#2b5b88' },
        success: { 500: '#22aa66' },
        warning: { 500: '#ffaa33' },
      },
      dark: {
        bg: { 700: '#333333', 800: '#222222', 900: '#111111' },
        primary: { 500: '#6699cc' },
        success: { 500: '#33cc88' },
        warning: { 500: '#ffbb55' },
      },
    },
    ...overrides,
  };
}

describe('ThemeRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.className = '';
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
    document.head.querySelectorAll('[id^=\"pattern-\"]').forEach((el) => el.remove());
  });

  it('registers themes, warns on duplicate IDs, and exposes metadata', () => {
    const registry = createRegistry();
    const fallbackTheme = createTheme('fallback-preview', {
      colors: {
        light: {
          bg: { 100: '#dddddd' },
          primary: { 600: '#123456' },
          success: { 500: '#22aa66' },
          warning: { 500: '#ffaa33' },
        },
        dark: {
          bg: { 900: '#111111' },
          primary: { 500: '#6699cc' },
          success: { 500: '#33cc88' },
          warning: { 500: '#ffbb55' },
        },
      },
    });

    registry.register(fallbackTheme);
    registry.register(fallbackTheme);
    registry.registerMany([createTheme('second')]);

    expect(registry.has('fallback-preview')).toBe(true);
    expect(registry.get('second')?.id).toBe('second');
    expect(registry.getAll().length).toBe(2);
    expect(mockLogWarn).toHaveBeenCalled();

    const metadata = registry.getAllMetadata().find(t => t.id === 'fallback-preview');
    expect(metadata?.preview?.primaryColor).toBe('#123456');
    expect(metadata?.preview?.backgroundColor).toBe('#dddddd');
  });

  it('manages global and theme-specific background patterns', () => {
    const registry = createRegistry();
    registry.register(createTheme('pattern-theme', {
      patterns: [{ id: 'theme-stars', name: 'Theme Stars' }],
    }));
    registry.registerPattern({ id: 'global-none', name: 'None' });
    registry.registerPatterns([{ id: 'global-grid', name: 'Grid' }]);

    expect(registry.getAllPatterns().map(p => p.id)).toEqual(['global-none', 'global-grid']);
    expect(registry.getAllPatterns('pattern-theme').map(p => p.id)).toEqual([
      'global-none',
      'global-grid',
      'theme-stars',
    ]);
    expect(registry.getPattern('global-grid')?.name).toBe('Grid');
    expect(registry.getPattern('theme-stars', 'pattern-theme')?.name).toBe('Theme Stars');
    expect(registry.getPattern('missing')).toBeUndefined();
  });

  it('applies themes with contrast, seasonal mode, and applyContrast re-application', () => {
    const registry = createRegistry();
    registry.register(createTheme('contrast'));
    registry.register(createTheme('invalid-bg', {
      colors: {
        light: {
          bg: { 50: 'not-a-hex' },
          primary: { 500: '#336699' },
          success: { 500: '#22aa66' },
          warning: { 500: '#ffaa33' },
        },
        dark: {
          bg: { 900: '#111111' },
          primary: { 500: '#6699cc' },
          success: { 500: '#33cc88' },
          warning: { 500: '#ffbb55' },
        },
      },
    }));
    registry.register(createTheme('seasonal'));

    document.body.className = 'foo theme-old';
    registry.applyTheme('contrast', 'light', 2);
    expect(document.body.classList.contains('theme-contrast')).toBe(true);
    expect(document.body.classList.contains('theme-old')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--contrast-level')).toBe('2');
    expect(document.documentElement.style.getPropertyValue('--color-bg-50')).not.toBe('');

    registry.applyTheme('invalid-bg', 'light', 2);
    expect(document.documentElement.style.getPropertyValue('--color-bg-50')).toBe('not-a-hex');

    registry.applyTheme('seasonal', 'dark');
    expect(mockGetCurrentSeason).toHaveBeenCalled();
    expect(mockGetSeasonalColors).toHaveBeenCalled();

    document.body.className = 'theme-contrast';
    document.documentElement.classList.add('dark');
    const applyThemeSpy = vi.spyOn(registry, 'applyTheme');
    registry.applyContrast(1);
    expect(applyThemeSpy).toHaveBeenCalledWith('contrast', 'dark', 1);

    registry.applyTheme('missing-theme', 'light');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('applies patterns, injects SVG styles, and clamps pattern opacity', () => {
    const registry = createRegistry();
    registry.registerPattern({
      id: 'constellation',
      name: 'Constellation',
      svgLight: '<svg id=\"light\"></svg>',
      svgDark: '<svg id=\"dark\"></svg>',
    });
    registry.registerPattern({ id: 'none', name: 'None' });

    document.body.className = 'foo bg-pattern-old';
    registry.applyPattern('constellation');
    expect(document.body.classList.contains('bg-pattern-constellation')).toBe(true);
    expect(document.body.classList.contains('bg-pattern-old')).toBe(false);

    const styleEl = document.getElementById('pattern-constellation');
    expect(styleEl?.textContent).toContain('.bg-pattern-constellation');
    expect(styleEl?.textContent).toContain('light');
    expect(styleEl?.textContent).toContain('dark');

    registry.applyPattern('none');
    expect(document.body.classList.contains('bg-pattern-none')).toBe(true);

    registry.applyPatternOpacity(-10);
    expect(document.documentElement.style.getPropertyValue('--pattern-opacity')).toBe('0');
    registry.applyPatternOpacity(50);
    expect(document.documentElement.style.getPropertyValue('--pattern-opacity')).toBe('1');
    registry.applyPatternOpacity(120);
    expect(document.documentElement.style.getPropertyValue('--pattern-opacity')).toBe('2');
  });

  it('exposes seasonal helper methods and clear()', () => {
    const registry = createRegistry();
    registry.register(createTheme('to-clear'));
    registry.registerPattern({ id: 'p-clear', name: 'P' });

    expect(registry.getCurrentSeason()).toBe('spring');
    expect(registry.getSeasonName()).toBe('Spring');
    expect(registry.getDefaultSeasonalBackground('winter' as any)).toBe('bg-winter');
    expect(
      registry.getSeasonalBackground({
        spring: 'custom-spring',
      })
    ).toBe('custom-spring');
    expect(registry.getSeasonalBackground()).toBe('bg-spring');

    registry.clear();
    expect(registry.getAll()).toEqual([]);
    expect(registry.getAllPatterns()).toEqual([]);
  });

  it('covers remaining contrast, metadata, pattern fallback, and seasonal preference branches', () => {
    const registry = createRegistry();

    registry.register(createTheme('sanctuary'));

    registry.register(createTheme('metadata-defaults', {
      colors: {
        light: {
          bg: {},
          primary: {},
          success: { 500: '#22aa66' },
          warning: { 500: '#ffaa33' },
        },
        dark: {
          bg: { 900: '#111111' },
          primary: { 500: '#6699cc' },
          success: { 500: '#33cc88' },
          warning: { 500: '#ffbb55' },
        },
      } as any,
    }));

    const metadata = registry.getAllMetadata().find(theme => theme.id === 'metadata-defaults');
    expect(metadata?.preview.primaryColor).toBe('#3B82F6');
    expect(metadata?.preview.backgroundColor).toBe('#FFFFFF');

    const contrastTheme = createTheme('contrast-branches') as any;
    contrastTheme.colors.light.bg = {
      50: '#fefefe',
      150: '',       // Covers empty value branch in applyTheme
      300: '#cccccc', // Covers light mode 201-400 branch
      500: '#999999', // Covers light mode >400 branch
    };
    contrastTheme.colors.light.accent = null; // Covers non-object/null scale branch
    contrastTheme.colors.dark.bg = {
      500: '#444444', // Covers dark mode <600 branch
      700: '#333333', // Covers dark mode 600-799 branch
      900: '#111111', // Covers dark mode >=800 branch
    };
    contrastTheme.colors.dark.accent = null;
    registry.register(contrastTheme as ThemeDefinition);

    registry.applyTheme('contrast-branches', 'light', 1);
    registry.applyTheme('contrast-branches', 'dark', 1);
    expect(document.documentElement.style.getPropertyValue('--color-bg-300')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-bg-500')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--color-bg-700')).not.toBe('');

    registry.register(createTheme('no-patterns'));
    registry.registerPattern({ id: 'g-only', name: 'Global Only' });
    expect(registry.getAllPatterns('no-patterns').map(p => p.id)).toContain('g-only');

    registry.registerPattern({ id: 'dark-only', name: 'Dark only', svgDark: '<svg id=\"dark-only\"></svg>' });
    registry.registerPattern({ id: 'light-only', name: 'Light only', svgLight: '<svg id=\"light-only\"></svg>' });

    registry.applyPattern('dark-only');
    const darkOnlyStyleFirst = document.getElementById('pattern-dark-only');
    expect(darkOnlyStyleFirst?.textContent).toContain('dark-only');

    // Re-applying should reuse the existing style element
    registry.applyPattern('dark-only');
    const darkOnlyStyleSecond = document.getElementById('pattern-dark-only');
    expect(darkOnlyStyleSecond).toBe(darkOnlyStyleFirst);

    registry.applyPattern('light-only');
    const lightOnlyStyle = document.getElementById('pattern-light-only');
    expect(lightOnlyStyle?.textContent).toContain('light-only');

    (registry as any).injectPatternStyles('no-svg', { id: 'no-svg', name: 'No SVG fallback' });
    const noSvgStyle = document.getElementById('pattern-no-svg');
    expect(noSvgStyle?.textContent).toContain('url(\"\")');

    document.body.className = 'foo';
    document.documentElement.classList.remove('dark');
    const applyThemeSpy = vi.spyOn(registry, 'applyTheme');
    registry.applyContrast(-1);
    expect(applyThemeSpy).toHaveBeenCalledWith('sanctuary', 'light', -1);

    expect(registry.getSeasonalBackground({ summer: 'custom-summer' })).toBe('bg-spring');
  });
});
