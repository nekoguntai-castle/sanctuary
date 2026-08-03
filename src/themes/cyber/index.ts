/**
 * Cyber Theme
 *
 * Light mode: Retro-futuristic with cool lavender backgrounds and neon accents
 * Dark mode: Classic synthwave night with deep purple-blacks and glowing neons
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const cyberTheme: ThemeDefinition = {
  id: 'cyber',
  name: 'Cyber',
  author: 'Sanctuary Wallet Team',
  version: '2.0.0',
  description: 'Synthwave neon with retro-futuristic vibes',

  colors: {
    light: {
      // Background colors (Cool lavender / retro-futuristic)
      bg: {
        50: '#faf8ff',   // Pale lavender white
        100: '#f4f0fa',  // Soft lavender
        200: '#ebe4f5',  // Light purple-gray
        300: '#ddd4ec',  // Lavender gray
        400: '#b8a8d4',  // Muted purple
        500: '#8a7aaa',  // Dusty violet
        600: '#685a88',  // Deep lavender
        700: '#4a3f66',  // Dark purple
        800: '#2e2844',  // Deep violet
        900: '#1a1628',  // Near black violet
        950: '#0d0b14',  // Darkest
      },

      // Primary colors (Neon purple / magenta)
      primary: {
        50: '#fdf4ff',   // Palest magenta
        100: '#fae8ff',  // Light magenta
        200: '#f5d0fe',  // Soft magenta
        300: '#f0abfc',  // Pink-purple
        400: '#e879f9',  // Bright magenta
        500: '#d946ef',  // Neon magenta (main)
        600: '#c026d3',  // Deep magenta
        700: '#a21caf',  // Dark magenta
        800: '#86198f',  // Deeper
        900: '#701a75',  // Darkest magenta
        950: '#4a044e',  // Near black
      },

      // Success colors (Electric cyan)
      success: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        500: '#06b6d4',  // Electric cyan
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
      },

      // Warning colors (Hot pink / neon rose)
      warning: {
        50: '#fff1f3',
        100: '#ffe4e9',
        200: '#fecdd6',
        500: '#f43f7a',  // Hot pink
        600: '#e11d60',
        700: '#be185d',
        800: '#9f1451',
      },

      // Sent colors (Neon violet)
      sent: {
        50: '#f5f3ff',
        100: '#ede9fe',
        200: '#ddd6fe',
        500: '#8b5cf6',  // Neon violet
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

      // Mainnet colors (Neon cyan)
      mainnet: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        300: '#67e8f9',
        400: '#22d3ee',
        500: '#06b6d4',  // Electric cyan
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
      },

      // Testnet colors (Neon yellow/gold)
      testnet: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        300: '#fde047',
        400: '#facc15',
        500: '#eab308',  // Neon gold
        600: '#ca8a04',
        700: '#a16207',
        800: '#854d0e',
        900: '#713f12',
        950: '#422006',
      },

      // Signet colors (Hot pink)
      signet: {
        50: '#fdf2f8',
        100: '#fce7f3',
        200: '#fbcfe8',
        300: '#f9a8d4',
        400: '#f472b6',
        500: '#ec4899',  // Hot pink
        600: '#db2777',
        700: '#be185d',
        800: '#9d174d',
        900: '#831843',
        950: '#500724',
      },
    },

    dark: {
      // Background colors (Deep synthwave purple-black)
      bg: {
        50: '#e8e0f0',   // Pale lavender (for text)
        100: '#d4c8e4',  // Light purple
        200: '#b8a6d0',  // Soft violet
        300: '#9680b8',  // Muted purple
        400: '#705898',  // Medium purple
        500: '#523d78',  // Deep purple
        600: '#3a2858',  // Dark violet
        700: '#251840',  // Deep synthwave
        800: '#160e2a',  // Dark purple-black
        900: '#0c0618',  // Near black
        950: '#06030d',  // True synthwave black
      },

      // Primary colors (Glowing neon magenta)
      primary: {
        50: '#4a044e',   // Deep magenta shadow
        100: '#701a75',  // Dark magenta
        200: '#86198f',  // Rich magenta
        300: '#a21caf',  // Bright base
        400: '#c026d3',  // Vibrant
        500: '#d946ef',  // Neon magenta (main)
        600: '#e879f9',  // Glowing
        700: '#f0abfc',  // Bright glow
        800: '#f5d0fe',  // Soft glow
        900: '#fae8ff',  // Pale glow
        950: '#fdf4ff',  // Brightest
      },

      // Success colors (Neon cyan glow)
      success: {
        50: '#083344',
        100: '#164e63',
        200: '#155e75',
        500: '#22d3ee',  // Bright neon cyan
        600: '#67e8f9',
        700: '#a5f3fc',
        800: '#cffafe',
        900: '#ecfeff',
        950: '#f0fdff',
      },

      // Warning colors (Neon hot pink glow)
      warning: {
        50: '#4a0525',
        100: '#831843',
        200: '#9f1451',
        500: '#f472b6',  // Glowing hot pink
        600: '#f9a8d4',
        700: '#fbcfe8',
        800: '#fce7f3',
        900: '#fdf2f8',
        950: '#fffafc',
      },

      // Sent colors (Neon violet - inverted)
      sent: {
        50: '#2e1065',
        100: '#4c1d95',
        200: '#5b21b6',
        500: '#a78bfa',  // Glowing violet
        600: '#c4b5fd',
        700: '#ddd6fe',
        800: '#ede9fe',
        900: '#f5f3ff',
        950: '#faf8ff',
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

      // Mainnet colors (Neon cyan - inverted)
      mainnet: {
        50: '#083344',
        100: '#164e63',
        200: '#155e75',
        300: '#0e7490',
        400: '#0891b2',
        500: '#06b6d4',
        600: '#22d3ee',
        700: '#67e8f9',
        800: '#a5f3fc',
        900: '#cffafe',
        950: '#ecfeff',
      },

      // Testnet colors (Neon yellow - inverted)
      testnet: {
        50: '#422006',
        100: '#713f12',
        200: '#854d0e',
        300: '#a16207',
        400: '#ca8a04',
        500: '#eab308',
        600: '#facc15',
        700: '#fde047',
        800: '#fef08a',
        900: '#fef9c3',
        950: '#fefce8',
      },

      // Signet colors (Hot pink - inverted)
      signet: {
        50: '#500724',
        100: '#831843',
        200: '#9d174d',
        300: '#be185d',
        400: '#db2777',
        500: '#ec4899',
        600: '#f472b6',
        700: '#f9a8d4',
        800: '#fbcfe8',
        900: '#fce7f3',
        950: '#fdf2f8',
      },
    },
  },
};
