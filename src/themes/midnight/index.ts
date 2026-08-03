/**
 * Midnight Theme
 *
 * Sophisticated dark theme with silver/platinum accents.
 * Deep indigo and charcoal backgrounds with cool metallic highlights.
 * Lavender accents harmonize with the cool indigo palette.
 * Perfect for users who prefer darker interfaces with elegant contrast.
 *
 * Light mode: Cool silver/platinum with deep accents
 * Dark mode: True midnight with luminous silver highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const midnightTheme: ThemeDefinition = {
  id: 'midnight',
  name: 'Midnight',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Sophisticated silver and deep indigo for elegant darkness',

  colors: {
    light: {
      // Background colors (Cool silver/platinum grays)
      bg: {
        50: '#fafafa',   // Pure silver-white
        100: '#f5f5f5',  // Light platinum
        200: '#e5e5e5',  // Soft silver
        300: '#d4d4d4',  // Medium silver
        400: '#a3a3a3',  // Gray
        500: '#737373',  // Dark gray
        600: '#525252',  // Charcoal
        700: '#404040',  // Dark charcoal
        800: '#262626',  // Near black
        900: '#171717',  // Deep black
        950: '#0a0a0a',  // True black
      },

      // Primary colors (Deep indigo/violet)
      primary: {
        50: '#eef2ff',   // Indigo-50: Palest indigo
        100: '#e0e7ff',  // Indigo-100: Light indigo
        200: '#c7d2fe',  // Indigo-200: Soft indigo
        300: '#a5b4fc',  // Indigo-300: Medium indigo
        400: '#818cf8',  // Indigo-400: Bright indigo
        500: '#6366f1',  // Indigo-500: True indigo (main)
        600: '#4f46e5',  // Indigo-600: Deep indigo
        700: '#4338ca',  // Indigo-700: Dark indigo
        800: '#3730a3',  // Indigo-800: Very dark indigo
        900: '#312e81',  // Indigo-900: Midnight indigo
        950: '#1e1b4b',  // Indigo-950: Darkest
      },

      // Success colors (Cool cyan/teal)
      success: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        500: '#06b6d4',  // Cyan-500: Cool success
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
      },

      // Warning colors (Lavender - harmonizes with indigo)
      warning: {
        50: '#f5f3ff',   // Violet-50
        100: '#ede9fe',  // Violet-100
        200: '#ddd6fe',  // Violet-200
        500: '#a78bfa',  // Violet-400: Lavender (main)
        600: '#8b5cf6',  // Violet-500
        700: '#7c3aed',  // Violet-600
        800: '#6d28d9',  // Violet-700
        900: '#5b21b6',  // Violet-800
        950: '#4c1d95',  // Violet-900
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

      // Mainnet colors (Cool cyan to match midnight aesthetic)
      mainnet: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        300: '#67e8f9',
        400: '#22d3ee',
        500: '#06b6d4',
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
      },

      // Testnet colors (Lavender)
      testnet: {
        50: '#f5f3ff',   // Violet-50
        100: '#ede9fe',  // Violet-100
        200: '#ddd6fe',  // Violet-200
        300: '#c4b5fd',  // Violet-300
        400: '#a78bfa',  // Violet-400
        500: '#a78bfa',  // Violet-400 (same as 400 for lavender emphasis)
        600: '#8b5cf6',  // Violet-500
        700: '#7c3aed',  // Violet-600
        800: '#6d28d9',  // Violet-700
        900: '#5b21b6',  // Violet-800
        950: '#4c1d95',  // Violet-900
      },

      // Signet colors (Purple)
      signet: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        300: '#d8b4fe',
        400: '#c084fc',
        500: '#a855f7',
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },
    },

    dark: {
      // Background colors (True midnight - deep indigo-black)
      bg: {
        50: '#fafafa',   // Light for text
        100: '#f5f5f5',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#2d2d3a',  // Indigo-tinted charcoal
        800: '#1a1a24',  // Deep midnight panels
        900: '#0f0f14',  // True midnight background
        950: '#050508',  // Absolute darkness
      },

      // Primary colors (Luminous silver/platinum)
      primary: {
        50: '#18181b',   // Dark zinc (inverted)
        100: '#27272a',
        200: '#3f3f46',
        300: '#52525b',
        400: '#71717a',
        500: '#a1a1aa',  // Silver-500: Luminous silver
        600: '#d4d4d8',
        700: '#e4e4e7',
        800: '#f4f4f5',
        900: '#fafafa',
        950: '#ffffff',
      },

      // Success colors (Bright cyan for visibility)
      success: {
        50: '#083344',
        100: '#164e63',
        200: '#155e75',
        500: '#22d3ee',  // Cyan-400: Bright cyan
        600: '#67e8f9',
        700: '#a5f3fc',
        800: '#cffafe',
        900: '#ecfeff',
        950: '#f0fdff',
      },

      // Warning colors (Lavender - inverted for dark mode)
      warning: {
        50: '#4c1d95',   // Violet-900
        100: '#5b21b6',  // Violet-800
        200: '#6d28d9',  // Violet-700
        500: '#a78bfa',  // Violet-400: Lavender (main)
        600: '#c4b5fd',  // Violet-300
        700: '#ddd6fe',  // Violet-200
        800: '#ede9fe',  // Violet-100
        900: '#f5f3ff',  // Violet-50
        950: '#faf5ff',  // Lightest
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

      // Mainnet colors (Cool cyan - inverted)
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

      // Testnet colors (Lavender - inverted)
      testnet: {
        50: '#4c1d95',   // Violet-900
        100: '#5b21b6',  // Violet-800
        200: '#6d28d9',  // Violet-700
        300: '#7c3aed',  // Violet-600
        400: '#8b5cf6',  // Violet-500
        500: '#a78bfa',  // Violet-400
        600: '#c4b5fd',  // Violet-300
        700: '#ddd6fe',  // Violet-200
        800: '#ede9fe',  // Violet-100
        900: '#f5f3ff',  // Violet-50
        950: '#faf5ff',  // Lightest
      },

      // Signet colors (Purple - inverted)
      signet: {
        50: '#3b0764',
        100: '#581c87',
        200: '#6b21a8',
        300: '#7e22ce',
        400: '#9333ea',
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
