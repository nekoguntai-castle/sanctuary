/**
 * Ocean Theme
 *
 * Calm, professional theme inspired by deep ocean waters.
 * Blues and teals create a serene, trustworthy atmosphere.
 *
 * Light mode: Crisp whites with ocean blue accents
 * Dark mode: Deep sea blues with luminescent highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const oceanTheme: ThemeDefinition = {
  id: 'ocean',
  name: 'Ocean',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Calm blues and teals inspired by deep ocean waters',

  colors: {
    light: {
      // Background colors (Cool neutral grays with slight blue undertone)
      bg: {
        50: '#f8fafc',   // Slate-50: Crisp off-white
        100: '#f1f5f9',  // Slate-100: Light gray-blue
        200: '#e2e8f0',  // Slate-200: Soft gray
        300: '#cbd5e1',  // Slate-300: Medium gray
        400: '#94a3b8',  // Slate-400: Cool gray
        500: '#64748b',  // Slate-500: Muted blue-gray
        600: '#475569',  // Slate-600: Dark gray
        700: '#334155',  // Slate-700: Charcoal
        800: '#1e293b',  // Slate-800: Deep charcoal
        900: '#0f172a',  // Slate-900: Near black
        950: '#020617',  // Slate-950: Darkest
      },

      // Primary colors (Ocean blue - calm and professional)
      primary: {
        50: '#eff6ff',   // Blue-50: Lightest sky
        100: '#dbeafe',  // Blue-100: Pale blue
        200: '#bfdbfe',  // Blue-200: Light blue
        300: '#93c5fd',  // Blue-300: Sky blue
        400: '#60a5fa',  // Blue-400: Bright blue
        500: '#3b82f6',  // Blue-500: True blue (main accent)
        600: '#2563eb',  // Blue-600: Royal blue
        700: '#1d4ed8',  // Blue-700: Deep blue
        800: '#1e40af',  // Blue-800: Navy
        900: '#1e3a8a',  // Blue-900: Dark navy
        950: '#172554',  // Blue-950: Midnight navy
      },

      // Success colors (Teal - fresh and natural)
      success: {
        50: '#f0fdfa',
        100: '#ccfbf1',
        200: '#99f6e4',
        500: '#14b8a6',  // Teal-500: Main success
        600: '#0d9488',
        700: '#0f766e',
        800: '#115e59',
        900: '#134e4a',
        950: '#042f2e',
      },

      // Warning colors (Amber - warm contrast)
      warning: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        500: '#f59e0b',  // Amber-500: Main warning
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
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

      // Mainnet colors (Deep navy blue - stable deep waters)
      mainnet: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        300: '#93c5fd',
        400: '#60a5fa',
        500: '#1e3a8a',  // Deep navy blue
        600: '#1e40af',
        700: '#1d4ed8',
        800: '#172554',
        900: '#0f172a',
        950: '#0a0f1a',
      },

      // Testnet colors (Seafoam - shallow experimental waters)
      testnet: {
        50: '#f0fdfa',
        100: '#ccfbf1',
        200: '#99f6e4',
        300: '#5eead4',
        400: '#2dd4bf',
        500: '#5eead4',  // Seafoam
        600: '#14b8a6',
        700: '#0d9488',
        800: '#0f766e',
        900: '#115e59',
        950: '#042f2e',
      },

      // Signet colors (Sandy gold - beach/shore)
      signet: {
        50: '#fefaed',
        100: '#faf0d0',
        200: '#f5e0a0',
        300: '#eecb6a',
        400: '#e5b440',
        500: '#d4a574',  // Sandy gold
        600: '#b88c4a',
        700: '#9a7038',
        800: '#7d5930',
        900: '#674a2a',
        950: '#3a2814',
      },
    },

    dark: {
      // Background colors (Deep ocean blues)
      bg: {
        50: '#f8fafc',   // Keep light for text
        100: '#f1f5f9',
        200: '#e2e8f0',
        300: '#cbd5e1',
        400: '#94a3b8',
        500: '#64748b',
        600: '#475569',
        700: '#334155',
        800: '#1e293b',  // Deep blue-gray panels
        900: '#0f172a',  // Main background
        950: '#020617',  // Darkest elements
      },

      // Primary colors (Luminescent ocean blue)
      primary: {
        50: '#172554',   // Dark navy (inverted)
        100: '#1e3a8a',
        200: '#1e40af',
        300: '#1d4ed8',
        400: '#2563eb',
        500: '#3b82f6',  // Bright blue accent
        600: '#60a5fa',
        700: '#93c5fd',
        800: '#bfdbfe',
        900: '#dbeafe',
        950: '#eff6ff',
      },

      // Success colors (Bright teal for dark mode)
      success: {
        50: '#042f2e',
        100: '#134e4a',
        200: '#115e59',
        500: '#2dd4bf',  // Brighter teal for dark mode
        600: '#5eead4',
        700: '#99f6e4',
        800: '#ccfbf1',
        900: '#f0fdfa',
        950: '#f0fdf4',
      },

      // Warning colors (Bioluminescent - deep sea glow)
      warning: {
        50: '#1a2e1a',
        100: '#2a4a2a',
        200: '#3d6a3d',
        500: '#a8e6a0',  // Bioluminescent green-yellow
        600: '#bdedb6',
        700: '#d0f4cb',
        800: '#e3fae0',
        900: '#f2fdf0',
        950: '#f8fef7',
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

      // Mainnet colors (Deep navy blue - inverted for dark)
      mainnet: {
        50: '#0a0f1a',
        100: '#0f172a',
        200: '#172554',
        300: '#1e3a8a',
        400: '#1e40af',
        500: '#3b82f6',  // Brighter navy for dark mode
        600: '#60a5fa',
        700: '#93c5fd',
        800: '#bfdbfe',
        900: '#dbeafe',
        950: '#eff6ff',
      },

      // Testnet colors (Seafoam - inverted for dark)
      testnet: {
        50: '#042f2e',
        100: '#115e59',
        200: '#0f766e',
        300: '#0d9488',
        400: '#14b8a6',
        500: '#5eead4',  // Bright seafoam
        600: '#99f6e4',
        700: '#ccfbf1',
        800: '#e0fef8',
        900: '#f0fdfa',
        950: '#f7fefc',
      },

      // Signet colors (Sandy gold - inverted for dark)
      signet: {
        50: '#3a2814',
        100: '#674a2a',
        200: '#7d5930',
        300: '#9a7038',
        400: '#b88c4a',
        500: '#e5b440',  // Brighter sandy gold
        600: '#eecb6a',
        700: '#f5e0a0',
        800: '#faf0d0',
        900: '#fefaed',
        950: '#fffdf5',
      },
    },
  },
};
