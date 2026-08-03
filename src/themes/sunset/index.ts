/**
 * Sakura Theme
 *
 * Japanese cherry blossom inspired theme with a zen, serene aesthetic.
 *
 * Light mode: Soft Petal - Muted pastel pinks on warm cream (rice paper)
 * Dark mode: Yozakura (Evening Sakura) - Deep indigo night with glowing pink petals
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sakuraTheme: ThemeDefinition = {
  id: 'sakura',
  name: 'Sakura',
  author: 'Sanctuary Wallet Team',
  version: '2.0.0',
  description: 'Soft pastel petals by day, magical night viewing by evening',

  colors: {
    light: {
      // Background colors (Warm cream - rice paper aesthetic)
      bg: {
        50: '#fefdfb',   // Warm white
        100: '#fcf9f4',  // Rice paper
        200: '#f7f2e8',  // Soft cream
        300: '#efe6d8',  // Warm parchment
        400: '#d9cbb8',  // Aged paper
        500: '#b0a090',  // Weathered
        600: '#8a7a6a',  // Stone
        700: '#5c5048',  // Dark stone
        800: '#3a3230',  // Deep shadow
        900: '#241f1d',  // Near black
        950: '#141210',  // Darkest
      },

      // Primary colors (Soft Petal pink - muted, pastel)
      primary: {
        50: '#fef7f8',   // Barely pink
        100: '#fceef0',  // Whisper pink
        200: '#f9dce2',  // Soft blush
        300: '#f2c4ce',  // Faded petal
        400: '#e8a4b4',  // Muted sakura
        500: '#d4899c',  // Soft petal (main)
        600: '#b86b7e',  // Dusty rose
        700: '#955462',  // Deep rose
        800: '#78444f',  // Dark mauve
        900: '#633940',  // Deep mauve
        950: '#3a1f24',  // Darkest
      },

      // Success colors (Sage green - muted, natural)
      success: {
        50: '#f6f8f5',
        100: '#e8efe6',
        200: '#d2e0ce',
        500: '#7a9e72',  // Muted sage
        600: '#5f8056',
        700: '#4a6644',
        800: '#3d5338',
        900: '#33452f',
        950: '#1a2518',
      },

      // Warning colors (Warm amber - soft, natural)
      warning: {
        50: '#fefaf3',
        100: '#fcf2e0',
        200: '#f8e2c0',
        500: '#d4a86a',  // Soft amber
        600: '#b8894a',
        700: '#966c38',
        800: '#7a5630',
        900: '#65472a',
        950: '#382514',
      },

      // Sent colors (Muted wisteria)
      sent: {
        50: '#f9f7fb',
        100: '#f0ecf5',
        200: '#e2d9ec',
        500: '#9a88b0',  // Soft wisteria
        600: '#7d6c94',
        700: '#645578',
        800: '#514560',
        900: '#433a4f',
        950: '#261f2d',
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

      // Mainnet colors (Soft petal pink)
      mainnet: {
        50: '#fef7f8',
        100: '#fceef0',
        200: '#f9dce2',
        300: '#f2c4ce',
        400: '#e8a4b4',
        500: '#d4899c',  // Soft petal
        600: '#b86b7e',
        700: '#955462',
        800: '#78444f',
        900: '#633940',
        950: '#3a1f24',
      },

      // Testnet colors (Sage green)
      testnet: {
        50: '#f6f8f5',
        100: '#e8efe6',
        200: '#d2e0ce',
        300: '#b5cead',
        400: '#92b586',
        500: '#7a9e72',  // Sage
        600: '#5f8056',
        700: '#4a6644',
        800: '#3d5338',
        900: '#33452f',
        950: '#1a2518',
      },

      // Signet colors (Soft wisteria)
      signet: {
        50: '#f9f7fb',
        100: '#f0ecf5',
        200: '#e2d9ec',
        300: '#cec0dc',
        400: '#b4a2c8',
        500: '#9a88b0',  // Wisteria
        600: '#7d6c94',
        700: '#645578',
        800: '#514560',
        900: '#433a4f',
        950: '#261f2d',
      },
    },

    dark: {
      // Background colors (Deep indigo night - Yozakura)
      bg: {
        50: '#e8e4f0',   // Pale moonlight (for text)
        100: '#d4cce5',  // Soft twilight
        200: '#b8acd0',  // Lavender mist
        300: '#9488b5',  // Dusky purple
        400: '#6e6090',  // Evening purple
        500: '#4d4268',  // Deep twilight
        600: '#362e4a',  // Night indigo
        700: '#252038',  // Deep night
        800: '#181428',  // Midnight
        900: '#0e0b1a',  // Near black
        950: '#07050d',  // Deepest night
      },

      // Primary colors (Glowing pink petals against night sky)
      primary: {
        50: '#3a1f2a',   // Deep shadow
        100: '#5c3044',  // Dark mauve
        200: '#7a4058',  // Rich mauve
        300: '#a05070',  // Deep rose
        400: '#c86088',  // Bright rose
        500: '#e890a8',  // Glowing petal (main)
        600: '#f0a8bc',  // Soft glow
        700: '#f5c0ce',  // Light glow
        800: '#f9d8e0',  // Pale glow
        900: '#fcecf0',  // Near white
        950: '#fef7f9',  // Brightest
      },

      // Success colors (Moonlit sage)
      success: {
        50: '#1a2518',
        100: '#2d3f28',
        200: '#3d5338',
        500: '#8cc084',  // Moonlit sage
        600: '#a8d0a0',
        700: '#c4e0bc',
        800: '#dff0d8',
        900: '#f0f8ec',
        950: '#f8fcf6',
      },

      // Warning colors (Lantern amber glow)
      warning: {
        50: '#382514',
        100: '#5a3c20',
        200: '#7a5630',
        500: '#e8b86a',  // Warm lantern glow
        600: '#f0c888',
        700: '#f5d8a8',
        800: '#f9e8c8',
        900: '#fcf4e4',
        950: '#fefaf2',
      },

      // Sent colors (Glowing wisteria)
      sent: {
        50: '#261f2d',
        100: '#3d3348',
        200: '#514560',
        500: '#b8a0cc',  // Glowing wisteria
        600: '#c8b4da',
        700: '#d8c8e6',
        800: '#e8dcf0',
        900: '#f4f0f8',
        950: '#faf8fc',
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

      // Mainnet colors (Glowing petal - inverted)
      mainnet: {
        50: '#3a1f2a',
        100: '#5c3044',
        200: '#7a4058',
        300: '#a05070',
        400: '#c86088',
        500: '#e890a8',  // Glowing petal
        600: '#f0a8bc',
        700: '#f5c0ce',
        800: '#f9d8e0',
        900: '#fcecf0',
        950: '#fef7f9',
      },

      // Testnet colors (Moonlit sage - inverted)
      testnet: {
        50: '#1a2518',
        100: '#2d3f28',
        200: '#3d5338',
        300: '#4a6644',
        400: '#5f8056',
        500: '#8cc084',  // Moonlit sage
        600: '#a8d0a0',
        700: '#c4e0bc',
        800: '#dff0d8',
        900: '#f0f8ec',
        950: '#f8fcf6',
      },

      // Signet colors (Glowing wisteria - inverted)
      signet: {
        50: '#261f2d',
        100: '#3d3348',
        200: '#514560',
        300: '#645578',
        400: '#7d6c94',
        500: '#b8a0cc',  // Glowing wisteria
        600: '#c8b4da',
        700: '#d8c8e6',
        800: '#e8dcf0',
        900: '#f4f0f8',
        950: '#faf8fc',
      },
    },
  },
};
