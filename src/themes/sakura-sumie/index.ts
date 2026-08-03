/**
 * Sakura Sumi-e Theme
 *
 * Inspired by traditional Japanese ink wash painting (sumi-e).
 * Near-monochrome with ink grays and subtle pink accents.
 * Maximum zen, contemplative, and artistic.
 *
 * Light mode: Rice paper whites with ink gray accents and whisper of pink
 * Dark mode: Deep ink black with soft gray washes and muted pink highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sakuraSumieTheme: ThemeDefinition = {
  id: 'sakura-sumie',
  name: 'Sakura Sumi-e',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Traditional ink wash painting with subtle cherry blossom accents',

  colors: {
    light: {
      // Background colors (Rice paper - warm off-white)
      bg: {
        50: '#fdfcfa',   // Rice paper white
        100: '#f8f6f2',  // Warm paper
        200: '#f0ece6',  // Aged paper
        300: '#e4ded6',  // Light wash
        400: '#c8c0b6',  // Medium wash
        500: '#988e82',  // Ink wash mid
        600: '#706860',  // Dark wash
        700: '#4a4540',  // Deep ink
        800: '#2e2b28',  // Near black ink
        900: '#1c1a18',  // Black ink
        950: '#0e0d0c',  // Darkest ink
      },

      // Primary colors (Ink with pink undertone)
      primary: {
        50: '#f8f6f6',   // Paper with pink hint
        100: '#f0eaeb',  // Soft wash
        200: '#e2d6d9',  // Light ink-pink
        300: '#ccbabf',  // Muted ink-rose
        400: '#b098a0',  // Ink rose
        500: '#8c7078',  // Ink pink (main)
        600: '#6e5860',  // Dark ink rose
        700: '#54444a',  // Deep ink
        800: '#3e3438',  // Near black
        900: '#2c2628',  // Black
        950: '#181416',  // Darkest
      },

      // Success colors (Ink green - subtle)
      success: {
        50: '#f6f7f5',
        100: '#eaece8',
        200: '#d6dcd2',
        500: '#6a7866',  // Muted ink green
        600: '#525e4e',
        700: '#404a3c',
        800: '#343c32',
        900: '#2a322a',
        950: '#161a16',
      },

      // Warning colors (Ink amber - muted)
      warning: {
        50: '#faf8f4',
        100: '#f4f0e6',
        200: '#e8e0d0',
        500: '#a09078',  // Muted ink amber
        600: '#7e7260',
        700: '#605850',
        800: '#4a4440',
        900: '#3a3634',
        950: '#201e1c',
      },

      // Sent colors (Pure ink gray)
      sent: {
        50: '#f6f6f5',
        100: '#eaeae8',
        200: '#d6d6d2',
        500: '#787874',  // Ink gray
        600: '#5e5e5a',
        700: '#484846',
        800: '#383836',
        900: '#2c2c2a',
        950: '#181816',
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

      // Mainnet colors (Ink pink)
      mainnet: {
        50: '#f8f6f6',
        100: '#f0eaeb',
        200: '#e2d6d9',
        300: '#ccbabf',
        400: '#b098a0',
        500: '#8c7078',  // Ink pink
        600: '#6e5860',
        700: '#54444a',
        800: '#3e3438',
        900: '#2c2628',
        950: '#181416',
      },

      // Testnet colors (Ink green)
      testnet: {
        50: '#f6f7f5',
        100: '#eaece8',
        200: '#d6dcd2',
        300: '#b8c2b2',
        400: '#92a08c',
        500: '#6a7866',  // Ink green
        600: '#525e4e',
        700: '#404a3c',
        800: '#343c32',
        900: '#2a322a',
        950: '#161a16',
      },

      // Signet colors (Ink gray)
      signet: {
        50: '#f6f6f5',
        100: '#eaeae8',
        200: '#d6d6d2',
        300: '#babab6',
        400: '#989894',
        500: '#787874',  // Ink gray
        600: '#5e5e5a',
        700: '#484846',
        800: '#383836',
        900: '#2c2c2a',
        950: '#181816',
      },
    },

    dark: {
      // Background colors (Deep ink - sumi black)
      bg: {
        50: '#e8e6e4',   // Light ink wash (for text)
        100: '#d0ccc8',  // Soft wash
        200: '#b0aaa4',  // Medium wash
        300: '#888480',  // Darker wash
        400: '#646260',  // Deep wash
        500: '#484644',  // Dark ink
        600: '#343230',  // Deep ink
        700: '#242220',  // Sumi black
        800: '#181716',  // Near black
        900: '#0e0e0d',  // Pure black
        950: '#060606',  // Deepest black
      },

      // Primary colors (Soft ink-pink glow)
      primary: {
        50: '#181416',   // Deep shadow
        100: '#2c2628',  // Dark ink
        200: '#3e3438',  // Rich ink
        300: '#54444a',  // Deep rose-ink
        400: '#6e5860',  // Muted rose
        500: '#a88890',  // Soft ink-pink glow (main)
        600: '#bca0a8',  // Light rose
        700: '#d0b8be',  // Pale rose
        800: '#e2d0d4',  // Near white
        900: '#f0e8ea',  // Almost white
        950: '#f8f4f5',  // Pure light
      },

      // Success colors (Soft ink green glow)
      success: {
        50: '#161a16',
        100: '#2a322a',
        200: '#343c32',
        500: '#90a088',  // Soft ink green
        600: '#a8b4a0',
        700: '#c0c8b8',
        800: '#d8dcd0',
        900: '#ecf0e8',
        950: '#f6f8f4',
      },

      // Warning colors (Soft ink amber glow)
      warning: {
        50: '#201e1c',
        100: '#3a3634',
        200: '#4a4440',
        500: '#c0b098',  // Soft ink amber
        600: '#d0c0a8',
        700: '#e0d0b8',
        800: '#ece0d0',
        900: '#f6f0e8',
        950: '#fcfaf6',
      },

      // Sent colors (Soft ink gray glow)
      sent: {
        50: '#181816',
        100: '#2c2c2a',
        200: '#383836',
        500: '#a0a09c',  // Soft ink gray
        600: '#b4b4b0',
        700: '#c8c8c4',
        800: '#dcdcd8',
        900: '#f0f0ec',
        950: '#f8f8f6',
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

      // Mainnet colors (Soft ink-pink glow - inverted)
      mainnet: {
        50: '#181416',
        100: '#2c2628',
        200: '#3e3438',
        300: '#54444a',
        400: '#6e5860',
        500: '#a88890',  // Ink-pink glow
        600: '#bca0a8',
        700: '#d0b8be',
        800: '#e2d0d4',
        900: '#f0e8ea',
        950: '#f8f4f5',
      },

      // Testnet colors (Soft ink green - inverted)
      testnet: {
        50: '#161a16',
        100: '#2a322a',
        200: '#343c32',
        300: '#404a3c',
        400: '#525e4e',
        500: '#90a088',  // Ink green
        600: '#a8b4a0',
        700: '#c0c8b8',
        800: '#d8dcd0',
        900: '#ecf0e8',
        950: '#f6f8f4',
      },

      // Signet colors (Soft ink gray - inverted)
      signet: {
        50: '#181816',
        100: '#2c2c2a',
        200: '#383836',
        300: '#484846',
        400: '#5e5e5a',
        500: '#a0a09c',  // Ink gray
        600: '#b4b4b0',
        700: '#c8c8c4',
        800: '#dcdcd8',
        900: '#f0f0ec',
        950: '#f8f8f6',
      },
    },
  },
};
