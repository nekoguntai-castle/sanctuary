/**
 * Sunrise/Sunset Theme
 *
 * Light mode: Sunrise palette with white backgrounds and warm coral/peach/golden accents
 * Dark mode: Pastel sunset palette with deep purple/blue backgrounds and soft warm pastels
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sunriseTheme: ThemeDefinition = {
  id: 'sunrise',
  name: 'Sun+rise/set',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Sunrise warmth in light mode, pastel sunset serenity in dark mode',

  colors: {
    light: {
      // Background colors (clean whites with warm undertones)
      bg: {
        50: '#fffcfa',   // Warmest white
        100: '#fff8f3',
        200: '#ffefe3',
        300: '#ffe4d1',
        400: '#c9b8a8',  // Warm gray
        500: '#9a8b7c',
        600: '#7a6d60',
        700: '#5d5249',
        800: '#3d3530',
        900: '#261f1b',
        950: '#141110',
      },

      // Primary colors (Sunrise coral/peach)
      primary: {
        50: '#fff5f2',
        100: '#ffe8e0',
        200: '#ffd4c4',
        300: '#ffb59a',
        400: '#ff9670',   // Coral
        500: '#e87850',   // Warm coral
        600: '#d45d3a',
        700: '#b04528',
        800: '#8c3820',
        900: '#6b2c1a',
        950: '#3a150c',
      },

      // Success colors (Golden sunrise/honey)
      success: {
        50: '#fffbeb',
        100: '#fff3c4',
        200: '#ffe588',
        500: '#e6a317',   // Golden honey
        600: '#cc8a0f',
        700: '#a86c0c',
        800: '#88550d',
        900: '#704610',
        950: '#402505',
      },

      // Warning colors (Rose pink for pending/sent)
      warning: {
        50: '#fff5f7',
        100: '#ffe0e8',
        200: '#ffc7d6',
        500: '#e85d8c',   // Rose pink
        600: '#d4426f',
        700: '#b0315a',
        800: '#8c294a',
        900: '#6b223c',
        950: '#3a101f',
      },

      // Sent colors (Sunset violet/purple for sent transactions)
      sent: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        500: '#a855f7',   // Purple
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
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

      // Mainnet colors (Sky blue for sunrise theme)
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

      // Signet colors (Purple - same as Sanctuary)
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
      // Background colors (Deep sunset purples/blues)
      bg: {
        50: '#faf8fc',
        100: '#f3f0f7',
        200: '#e8e3ef',
        300: '#d4cce0',
        400: '#a99fc0',   // Dusty lavender
        500: '#7d7498',
        600: '#5e566e',
        700: '#433d50',
        800: '#2a2635',   // Deep purple-blue
        900: '#1a1722',   // Night purple
        950: '#0d0b11',
      },

      // Primary colors (Pastel peach/coral for dark mode)
      primary: {
        50: '#2a1f1d',
        100: '#3d2e29',
        200: '#5c4239',
        300: '#8c6050',
        400: '#c48872',
        500: '#e8a890',   // Soft pastel coral
        600: '#f2c4b3',
        700: '#f8dcd0',
        800: '#fceee8',
        900: '#fef7f4',
        950: '#fffcfb',
      },

      // Success colors (Pastel golden/amber)
      success: {
        50: '#2a2415',
        100: '#3d351f',
        200: '#5c4d2a',
        500: '#d4a84a',   // Soft golden
        600: '#e8c66e',
        700: '#f2d98f',
        800: '#f8e8b5',
        900: '#fcf3d8',
        950: '#fef9ec',
      },

      // Warning colors (Soft rose for pending/sent)
      warning: {
        50: '#2a1a20',
        100: '#3d2730',
        200: '#5c3848',
        500: '#d4668a',   // Soft rose
        600: '#e88aa8',
        700: '#f2adc2',
        800: '#f8cfd9',
        900: '#fce8ee',
        950: '#fef5f7',
      },

      // Sent colors (Pastel violet for sent transactions)
      sent: {
        50: '#2a1f30',
        100: '#3d2d48',
        200: '#5c4268',
        500: '#b88be8',   // Soft pastel violet
        600: '#caa8f2',
        700: '#dcc4f8',
        800: '#eddcfc',
        900: '#f6eefe',
        950: '#fbf7ff',
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

      // Mainnet colors (Sky blue - inverted for dark mode)
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

      // Testnet colors (Amber, inverted for dark mode)
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
