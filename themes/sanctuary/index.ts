/**
 * Sanctuary Theme
 *
 * Default theme with warm sand/tan tones in light mode
 * and charcoal/neutral grays in dark mode.
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sanctuaryTheme: ThemeDefinition = {
  id: 'sanctuary',
  name: 'Sanctuary',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Warm, neutral theme with earthy tones and matcha green accents',

  colors: {
    light: {
      // Background colors (Zinc/Neutral)
      bg: {
        50: '#fafafa',
        100: '#f4f4f5',
        200: '#e4e4e7',
        300: '#d4d4d8',
        400: '#a1a1aa',
        500: '#71717a',
        600: '#52525b',
        700: '#3f3f46',
        800: '#27272a',
        900: '#18181b',
        950: '#09090b',
      },

      // Primary colors (Zen gold)
      primary: {
        50: '#fcf9f4',
        100: '#f8f1e1',
        200: '#efe0c0',
        300: '#e3ca98',
        400: '#d4b483',
        500: '#b59056',
        600: '#96723e',
        700: '#795932',
        800: '#644a2d',
        900: '#533e28',
        950: '#2d2114',
      },

      // Success colors (Matcha green)
      success: {
        50: '#f4f8f5',
        100: '#e2ede5',
        200: '#c5dccb',
        500: '#628b6b',
        600: '#4a6e53',
        700: '#3d5944',
        800: '#334839',
        900: '#2b3b30',
        950: '#17211b',
      },

      // Warning colors (Zen gold)
      warning: {
        50: '#fcf9f4',
        100: '#f8f1e1',
        200: '#efe0c0',
        500: '#b59056',
        600: '#96723e',
        700: '#795932',
        800: '#644a2d',
        900: '#533e28',
        950: '#2d2114',
      },

      // Sent colors (Violet/Purple for sent transactions)
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

      // Mainnet colors (Sky blue for mainnet network)
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
        300: '#fcd34d',
        400: '#fbbf24',
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
      // Background colors stay the same as light mode
      // (Tailwind handles the mapping automatically)
      bg: {
        50: '#fafafa',
        100: '#f4f4f5',
        200: '#e4e4e7',
        300: '#d4d4d8',
        400: '#a1a1aa',
        500: '#71717a',
        600: '#52525b',
        700: '#3f3f46',
        800: '#27272a',
        900: '#18181b',
        950: '#09090b',
      },

      // Primary colors (Zen gold, inverted for dark mode)
      primary: {
        50: '#2d2114',
        100: '#533e28',
        200: '#644a2d',
        300: '#795932',
        400: '#96723e',
        500: '#b59056',
        600: '#d4b483',
        700: '#e3ca98',
        800: '#efe0c0',
        900: '#f8f1e1',
        950: '#fcf9f4',
      },

      // Success colors (inverted)
      success: {
        50: '#17211b',
        100: '#2b3b30',
        200: '#334839',
        500: '#628b6b',
        600: '#84a98c',
        700: '#9fc4a9',
        800: '#c5dccb',
        900: '#e2ede5',
        950: '#f4f8f5',
      },

      // Warning colors (inverted)
      warning: {
        50: '#2d2114',
        100: '#533e28',
        200: '#644a2d',
        500: '#b59056',
        600: '#d4b483',
        700: '#e3ca98',
        800: '#efe0c0',
        900: '#f8f1e1',
        950: '#fcf9f4',
      },

      // Sent colors (Violet/Purple for sent transactions - inverted)
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
        300: '#b45309',
        400: '#d97706',
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
