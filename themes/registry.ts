/**
 * Theme Registry
 *
 * Central registry for all available themes. Themes can be registered
 * dynamically, making it easy to add new themes without modifying core code.
 */

import type { ThemeDefinition, ThemeMetadata, BackgroundPattern, ThemeColors } from './types';
import { createLogger } from '../utils/logger';
import { getCurrentSeason, getSeasonalColors, getSeasonName, getSeasonalBackground, type Season } from './seasonal';

const log = createLogger('ThemeRegistry');

/**
 * Contrast adjustment utilities
 * These functions modify background colors to increase/decrease contrast
 */

/**
 * Parse a hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Convert RGB to hex
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Adjust color lightness for contrast
 * For dark mode: negative adjustment = darker backgrounds (more contrast)
 * For light mode: positive adjustment = lighter backgrounds (more contrast)
 *
 * @param hex - The hex color to adjust
 * @param level - Contrast level (-2 to +2)
 * @param isDark - Whether we're in dark mode
 * @param shade - The shade level (50-950) to determine adjustment direction
 */
function adjustColorContrast(
  hex: string,
  level: number,
  isDark: boolean,
  shade: number
): string {
  const rgb = hexToRgb(hex);
  if (!rgb || level === 0) return hex;

  // Calculate adjustment factor (each level = 8% adjustment)
  const factor = level * 0.08;

  // Determine if this shade should get lighter or darker based on mode and shade
  // In dark mode: lower shades (50-400) are text colors, higher (500-950) are backgrounds
  // In light mode: lower shades (50-400) are backgrounds, higher (500-950) are text colors

  let adjustment: number;

  if (isDark) {
    // Dark mode: make high shades (backgrounds) darker for higher contrast
    // shade 950 is main background, make it darker with positive contrast
    if (shade >= 800) {
      adjustment = -factor * 255; // Darker backgrounds
    } else if (shade >= 600) {
      adjustment = -factor * 200; // Medium adjustment for mid-tones
    } else {
      adjustment = factor * 100; // Lighter text colors (subtle)
    }
  } else {
    // Light mode: make low shades (backgrounds) lighter for higher contrast
    // shade 50 is main background, make it lighter with positive contrast
    if (shade <= 200) {
      adjustment = factor * 255; // Lighter backgrounds
    } else if (shade <= 400) {
      adjustment = factor * 150; // Medium adjustment for mid-tones
    } else {
      adjustment = -factor * 80; // Darker text colors (subtle)
    }
  }

  return rgbToHex(
    rgb.r + adjustment,
    rgb.g + adjustment,
    rgb.b + adjustment
  );
}

class ThemeRegistry {
  private themes: Map<string, ThemeDefinition> = new Map();
  private globalPatterns: Map<string, BackgroundPattern> = new Map();

  /**
   * Register a new theme
   */
  register(theme: ThemeDefinition): void {
    if (this.themes.has(theme.id)) {
      log.warn(`Theme "${theme.id}" is already registered. Overwriting.`);
    }
    this.themes.set(theme.id, theme);
  }

  /**
   * Register multiple themes at once
   */
  registerMany(themes: readonly ThemeDefinition[]): void {
    themes.forEach(theme => this.register(theme));
  }

  /**
   * Get a specific theme by ID
   */
  get(id: string): ThemeDefinition | undefined {
    return this.themes.get(id);
  }

