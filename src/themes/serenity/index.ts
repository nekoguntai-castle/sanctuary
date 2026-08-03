/**
 * Serenity Theme
 *
 * Light mode: Tropical beach with sandy backgrounds, turquoise ocean, and palm greens
 * Dark mode: Starry night sky with deep indigo/blue backgrounds and starlight accents
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const serenityTheme: ThemeDefinition = {
  id: 'serenity',
  name: 'Serenity',
  author: 'Sanctuary Wallet Team',
  version: '1.1.0',
  description: 'Tropical beach in light mode, starry night sky in dark mode',

  colors: {
    light: {
      // Background colors (Warm tropical sand)
      bg: {
        50: '#fffdf8',   // Sun-bleached white
        100: '#fef8e8',  // Pale sand
        200: '#f5ead4',  // Warm beach sand
        300: '#e8d9b8',  // Golden sand
        400: '#c4b08a',  // Wet sand
        500: '#8a7a5c',  // Driftwood
        600: '#6b5d44',
        700: '#4d432f',
        800: '#332c1f',
        900: '#1f1a12',
        950: '#0f0d09',
      },

      // Primary colors (Tropical turquoise ocean)
      primary: {
        50: '#effffe',   // Seafoam white
        100: '#c8fffe',  // Shallow lagoon
        200: '#8ff7f5',  // Crystal clear water
        300: '#4fe8e8',  // Bright turquoise
        400: '#22d3d8',  // Tropical lagoon
        500: '#0ab4bc',  // Deep turquoise accent
        600: '#0891a0',  // Ocean blue
        700: '#0e7082',  // Deep water text
        800: '#155b6a',  // Button background
        900: '#164a55',
        950: '#082f38',
      },

      // Success colors (Tropical palm green)
      success: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        500: '#22c55e',  // Vibrant palm green
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
      },

      // Warning colors (Soft coral/seashell)
      warning: {
        50: '#fef5f3',   // Pale shell white
        100: '#fde8e4',  // Light shell pink
        200: '#fbd5cd',  // Soft blush
        500: '#e8a598',  // Seashell coral
        600: '#d4897a',  // Warm coral
        700: '#b86b5c',  // Terracotta
        800: '#965244',  // Deep shell
      },

      // Sent colors (Violet)
      sent: {
        50: '#f5f3ff',
        100: '#ede9fe',
        200: '#ddd6fe',
        500: '#8b5cf6',
        600: '#7c3aed',
        700: '#6d28d9',
        800: '#5b21b6',
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

      // Mainnet colors (Sky blue)
      mainnet: {
        50: '#f0f9ff',
        100: '#e0f2fe',
        200: '#bae6fd',
        300: '#7dd3fc',
        400: '#38bdf8',
        500: '#0ea5e9',
        600: '#0284c7',
        700: '#0369a1',
        800: '#075985',
        900: '#0c4a6e',
        950: '#082f49',
      },

      // Testnet colors (Amber)
      testnet: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        500: '#f59e0b',
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
      },

      // Signet colors (Purple)
      signet: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#a855f7',
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },
    },

    dark: {
      // Background colors (Starry night sky - deep blues to black)
      bg: {
        50: '#e0e7ff',   // Pale starlight blue
        100: '#c7d2fe',  // Light periwinkle
        200: '#a5b4fc',  // Soft indigo
        300: '#818cf8',  // Twilight violet
        400: '#6366f1',  // Evening indigo
        500: '#4f46e5',  // Deep twilight
        600: '#3730a3',  // Night indigo
        700: '#1e1b4b',  // Deep night blue
        800: '#0f0d2e',  // Midnight panels
        900: '#0a0919',  // Night sky background
        950: '#050510',  // Cosmic black
      },

      // Primary colors (Starlight - silver to bright blue)
      primary: {
        50: '#0c0a1a',   // Deep space
        100: '#1a1744',  // Dark nebula
        200: '#2d2a6e',  // Distant stars
        300: '#4338ca',  // Bright star core
        400: '#6366f1',  // Star glow
        500: '#818cf8',  // Bright starlight
        600: '#a5b4fc',  // Soft star shine
        700: '#c7d2fe',  // Pale starlight
        800: '#e0e7ff',  // Near-white glow
        900: '#eef2ff',  // Brightest star
        950: '#ffffff',  // Pure light
      },

      // Success colors (Nebula cyan/teal - distant star glow)
      success: {
        50: '#0a1a2e',
        100: '#0c2d4d',
        200: '#0e4470',
        500: '#22d3ee',  // Cosmic cyan
        600: '#67e8f9',
        700: '#a5f3fc',
        800: '#cffafe',
        900: '#ecfeff',
        950: '#f0fdff',
      },

      // Warning colors (Nebula magenta/pink)
      warning: {
        50: '#2e1a47',
        100: '#4c1d95',
        200: '#6b21a8',
        500: '#c084fc',  // Nebula purple
        600: '#d8b4fe',
        700: '#e9d5ff',
        800: '#f3e8ff',
        900: '#faf5ff',
        950: '#fefcff',
      },

      // Sent colors (Violet - inverted)
      sent: {
        50: '#2e1065',
        100: '#4c1d95',
        200: '#5b21b6',
        500: '#8b5cf6',
        600: '#a78bfa',
        700: '#c4b5fd',
        800: '#ddd6fe',
        900: '#ede9fe',
        950: '#f5f3ff',
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

      // Mainnet colors (Sky blue - inverted)
      mainnet: {
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

      // Testnet colors (Amber - inverted)
      testnet: {
        50: '#451a03',
        100: '#78350f',
        200: '#92400e',
        500: '#f59e0b',
        600: '#fbbf24',
        700: '#fcd34d',
        800: '#fde68a',
        900: '#fef3c7',
        950: '#fffbeb',
      },

      // Signet colors (Purple - inverted)
      signet: {
        50: '#3b0764',
        100: '#581c87',
        200: '#6b21a8',
        500: '#a855f7',
        600: '#c084fc',
        700: '#d8b4fe',
        800: '#e9d5ff',
        900: '#f3e8ff',
        950: '#faf5ff',
      },
    },
  },
};
