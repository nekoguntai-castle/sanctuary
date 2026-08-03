/**
 * Desert Canyon Theme
 *
 * Southwestern desert inspired theme with warm terracotta and turquoise accents.
 * Earthy, adventurous aesthetic inspired by the American Southwest.
 *
 * Light mode: Warm sandstone and terracotta with turquoise river accents
 * Dark mode: Deep rust and burnt sienna with starlit desert purple
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const desertTheme: ThemeDefinition = {
  id: 'desert',
  name: 'Desert Canyon',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Warm terracotta and turquoise inspired by the Southwest',

  colors: {
    light: {
      // Background colors (Warm sandstone)
      bg: {
        50: '#fefcf8',   // Bleached sand
        100: '#fdf6eb',  // Pale sand
        200: '#f9ead5',  // Light sandstone
        300: '#f0d9b8',  // Warm sand
        400: '#d4b896',  // Desert tan
        500: '#a68a6a',  // Adobe
        600: '#7d674e',  // Dark adobe
        700: '#564638',  // Canyon shadow
        800: '#372c24',  // Deep shadow
        900: '#211a15',  // Near black
        950: '#110d0a',  // Darkest
      },

      // Primary colors (Terracotta - warm red-orange clay)
      primary: {
        50: '#fef4f0',   // Palest clay
        100: '#fde6db',  // Light terracotta
        200: '#fcc9b6',  // Soft clay
        300: '#f9a285',  // Warm clay
        400: '#f47550',  // Bright terracotta
        500: '#e85a35',  // True terracotta (main)
        600: '#c44425',  // Deep terracotta
        700: '#a33820',  // Dark clay
        800: '#863120',  // Burnt sienna
        900: '#6f2d1f',  // Deep rust
        950: '#3c140c',  // Darkest
      },

      // Success colors (Desert sage green)
      success: {
        50: '#f4f9f3',
        100: '#e5f3e3',
        200: '#cbe7c8',
        500: '#6b9e65',  // Desert sage
        600: '#528049',
        700: '#42663b',
        800: '#375332',
        900: '#2e452b',
        950: '#162515',
      },

      // Warning colors (Mesa gold/orange)
      warning: {
        50: '#fffaeb',
        100: '#fef0c7',
        200: '#fedd8a',
        500: '#e9a115',  // Mesa gold
        600: '#cc7d0c',
        700: '#a75c0e',
        800: '#884813',
        900: '#713c14',
        950: '#411e06',
      },

      // Sent colors (Turquoise - river water)
      sent: {
        50: '#effefe',
        100: '#c8fffe',
        200: '#92fcfc',
        500: '#14b8bc',  // Turquoise
        600: '#0a929a',
        700: '#0e757c',
        800: '#135d65',
        900: '#144d54',
        950: '#052e34',
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

      // Mainnet colors (Terracotta)
      mainnet: {
        50: '#fef4f0',
        100: '#fde6db',
        200: '#fcc9b6',
        300: '#f9a285',
        400: '#f47550',
        500: '#e85a35',  // Terracotta
        600: '#c44425',
        700: '#a33820',
        800: '#863120',
        900: '#6f2d1f',
        950: '#3c140c',
      },

      // Testnet colors (Turquoise river)
      testnet: {
        50: '#effefe',
        100: '#c8fffe',
        200: '#92fcfc',
        300: '#5ef3f5',
        400: '#22e1e6',
        500: '#14b8bc',  // River turquoise
        600: '#0a929a',
        700: '#0e757c',
        800: '#135d65',
        900: '#144d54',
        950: '#052e34',
      },

      // Signet colors (Sunset purple)
      signet: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        300: '#d8b4fe',
        400: '#c084fc',
        500: '#a855f7',  // Sunset purple
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },
    },

    dark: {
      // Background colors (Night desert - deep rust and purple)
      bg: {
        50: '#f9ead5',   // Light sand (for text)
        100: '#f0d9b8',  // Warm sand
        200: '#d4b896',  // Desert tan
        300: '#a68a6a',  // Adobe
        400: '#7d674e',  // Dark adobe
        500: '#564638',  // Canyon
        600: '#3d322a',  // Deep canyon
        700: '#2a231e',  // Night desert
        800: '#1c1714',  // Dark rust
        900: '#12100d',  // Night
        950: '#0a0807',  // Starless night
      },

      // Primary colors (Glowing terracotta for dark mode)
      primary: {
        50: '#3c140c',   // Deep rust shadow
        100: '#6f2d1f',  // Deep rust
        200: '#863120',  // Burnt sienna
        300: '#a33820',  // Dark clay
        400: '#c44425',  // Deep terracotta
        500: '#f47550',  // Glowing terracotta (main)
        600: '#f9a285',  // Warm glow
        700: '#fcc9b6',  // Soft glow
        800: '#fde6db',  // Light glow
        900: '#fef4f0',  // Pale glow
        950: '#fffcfa',  // Brightest
      },

      // Success colors (Bright sage for dark mode)
      success: {
        50: '#162515',
        100: '#2e452b',
        200: '#375332',
        500: '#86d47c',  // Glowing sage
        600: '#a3e29a',
        700: '#c1eeba',
        800: '#dff8db',
        900: '#f0fcee',
        950: '#f7fef6',
      },

      // Warning colors (Starlit desert gold)
      warning: {
        50: '#411e06',
        100: '#713c14',
        200: '#884813',
        500: '#fbbf24',  // Desert starlight
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fffaeb',
        950: '#fffef5',
      },

      // Sent colors (Bright turquoise - inverted)
      sent: {
        50: '#052e34',
        100: '#144d54',
        200: '#135d65',
        500: '#22e1e6',  // Glowing turquoise
        600: '#5ef3f5',
        700: '#92fcfc',
        800: '#c8fffe',
        900: '#effefe',
        950: '#f5ffff',
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

      // Mainnet colors (Glowing terracotta - inverted)
      mainnet: {
        50: '#3c140c',
        100: '#6f2d1f',
        200: '#863120',
        300: '#a33820',
        400: '#c44425',
        500: '#f47550',  // Glowing terracotta
        600: '#f9a285',
        700: '#fcc9b6',
        800: '#fde6db',
        900: '#fef4f0',
        950: '#fffcfa',
      },

      // Testnet colors (Glowing turquoise - inverted)
      testnet: {
        50: '#052e34',
        100: '#144d54',
        200: '#135d65',
        300: '#0e757c',
        400: '#0a929a',
        500: '#22e1e6',  // Glowing river
        600: '#5ef3f5',
        700: '#92fcfc',
        800: '#c8fffe',
        900: '#effefe',
        950: '#f5ffff',
      },

      // Signet colors (Sunset purple - inverted)
      signet: {
        50: '#3b0764',
        100: '#581c87',
        200: '#6b21a8',
        300: '#7e22ce',
        400: '#9333ea',
        500: '#c084fc',  // Glowing sunset
        600: '#d8b4fe',
        700: '#e9d5ff',
        800: '#f3e8ff',
        900: '#faf5ff',
        950: '#fefcff',
      },
    },
  },
};