  /**
   * Get all registered themes
   */
  getAll(): ThemeDefinition[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get theme metadata for display in UI
   */
  getAllMetadata(): ThemeMetadata[] {
    return this.getAll().map(theme => ({
      id: theme.id,
      name: theme.name,
      author: theme.author,
      description: theme.description,
      preview: {
        primaryColor: theme.colors.light.primary[500] || theme.colors.light.primary[600] || '#3B82F6',
        backgroundColor: theme.colors.light.bg[50] || theme.colors.light.bg[100] || '#FFFFFF',
      },
    }));
  }

  /**
   * Check if a theme exists
   */
  has(id: string): boolean {
    return this.themes.has(id);
  }

  /**
   * Register a global background pattern
   */
  registerPattern(pattern: BackgroundPattern): void {
    this.globalPatterns.set(pattern.id, pattern);
  }

  /**
   * Register multiple background patterns
   */
  registerPatterns(patterns: readonly BackgroundPattern[]): void {
    patterns.forEach(pattern => this.registerPattern(pattern));
  }

  /**
   * Get all available background patterns (global + theme-specific)
   */
  getAllPatterns(themeId?: string): BackgroundPattern[] {
    const patterns = Array.from(this.globalPatterns.values());

    // Add theme-specific patterns if a theme is specified
    if (themeId) {
      const theme = this.get(themeId);
      if (theme?.patterns) {
        patterns.push(...theme.patterns);
      }
    }

    return patterns;
  }

  /**
   * Get a specific pattern by ID
   */
  getPattern(id: string, themeId?: string): BackgroundPattern | undefined {
    // Check global patterns first
    const globalPattern = this.globalPatterns.get(id);
    if (globalPattern) return globalPattern;

    // Check theme-specific patterns
    if (themeId) {
      const theme = this.get(themeId);
      return theme?.patterns?.find(p => p.id === id);
    }

    return undefined;
  }

  /**
   * Apply a theme to the document
   * @param themeId - The theme ID to apply
   * @param mode - 'light' or 'dark' mode
   * @param contrastLevel - Optional contrast adjustment (-2 to +2, default 0)
   */
  applyTheme(themeId: string, mode: 'light' | 'dark', contrastLevel: number = 0): void {
    const theme = this.get(themeId);
    if (!theme) {
      log.error(`Theme "${themeId}" not found`);
      return;
    }

    // For seasonal theme, dynamically get colors based on current season
    let colors: ThemeColors;
    if (themeId === 'seasonal') {
      const season = getCurrentSeason();
      const seasonalColors = getSeasonalColors(season);
      colors = seasonalColors[mode];
      log.info(`Seasonal theme: applying ${getSeasonName(season)} colors`);
    } else {
      colors = theme.colors[mode];
    }

    const root = document.documentElement;
    const isDark = mode === 'dark';

    // Clamp contrast level to valid range
    const clampedContrast = Math.max(-2, Math.min(2, contrastLevel));

    // Apply color scale variables (bg, primary, success, warning)
    Object.entries(colors).forEach(([colorType, scale]) => {
      if (typeof scale === 'object' && scale !== null) {
        Object.entries(scale as Record<string, string>).forEach(([shade, value]) => {
          if (value) {
            // Only apply contrast adjustment to background colors
            const adjustedValue =
              colorType === 'bg' && clampedContrast !== 0
                ? adjustColorContrast(value, clampedContrast, isDark, parseInt(shade, 10))
                : value;
            root.style.setProperty(`--color-${colorType}-${shade}`, adjustedValue);
          }
        });
      }
    });

    // Store current contrast level as a CSS variable for reference
    root.style.setProperty('--contrast-level', String(clampedContrast));

    // Apply theme class to body
    document.body.className = document.body.className
      .split(' ')
      .filter(cls => !cls.startsWith('theme-'))
      .join(' ');
    document.body.classList.add(`theme-${themeId}`);
  }

  /**
   * Apply contrast adjustment to current theme
   * This re-applies the current theme with the new contrast level
   * @param contrastLevel - Contrast level (-2 to +2)
   */
  applyContrast(contrastLevel: number): void {
    // Get current theme from body class
    const themeClass = Array.from(document.body.classList).find(cls => cls.startsWith('theme-'));
    const themeId = themeClass ? themeClass.replace('theme-', '') : 'sanctuary';
    const isDark = document.documentElement.classList.contains('dark');

    this.applyTheme(themeId, isDark ? 'dark' : 'light', contrastLevel);
  }

  /**
   * Apply a background pattern to the document
   */
  applyPattern(patternId: string, themeId?: string): void {
    const pattern = this.getPattern(patternId, themeId);

    // Remove existing pattern classes
    document.body.className = document.body.className
      .split(' ')
      .filter(cls => !cls.startsWith('bg-pattern-'))
      .join(' ');

    // Add new pattern class
    document.body.classList.add(`bg-pattern-${patternId}`);

    // If pattern has custom SVG, inject it into a style element
    if (pattern && (pattern.svgLight || pattern.svgDark)) {
      this.injectPatternStyles(patternId, pattern);
    }
  }

  /**
   * Apply pattern opacity to the document
   * @param opacity - Pattern opacity value (0 to 100, default 50)
   */
  applyPatternOpacity(opacity: number): void {
    const root = document.documentElement;
    // Convert 0-100 scale to 0-1 multiplier
    // At 50 (default), multiplier is 1.0 (design opacity)
    // At 0, multiplier is 0 (invisible)
    // At 100, multiplier is 2.0 (maximum visibility)
    const clampedOpacity = Math.max(0, Math.min(100, opacity));
    const multiplier = clampedOpacity / 50;
    root.style.setProperty('--pattern-opacity', String(multiplier));
  }

  /**
   * Apply flyout surface opacity to the document
   * @param opacity - Flyout opacity value (50 to 100, default 92)
   */
  applyFlyoutOpacity(opacity: number): void {
    const root = document.documentElement;
    const clampedOpacity = Math.max(50, Math.min(100, opacity));
    root.style.setProperty('--flyout-surface-opacity', `${clampedOpacity}%`);
  }

  /**
   * Apply noise overlay opacity to the document
   * @param opacity - Noise opacity value (0 to 100, default 50)
   */
  applyNoiseOpacity(opacity: number): void {
    const root = document.documentElement;
    const clampedOpacity = Math.max(0, Math.min(100, opacity));
    const multiplier = clampedOpacity / 50;
    root.style.setProperty('--noise-opacity', String(multiplier));
  }

  /**
   * Inject pattern SVG styles into the document
   */
  private injectPatternStyles(patternId: string, pattern: BackgroundPattern): void {
    const styleId = `pattern-${patternId}`;
    let styleEl = document.getElementById(styleId);

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const lightSvg = pattern.svgLight || pattern.svgDark || '';
    const darkSvg = pattern.svgDark || pattern.svgLight || '';

    styleEl.textContent = `
      .bg-pattern-${patternId} {
        background-image: url("${lightSvg}");
      }
      .dark .bg-pattern-${patternId} {
        background-image: url("${darkSvg}");
      }
    `;
  }

  /**
   * Get the current season (for seasonal theme)
   */
  getCurrentSeason(): Season {
    return getCurrentSeason();
  }

  /**
   * Get the recommended background for the current season
   * @param userPrefs - Optional user-configured seasonal backgrounds
   */
  getSeasonalBackground(userPrefs?: { spring?: string; summer?: string; fall?: string; winter?: string }): string {
    const season = getCurrentSeason();
    // Check if user has a custom preference for this season
    if (userPrefs) {
      const userPref = userPrefs[season];
      if (userPref) {
        return userPref;
      }
    }
    // Fall back to default
    return getSeasonalBackground(season);
  }

  /**
   * Get display name for current season
   */
  getSeasonName(): string {
    return getSeasonName(getCurrentSeason());
  }

  /**
   * Get the default seasonal background for a specific season (no user override)
   */
  getDefaultSeasonalBackground(season: Season): string {
    return getSeasonalBackground(season);
  }

  /**
   * Remove all themes (useful for testing)
   */
  clear(): void {
    this.themes.clear();
    this.globalPatterns.clear();
  }
}

// Export singleton instance
export const themeRegistry = new ThemeRegistry();
