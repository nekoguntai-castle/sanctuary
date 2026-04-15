/** Dynamic seasonal theme colors and recommended backgrounds. */

import type { ThemeDefinition, ThemeColors } from '../types';

// ============================================================================
// SEASON DETECTION
// ============================================================================

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

/**
 * Detect the current season based on the date
 * Uses meteorological seasons (more intuitive than astronomical)
 *
 * Northern Hemisphere:
 * - Spring: March 1 - May 31
 * - Summer: June 1 - August 31
 * - Fall: September 1 - November 30
 * - Winter: December 1 - February 28/29
 */
export function getCurrentSeason(date: Date = new Date(), hemisphere: 'north' | 'south' = 'north'): Season {
  const month = date.getMonth(); // 0-11

  let season: Season;

  // Northern hemisphere seasons
  if (month >= 2 && month <= 4) {
    season = 'spring';
  } else if (month >= 5 && month <= 7) {
    season = 'summer';
  } else if (month >= 8 && month <= 10) {
    season = 'fall';
  } else {
    season = 'winter';
  }

  // Flip for southern hemisphere
  if (hemisphere === 'south') {
    const opposites: Record<Season, Season> = {
      spring: 'fall',
      summer: 'winter',
      fall: 'spring',
      winter: 'summer',
    };
    season = opposites[season];
  }

  return season;
}

/**
 * Get the recommended animated background pattern for the current season
 */
export function getSeasonalBackground(season: Season): string {
  const backgrounds: Record<Season, string> = {
    spring: 'sakura-petals',
    summer: 'fireflies',
    fall: 'falling-leaves',
    winter: 'snowfall',
  };
  return backgrounds[season];
}

/**
 * Get season display name
 */
export function getSeasonName(season: Season): string {
  const names: Record<Season, string> = {
    spring: 'Spring',
    summer: 'Summer',
    fall: 'Autumn',
    winter: 'Winter',
  };
  return names[season];
}

// ============================================================================
// SEASONAL COLOR PALETTES
// ============================================================================

const springColors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    // Background: Soft cherry blossom whites and creams
    bg: {
      50: '#fefcfd',   // Pure petal white
      100: '#fdf8f9',  // Blush white
      200: '#faf0f2',  // Soft pink tint
      300: '#f5e4e8',  // Pale sakura
      400: '#e8cdd4',  // Dusty rose
      500: '#c4a3ac',  // Muted mauve
      600: '#9a7a83',  // Faded bloom
      700: '#6b5459',  // Dark petal
      800: '#3d3133',  // Deep shadow
      900: '#221c1d',  // Night
      950: '#110e0e',
    },
    // Primary: Fresh cherry blossom pink
    primary: {
      50: '#fef5f7',
      100: '#fee8ed',
      200: '#fdd5de',
      300: '#fbb3c4',
      400: '#f784a0',
      500: '#ed5a7d',   // Cherry blossom
      600: '#d93a60',
      700: '#b72a4c',
      800: '#982742',
      900: '#80253c',
      950: '#470f1d',
    },
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',   // Fresh spring green
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    warning: {
      50: '#fefce8',
      100: '#fef9c3',
      200: '#fef08a',
      500: '#eab308',   // Spring sunshine
      600: '#ca8a04',
      700: '#a16207',
      800: '#854d0e',
    },
    sent: {
      50: '#faf5ff',
      100: '#f3e8ff',
      200: '#e9d5ff',
      500: '#a855f7',
      600: '#9333ea',
      700: '#7e22ce',
      800: '#6b21a8',
    },
    mainnet: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    testnet: {
      50: '#fefce8',
      100: '#fef9c3',
      200: '#fef08a',
      500: '#eab308',
      600: '#ca8a04',
      700: '#a16207',
      800: '#854d0e',
    },
    signet: {
      50: '#fdf4ff',
      100: '#fae8ff',
      200: '#f5d0fe',
      500: '#d946ef',
      600: '#c026d3',
      700: '#a21caf',
      800: '#86198f',
    },
  },
  dark: {
    // Background: Deep twilight with cherry blossom hints
    bg: {
      50: '#f5e8ec',
      100: '#e8d4da',
      200: '#d4b8c0',
      300: '#b8949e',
      400: '#8a6b74',
      500: '#5c464d',
      600: '#3d2f33',
      700: '#2a2024',
      800: '#1a1517',
      900: '#110f10',
      950: '#0a0809',
    },
    primary: {
      50: '#3d1a24',
      100: '#5c2436',
      200: '#8a3450',
      300: '#b8446a',
      400: '#e05a88',
      500: '#f784a0',   // Bright petal
      600: '#faa0b8',
      700: '#fbbcce',
      800: '#fdd5de',
      900: '#fee8ed',
      950: '#fef5f7',
    },
    success: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    warning: {
      50: '#422006',
      100: '#854d0e',
      200: '#a16207',
      500: '#facc15',
      600: '#fde047',
      700: '#fef08a',
      800: '#fef9c3',
    },
    sent: {
      50: '#3b0764',
      100: '#581c87',
      200: '#6b21a8',
      500: '#c084fc',
      600: '#d8b4fe',
      700: '#e9d5ff',
      800: '#f3e8ff',
    },
    mainnet: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    testnet: {
      50: '#422006',
      100: '#854d0e',
      200: '#a16207',
      500: '#facc15',
      600: '#fde047',
      700: '#fef08a',
      800: '#fef9c3',
    },
    signet: {
      50: '#4a044e',
      100: '#701a75',
      200: '#86198f',
      500: '#e879f9',
      600: '#f0abfc',
      700: '#f5d0fe',
      800: '#fae8ff',
    },
  },
};

