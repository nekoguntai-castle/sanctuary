/**
 * Copper Patina Theme
 *
 * Industrial elegance with warm copper tones and aged verdigris accents.
 * Steampunk-inspired aesthetic with a timeless, sophisticated feel.
 *
 * Light mode: Warm copper and cream tones with subtle verdigris highlights
 * Dark mode: Deep bronze with oxidized copper green (patina) accents
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const copperTheme: ThemeDefinition = {
  id: 'copper',
  name: 'Copper Patina',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Industrial elegance with warm copper and verdigris patina',

  colors: {
    light: {
      // Background colors (Warm cream/copper undertones)
      bg: {
        50: '#fdfcfa',   // Warm white
        100: '#f9f6f1',  // Cream
        200: '#f2ebe0',  // Light parchment
        300: '#e5dacb',  // Aged paper
        400: '#c9b9a4',  // Weathered copper
        500: '#9a887a',  // Tarnished
        600: '#756658',  // Dark bronze
        700: '#504540',  // Deep brown
        800: '#322c28',  // Near black brown
        900: '#1e1a18',  // Dark
        950: '#0f0d0c',  // Darkest
      },

      // Primary colors (Copper - warm metallic)
      primary: {
        50: '#fdf6f0',   // Palest copper
        100: '#fbe8d8',  // Light copper
        200: '#f7cfb0',  // Soft copper
        300: '#f0ae7e',  // Shiny copper
        400: '#e88648',  // Bright copper
        500: '#d4662a',  // True copper (main)
        600: '#b84c1c',  // Deep copper
        700: '#993b1a',  // Dark copper
        800: '#7d321b',  // Bronze
        900: '#682c1a',  // Dark bronze
        950: '#3a140a',  // Darkest
      },

      // Success colors (Verdigris - oxidized copper green)
      success: {
        50: '#effefa',
        100: '#c7fff0',
        200: '#90fce0',
        500: '#2dd4bf',  // Verdigris
        600: '#14b8a6',
        700: '#0d9488',
        800: '#107a70',
        900: '#11655c',
        950: '#053f3a',
      },

      // Warning colors (Brass - warm gold)
      warning: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        500: '#ca8a04',  // Brass
        600: '#a16207',
        700: '#854d0e',
        800: '#713f12',
        900: '#5f3415',
        950: '#361c08',
      },

      // Sent colors (Oxidized bronze purple)
      sent: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#9333ea',  // Bronze purple
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

      // Mainnet colors (Copper)
      mainnet: {
        50: '#fdf6f0',
        100: '#fbe8d8',
        200: '#f7cfb0',
        300: '#f0ae7e',
        400: '#e88648',
        500: '#d4662a',  // True copper
        600: '#b84c1c',
        700: '#993b1a',
        800: '#7d321b',
        900: '#682c1a',
        950: '#3a140a',
      },

      // Testnet colors (Verdigris - patina)
      testnet: {
        50: '#effefa',
        100: '#c7fff0',
        200: '#90fce0',
        300: '#5eead4',
        400: '#2dd4bf',
        500: '#14b8a6',  // Patina
        600: '#0d9488',
        700: '#107a70',
        800: '#11655c',
        900: '#134e4a',
        950: '#053f3a',
      },

      // Signet colors (Brass gold)
      signet: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        300: '#fde047',
        400: '#facc15',
        500: '#ca8a04',  // Brass
        600: '#a16207',
        700: '#854d0e',
        800: '#713f12',
        900: '#5f3415',
        950: '#361c08',
      },
    },

    dark: {
      // Background colors (Deep bronze/brown)
      bg: {
        50: '#f2ebe0',   // Light cream (for text)
        100: '#e5dacb',  // Aged paper
        200: '#c9b9a4',  // Weathered
        300: '#a08878',  // Tarnished
        400: '#7a6658',  // Bronze
        500: '#564840',  // Dark bronze
        600: '#3d3430',  // Deep brown
        700: '#2a2420',  // Rich brown
        800: '#1c1815',  // Near black
        900: '#12100e',  // Dark
        950: '#0a0908',  // Darkest
      },

      // Primary colors (Glowing copper for dark mode)
      primary: {
        50: '#3a140a',   // Deep shadow
        100: '#682c1a',  // Dark bronze
        200: '#7d321b',  // Bronze
        300: '#993b1a',  // Dark copper
        400: '#b84c1c',  // Deep copper
        500: '#e88648',  // Glowing copper (main)
        600: '#f0ae7e',  // Bright copper
        700: '#f7cfb0',  // Soft glow
        800: '#fbe8d8',  // Light glow
        900: '#fdf6f0',  // Pale glow
        950: '#fffcfa',  // Brightest
      },

      // Success colors (Bright verdigris for dark mode)
      success: {
        50: '#053f3a',
        100: '#11655c',
        200: '#107a70',
        500: '#5eead4',  // Glowing patina
        600: '#90fce0',
        700: '#c7fff0',
        800: '#e0fffa',
        900: '#effefa',
        950: '#f5fffd',
      },

      // Warning colors (Bright brass for dark mode)
      warning: {
        50: '#361c08',
        100: '#5f3415',
        200: '#713f12',
        500: '#fbbf24',  // Glowing brass
        600: '#fcd34d',
        700: '#fde68a',
        800: '#fef3c7',
        900: '#fefce8',
        950: '#fffef5',
      },

      // Sent colors (Oxidized purple - inverted)
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

      // Mainnet colors (Glowing copper - inverted)
      mainnet: {
        50: '#3a140a',
        100: '#682c1a',
        200: '#7d321b',
        300: '#993b1a',
        400: '#b84c1c',
        500: '#e88648',  // Glowing copper
        600: '#f0ae7e',
        700: '#f7cfb0',
        800: '#fbe8d8',
        900: '#fdf6f0',
        950: '#fffcfa',
      },

      // Testnet colors (Glowing patina - inverted)
      testnet: {
        50: '#053f3a',
        100: '#134e4a',
        200: '#11655c',
        300: '#107a70',
        400: '#0d9488',
        500: '#2dd4bf',  // Glowing patina
        600: '#5eead4',
        700: '#90fce0',
        800: '#c7fff0',
        900: '#effefa',
        950: '#f5fffd',
      },

      // Signet colors (Glowing brass - inverted)
      signet: {
        50: '#361c08',
        100: '#5f3415',
        200: '#713f12',
        300: '#854d0e',
        400: '#a16207',
        500: '#eab308',  // Glowing brass
        600: '#facc15',
        700: '#fde047',
        800: '#fef08a',
        900: '#fef9c3',
        950: '#fefce8',
      },
    },
  },
};
