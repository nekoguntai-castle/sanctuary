/**
 * Bamboo Zen Theme
 *
 * Japanese zen garden inspired theme with natural bamboo greens and stone grays.
 * Balanced, peaceful aesthetic perfect for focused work.
 *
 * Light mode: Natural cream and soft bamboo green with warm stone accents
 * Dark mode: Deep forest shadows with jade green and warm lantern accents
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const bambooTheme: ThemeDefinition = {
  id: 'bamboo',
  name: 'Bamboo Zen',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Peaceful zen garden with bamboo greens and stone grays',

  colors: {
    light: {
      // Background colors (Natural cream/stone - tatami and sand)
      bg: {
        50: '#fdfcf9',   // Rice paper white
        100: '#f8f6f0',  // Warm cream
        200: '#f0ebe0',  // Pale sand
        300: '#e2dacb',  // Light stone
        400: '#c4b9a4',  // Weathered bamboo
        500: '#8a8272',  // Stone gray
        600: '#6b6355',  // Dark stone
        700: '#4a4438',  // Shadow
        800: '#2e2a22',  // Deep shadow
        900: '#1a1814',  // Near black
        950: '#0d0c0a',  // Darkest
      },

      // Primary colors (Bamboo green - fresh and natural)
      primary: {
        50: '#f4f9f4',   // Palest bamboo
        100: '#e4f2e4',  // Light bamboo
        200: '#c9e5ca',  // Soft green
        300: '#9ed0a2',  // Young bamboo
        400: '#6db574',  // Fresh bamboo
        500: '#4a9952',  // Bamboo green (main)
        600: '#3a7b42',  // Deep bamboo
        700: '#326238',  // Forest bamboo
        800: '#2c4f30',  // Dark grove
        900: '#26412a',  // Deep forest
        950: '#112314',  // Darkest
      },

      // Success colors (Jade green)
      success: {
        50: '#effef5',
        100: '#d9fde6',
        200: '#b5facd',
        500: '#22c55e',  // Jade
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
        950: '#052e16',
      },

      // Warning colors (Koi orange - warm and natural)
      warning: {
        50: '#fff8ed',
        100: '#ffeed4',
        200: '#ffd9a8',
        500: '#f59e0b',  // Koi orange
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
      },

      // Sent colors (Plum purple - traditional Japanese)
      sent: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#9333ea',  // Plum
        600: '#7e22ce',
        700: '#6b21a8',
        800: '#581c87',
        900: '#4c1d95',
        950: '#2e1065',
      },

      // Shared colors (Teal for shared wallet/device indicators)
      shared: {
        50: '#f0fdfa',
        100: '#ccfbf1',
        200: '#99f6e4',
        300: '#5eead4',
        400: '#2dd4bf',
        500: '#14b8a6',
        600: '#0d9488',
        700: '#0f766e',
        800: '#115e59',
        900: '#134e4a',
        950: '#042f2e',
      },

      // Mainnet colors (Bamboo green)
      mainnet: {
        50: '#f4f9f4',
        100: '#e4f2e4',
        200: '#c9e5ca',
        300: '#9ed0a2',
        400: '#6db574',
        500: '#4a9952',  // Bamboo green
        600: '#3a7b42',
        700: '#326238',
        800: '#2c4f30',
        900: '#26412a',
        950: '#112314',
      },

      // Testnet colors (Stone gray)
      testnet: {
        50: '#f8f8f7',
        100: '#f0efed',
        200: '#dfddd8',
        300: '#c7c3bb',
        400: '#a9a396',
        500: '#8a8272',  // Stone gray
        600: '#746c5e',
        700: '#5f584d',
        800: '#504a42',
        900: '#45403a',
        950: '#25221f',
      },

      // Signet colors (Lantern red)
      signet: {
        50: '#fef2f2',
        100: '#fee2e2',
        200: '#fecaca',
        300: '#fca5a5',
        400: '#f87171',
        500: '#dc2626',  // Lantern red
        600: '#b91c1c',
        700: '#991b1b',
        800: '#7f1d1d',
        900: '#6b1b1b',
        950: '#450a0a',
      },
    },

    dark: {
      // Background colors (Deep forest - night garden)
      bg: {
        50: '#e8e6e0',   // Pale stone (for text)
        100: '#d4d0c6',  // Light bamboo
        200: '#b8b2a4',  // Weathered
        300: '#968e7c',  // Stone
        400: '#736a5a',  // Dark stone
        500: '#544d40',  // Deep shadow
        600: '#3d3830',  // Night stone
        700: '#2a2620',  // Deep night
        800: '#1c1a16',  // Dark garden
        900: '#121110',  // Night
        950: '#0a0908',  // Deepest shadow
      },

      // Primary colors (Glowing jade for dark mode)
      primary: {
        50: '#112314',   // Deep forest
        100: '#26412a',  // Dark grove
        200: '#2c4f30',  // Shadow green
        300: '#326238',  // Forest
        400: '#3a7b42',  // Deep bamboo
        500: '#4ade80',  // Glowing jade (main)
        600: '#86efac',  // Bright jade
        700: '#bbf7d0',  // Soft glow
        800: '#dcfce7',  // Light glow
        900: '#f0fdf4',  // Pale glow
        950: '#f7fef9',  // Brightest
      },

      // Success colors (Bright jade for dark mode)
      success: {
        50: '#052e16',
        100: '#14532d',
        200: '#166534',
        500: '#4ade80',  // Glowing jade
        600: '#86efac',
        700: '#bbf7d0',
        800: '#dcfce7',
        900: '#f0fdf4',
        950: '#f7fef9',
      },

      // Warning colors (Warm lantern glow)
      warning: {
        50: '#451a03',
        100: '#78350f',
        200: '#92400e',
        500: '#fbbf24',  // Paper lantern
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fffbeb',
        950: '#fffef7',
      },

      // Sent colors (Plum - inverted)
      sent: {
        50: '#2e1065',
        100: '#4c1d95',
        200: '#581c87',
        500: '#a855f7',
        600: '#c084fc',
        700: '#d8b4fe',
        800: '#e9d5ff',
        900: '#f3e8ff',
        950: '#faf5ff',
      },

      // Shared colors (Teal - inverted for dark mode)
      shared: {
        50: '#042f2e',
        100: '#134e4a',
        200: '#115e59',
        300: '#0f766e',
        400: '#0d9488',
        500: '#14b8a6',
        600: '#2dd4bf',
        700: '#5eead4',
        800: '#99f6e4',
        900: '#ccfbf1',
        950: '#f0fdfa',
      },

      // Mainnet colors (Glowing jade - inverted)
      mainnet: {
        50: '#112314',
        100: '#26412a',
        200: '#2c4f30',
        300: '#326238',
        400: '#3a7b42',
        500: '#4ade80',  // Glowing bamboo
        600: '#86efac',
        700: '#bbf7d0',
        800: '#dcfce7',
        900: '#f0fdf4',
        950: '#f7fef9',
      },

      // Testnet colors (Moonlit stone - inverted)
      testnet: {
        50: '#25221f',
        100: '#45403a',
        200: '#504a42',
        300: '#5f584d',
        400: '#746c5e',
        500: '#a9a396',  // Moonlit stone
        600: '#c7c3bb',
        700: '#dfddd8',
        800: '#f0efed',
        900: '#f8f8f7',
        950: '#fcfcfb',
      },

      // Signet colors (Lantern red - inverted)
      signet: {
        50: '#450a0a',
        100: '#6b1b1b',
        200: '#7f1d1d',
        300: '#991b1b',
        400: '#b91c1c',
        500: '#f87171',  // Glowing lantern
        600: '#fca5a5',
        700: '#fecaca',
        800: '#fee2e2',
        900: '#fef2f2',
        950: '#fffafa',
      },
    },
  },
};