const summerColors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    // Background: Warm sunny whites and golden creams
    bg: {
      50: '#fffefb',   // Bright sunlight
      100: '#fefcf3',  // Warm white
      200: '#fdf8e6',  // Cream
      300: '#faf0cc',  // Pale gold
      400: '#f0dda0',  // Sandy
      500: '#d4bc70',  // Wheat
      600: '#a8924a',  // Golden brown
      700: '#6b5c30',  // Dark amber
      800: '#3d341c',  // Deep shadow
      900: '#221d10',
      950: '#110f08',
    },
    // Primary: Ocean blue
    primary: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',   // Sky blue
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c4a6e',
      950: '#082f49',
    },
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    warning: {
      50: '#fff7ed',
      100: '#ffedd5',
      200: '#fed7aa',
      500: '#f97316',   // Sunset orange
      600: '#ea580c',
      700: '#c2410c',
      800: '#9a3412',
    },
    sent: {
      50: '#fdf4ff',
      100: '#fae8ff',
      200: '#f5d0fe',
      500: '#d946ef',
      600: '#c026d3',
      700: '#a21caf',
      800: '#86198f',
    },
    mainnet: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    testnet: {
      50: '#fff7ed',
      100: '#ffedd5',
      200: '#fed7aa',
      500: '#f97316',
      600: '#ea580c',
      700: '#c2410c',
      800: '#9a3412',
    },
    signet: {
      50: '#fdf4ff',
      100: '#fae8ff',
      200: '#f5d0fe',
      500: '#d946ef',
      600: '#c026d3',
      700: '#a21caf',
      800: '#86198f',
    },
  },
  dark: {
    // Background: Warm evening sky, deep blues
    bg: {
      50: '#e8eff5',
      100: '#d0dfea',
      200: '#a8c4d8',
      300: '#7aa4c0',
      400: '#4c7da0',
      500: '#345878',
      600: '#263f54',
      700: '#1a2a38',
      800: '#101a22',
      900: '#0a1015',
      950: '#05080a',
    },
    primary: {
      50: '#082f49',
      100: '#0c4a6e',
      200: '#075985',
      300: '#0369a1',
      400: '#0284c7',
      500: '#0ea5e9',
      600: '#38bdf8',
      700: '#7dd3fc',
      800: '#bae6fd',
      900: '#e0f2fe',
      950: '#f0f9ff',
    },
    success: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    warning: {
      50: '#431407',
      100: '#7c2d12',
      200: '#9a3412',
      500: '#fb923c',
      600: '#fdba74',
      700: '#fed7aa',
      800: '#ffedd5',
    },
    sent: {
      50: '#4a044e',
      100: '#701a75',
      200: '#86198f',
      500: '#e879f9',
      600: '#f0abfc',
      700: '#f5d0fe',
      800: '#fae8ff',
    },
    mainnet: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    testnet: {
      50: '#431407',
      100: '#7c2d12',
      200: '#9a3412',
      500: '#fb923c',
      600: '#fdba74',
      700: '#fed7aa',
      800: '#ffedd5',
    },
    signet: {
      50: '#4a044e',
      100: '#701a75',
      200: '#86198f',
      500: '#e879f9',
      600: '#f0abfc',
      700: '#f5d0fe',
      800: '#fae8ff',
    },
  },
};

const fallColors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    // Background: Warm autumn creams and tans
    bg: {
      50: '#fdfcfa',
      100: '#faf6f0',
      200: '#f5ede0',
      300: '#ebe0cc',
      400: '#d8c8a8',
      500: '#b8a078',
      600: '#8c7850',
      700: '#5c4c32',
      800: '#352c1c',
      900: '#1e1810',
      950: '#0f0c08',
    },
    // Primary: Rich burnt orange / amber
    primary: {
      50: '#fff7ed',
      100: '#ffedd5',
      200: '#fed7aa',
      300: '#fdba74',
      400: '#fb923c',
      500: '#f97316',   // Autumn orange
      600: '#ea580c',
      700: '#c2410c',
      800: '#9a3412',
      900: '#7c2d12',
      950: '#431407',
    },
    success: {
      50: '#f7fee7',
      100: '#ecfccb',
      200: '#d9f99d',
      500: '#84cc16',   // Olive green
      600: '#65a30d',
      700: '#4d7c0f',
      800: '#3f6212',
    },
    warning: {
      50: '#fef3c7',
      100: '#fde68a',
      200: '#fcd34d',
      500: '#d97706',   // Deep amber
      600: '#b45309',
      700: '#92400e',
      800: '#78350f',
    },
    sent: {
      50: '#fdf2f8',
      100: '#fce7f3',
      200: '#fbcfe8',
      500: '#ec4899',   // Berry pink
      600: '#db2777',
      700: '#be185d',
      800: '#9d174d',
    },
    mainnet: {
      50: '#f7fee7',
      100: '#ecfccb',
      200: '#d9f99d',
      500: '#84cc16',
      600: '#65a30d',
      700: '#4d7c0f',
      800: '#3f6212',
    },
    testnet: {
      50: '#fef3c7',
      100: '#fde68a',
      200: '#fcd34d',
      500: '#d97706',
      600: '#b45309',
      700: '#92400e',
      800: '#78350f',
    },
    signet: {
      50: '#fdf2f8',
      100: '#fce7f3',
      200: '#fbcfe8',
      500: '#ec4899',
      600: '#db2777',
      700: '#be185d',
      800: '#9d174d',
    },
  },
  dark: {
    // Background: Deep burgundy and brown
    bg: {
      50: '#f0e8e4',
      100: '#e0d0c8',
      200: '#c8b0a0',
      300: '#a88878',
      400: '#806050',
      500: '#584038',
      600: '#3c2a24',
      700: '#281c18',
      800: '#18100e',
      900: '#0e0a08',
      950: '#060404',
    },
    primary: {
      50: '#431407',
      100: '#7c2d12',
      200: '#9a3412',
      300: '#c2410c',
      400: '#ea580c',
      500: '#f97316',
      600: '#fb923c',
      700: '#fdba74',
      800: '#fed7aa',
      900: '#ffedd5',
      950: '#fff7ed',
    },
    success: {
      50: '#1a2e05',
      100: '#365314',
      200: '#3f6212',
      500: '#a3e635',
      600: '#bef264',
      700: '#d9f99d',
      800: '#ecfccb',
    },
    warning: {
      50: '#451a03',
      100: '#78350f',
      200: '#92400e',
      500: '#f59e0b',
      600: '#fbbf24',
      700: '#fcd34d',
      800: '#fde68a',
    },
    sent: {
      50: '#500724',
      100: '#831843',
      200: '#9d174d',
      500: '#f472b6',
      600: '#f9a8d4',
      700: '#fbcfe8',
      800: '#fce7f3',
    },
    mainnet: {
      50: '#1a2e05',
      100: '#365314',
      200: '#3f6212',
      500: '#a3e635',
      600: '#bef264',
      700: '#d9f99d',
      800: '#ecfccb',
    },
    testnet: {
      50: '#451a03',
      100: '#78350f',
      200: '#92400e',
      500: '#f59e0b',
      600: '#fbbf24',
      700: '#fcd34d',
      800: '#fde68a',
    },
    signet: {
      50: '#500724',
      100: '#831843',
      200: '#9d174d',
      500: '#f472b6',
      600: '#f9a8d4',
      700: '#fbcfe8',
      800: '#fce7f3',
    },
  },
};

const winterColors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    // Background: Crisp winter whites and cool grays
    bg: {
      50: '#fafbfc',   // Fresh snow
      100: '#f4f6f8',  // Ice white
      200: '#e8ecf0',  // Frost
      300: '#d8e0e8',  // Cool mist
      400: '#b8c4d0',  // Silver
      500: '#8898a8',  // Slate
      600: '#606e7c',  // Storm gray
      700: '#404a54',  // Charcoal
      800: '#282e34',  // Dark slate
      900: '#181c20',
      950: '#0c0e10',
    },
    // Primary: Icy blue
    primary: {
      50: '#f0f9ff',
      100: '#e0f4ff',
      200: '#b8e6ff',
      300: '#7cd4ff',
      400: '#36bdff',
      500: '#0aa2f5',   // Ice blue
      600: '#0082d4',
      700: '#0068ab',
      800: '#00578d',
      900: '#064974',
      950: '#042f4d',
    },
    success: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',   // Evergreen
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    warning: {
      50: '#fefce8',
      100: '#fef9c3',
      200: '#fef08a',
      500: '#eab308',   // Winter sun
      600: '#ca8a04',
      700: '#a16207',
      800: '#854d0e',
    },
    sent: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      500: '#8b5cf6',   // Frost violet
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
    },
    mainnet: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      500: '#22c55e',
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
    },
    testnet: {
      50: '#fefce8',
      100: '#fef9c3',
      200: '#fef08a',
      500: '#eab308',
      600: '#ca8a04',
      700: '#a16207',
      800: '#854d0e',
    },
    signet: {
      50: '#f5f3ff',
      100: '#ede9fe',
      200: '#ddd6fe',
      500: '#8b5cf6',
      600: '#7c3aed',
      700: '#6d28d9',
      800: '#5b21b6',
    },
  },
  dark: {
    // Background: Deep midnight blue / arctic night
    bg: {
      50: '#e4e8ec',
      100: '#c8d0d8',
      200: '#a0acb8',
      300: '#788898',
      400: '#506070',
      500: '#384450',
      600: '#282f38',
      700: '#1c2128',
      800: '#12161a',
      900: '#0a0c0e',
      950: '#040506',
    },
    primary: {
      50: '#042f4d',
      100: '#064974',
      200: '#00578d',
      300: '#0068ab',
      400: '#0082d4',
      500: '#0aa2f5',
      600: '#36bdff',
      700: '#7cd4ff',
      800: '#b8e6ff',
      900: '#e0f4ff',
      950: '#f0f9ff',
    },
    success: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    warning: {
      50: '#422006',
      100: '#854d0e',
      200: '#a16207',
      500: '#facc15',
      600: '#fde047',
      700: '#fef08a',
      800: '#fef9c3',
    },
    sent: {
      50: '#2e1065',
      100: '#4c1d95',
      200: '#5b21b6',
      500: '#a78bfa',
      600: '#c4b5fd',
      700: '#ddd6fe',
      800: '#ede9fe',
    },
    mainnet: {
      50: '#14532d',
      100: '#166534',
      200: '#15803d',
      500: '#4ade80',
      600: '#86efac',
      700: '#bbf7d0',
      800: '#dcfce7',
    },
    testnet: {
      50: '#422006',
      100: '#854d0e',
      200: '#a16207',
      500: '#facc15',
      600: '#fde047',
      700: '#fef08a',
      800: '#fef9c3',
    },
    signet: {
      50: '#2e1065',
      100: '#4c1d95',
      200: '#5b21b6',
      500: '#a78bfa',
      600: '#c4b5fd',
      700: '#ddd6fe',
      800: '#ede9fe',
    },
  },
};

// Map of all seasonal palettes
export const seasonalPalettes: Record<Season, { light: ThemeColors; dark: ThemeColors }> = {
  spring: springColors,
  summer: summerColors,
  fall: fallColors,
  winter: winterColors,
};

/**
 * Get the theme colors for a specific season
 */
export function getSeasonalColors(season: Season): { light: ThemeColors; dark: ThemeColors } {
  return seasonalPalettes[season];
}

// ============================================================================
// THEME DEFINITION
// ============================================================================

// Get current season for the default theme export
const currentSeason = getCurrentSeason();
const currentColors = getSeasonalColors(currentSeason);

export const seasonalTheme: ThemeDefinition = {
  id: 'seasonal',
  name: 'Seasonal',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: `Dynamic theme that changes with the seasons. Currently: ${getSeasonName(currentSeason)}`,
  colors: currentColors,
};
