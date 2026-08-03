/**
 * Sakura Yoshino Theme
 *
 * Inspired by the famous Yoshino cherry blossoms - the iconic variety
 * with near-white petals and the faintest blush of pink. Pure, minimalist,
 * and quintessentially Japanese spring.
 *
 * Light mode: Clean whites with barely-there pink blush, bamboo green accents
 * Dark mode: Soft charcoal with moonlit pale pink highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const sakuraYoshinoTheme: ThemeDefinition = {
  id: 'sakura-yoshino',
  name: 'Sakura Yoshino',
  author: 'Sanctuary Wallet Team',
  version: '1.0.0',
  description: 'Pure white petals with the faintest blush - iconic Japanese spring',

  colors: {
    light: {
      // Background colors (Clean white with warm undertones)
      bg: {
        50: '#fefefe',   // Pure white
        100: '#fcfbfa',  // Warm white
        200: '#f8f6f4',  // Soft cream-white
        300: '#f0ece8',  // Light warm gray
        400: '#d8d2cc',  // Muted warm
        500: '#a8a099',  // Warm gray
        600: '#7a746e',  // Medium gray
        700: '#524e4a',  // Dark gray
        800: '#343230',  // Charcoal
        900: '#201e1c',  // Near black
        950: '#100f0e',  // Darkest
      },

      // Primary colors (Near-white pink - Yoshino blossom)
      primary: {
        50: '#fffcfd',   // Pure white with pink
        100: '#fef8f9',  // Barely there pink
        200: '#fdf0f2',  // Whisper blush
        300: '#fae4e8',  // Faint petal
        400: '#f4d0d8',  // Light blush
        500: '#e8b8c4',  // Yoshino pink (main)
        600: '#d49aa8',  // Soft rose
        700: '#b87888',  // Muted rose
        800: '#966068',  // Dark rose
        900: '#784c52',  // Deep rose
        950: '#4a2c30',  // Darkest
      },

      // Success colors (Bamboo/muted green)
      success: {
        50: '#f7f8f6',
        100: '#ecf0ea',
        200: '#d8e2d4',
        500: '#6e8a66',  // Bamboo green
        600: '#56704e',
        700: '#445a3e',
        800: '#384a34',
        900: '#2e3e2c',
        950: '#182018',
      },

      // Warning colors (Soft warm - tea ceremony aesthetic)
      warning: {
        50: '#fdfcf8',
        100: '#faf6ec',
        200: '#f4ead6',
        500: '#c4a870',  // Warm matcha/tea
        600: '#a48a52',
        700: '#846e40',
        800: '#6a5834',
        900: '#56482c',
        950: '#302818',
      },

      // Sent colors (Soft gray-lavender)
      sent: {
        50: '#f8f7f9',
        100: '#f0eef2',
        200: '#e0dce6',
        500: '#8e8698',  // Soft gray-lavender
        600: '#706880',
        700: '#585266',
        800: '#464052',
        900: '#3a3542',
        950: '#201e24',
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

      // Mainnet colors (Yoshino pink)
      mainnet: {
        50: '#fffcfd',
        100: '#fef8f9',
        200: '#fdf0f2',
        300: '#fae4e8',
        400: '#f4d0d8',
        500: '#e8b8c4',  // Yoshino pink
        600: '#d49aa8',
        700: '#b87888',
        800: '#966068',
        900: '#784c52',
        950: '#4a2c30',
      },

      // Testnet colors (Bamboo green)
      testnet: {
        50: '#f7f8f6',
        100: '#ecf0ea',
        200: '#d8e2d4',
        300: '#baced4',
        400: '#92b086',
        500: '#6e8a66',  // Bamboo
        600: '#56704e',
        700: '#445a3e',
        800: '#384a34',
        900: '#2e3e2c',
        950: '#182018',
      },

      // Signet colors (Soft gray-lavender)
      signet: {
        50: '#f8f7f9',
        100: '#f0eef2',
        200: '#e0dce6',
        300: '#cac4d2',
        400: '#aea6ba',
        500: '#8e8698',  // Gray-lavender
        600: '#706880',
        700: '#585266',
        800: '#464052',
        900: '#3a3542',
        950: '#201e24',
      },
    },

    dark: {
      // Background colors (Soft charcoal - moonlit night)
      bg: {
        50: '#f0ece8',   // Light warm (for text)
        100: '#e0d8d2',  // Warm cream
        200: '#c8c0b8',  // Soft warm gray
        300: '#a89e94',  // Muted warm
        400: '#847a70',  // Medium warm gray
        500: '#625a52',  // Deep warm gray
        600: '#46403a',  // Dark warm
        700: '#302c28',  // Deep charcoal
        800: '#201e1c',  // Near black
        900: '#141312',  // Dark
        950: '#0a0908',  // Darkest
      },

      // Primary colors (Moonlit pale pink - soft glow)
      primary: {
        50: '#4a2c30',   // Deep shadow
        100: '#784c52',  // Dark rose
        200: '#966068',  // Muted rose
        300: '#b87888',  // Soft rose
        400: '#d49aa8',  // Light rose
        500: '#f0c8d0',  // Moonlit pink (main)
        600: '#f5d8de',  // Pale glow
        700: '#f8e6ea',  // Light glow
        800: '#fbf0f2',  // Near white
        900: '#fdf8f9',  // Almost white
        950: '#fefcfd',  // Pure white
      },

      // Success colors (Moonlit bamboo)
      success: {
        50: '#182018',
        100: '#2e3e2c',
        200: '#384a34',
        500: '#90b888',  // Moonlit bamboo
        600: '#a8c8a0',
        700: '#c0d8b8',
        800: '#d8e8d0',
        900: '#ecf4e8',
        950: '#f6faf4',
      },

      // Warning colors (Warm lantern)
      warning: {
        50: '#302818',
        100: '#56482c',
        200: '#6a5834',
        500: '#d8c090',  // Warm lantern
        600: '#e4d0a8',
        700: '#ece0c0',
        800: '#f4eed8',
        900: '#faf6ec',
        950: '#fdfcf8',
      },

      // Sent colors (Moonlit lavender)
      sent: {
        50: '#201e24',
        100: '#3a3542',
        200: '#464052',
        500: '#a8a0b0',  // Moonlit lavender
        600: '#bab4c2',
        700: '#ccc8d4',
        800: '#dedce6',
        900: '#f0eef4',
        950: '#f8f7fa',
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

      // Mainnet colors (Moonlit pink - inverted)
      mainnet: {
        50: '#4a2c30',
        100: '#784c52',
        200: '#966068',
        300: '#b87888',
        400: '#d49aa8',
        500: '#f0c8d0',  // Moonlit pink
        600: '#f5d8de',
        700: '#f8e6ea',
        800: '#fbf0f2',
        900: '#fdf8f9',
        950: '#fefcfd',
      },

      // Testnet colors (Moonlit bamboo - inverted)
      testnet: {
        50: '#182018',
        100: '#2e3e2c',
        200: '#384a34',
        300: '#445a3e',
        400: '#56704e',
        500: '#90b888',  // Moonlit bamboo
        600: '#a8c8a0',
        700: '#c0d8b8',
        800: '#d8e8d0',
        900: '#ecf4e8',
        950: '#f6faf4',
      },

      // Signet colors (Moonlit lavender - inverted)
      signet: {
        50: '#201e24',
        100: '#3a3542',
        200: '#464052',
        300: '#585266',
        400: '#706880',
        500: '#a8a0b0',  // Moonlit lavender
        600: '#bab4c2',
        700: '#ccc8d4',
        800: '#dedce6',
        900: '#f0eef4',
        950: '#f8f7fa',
      },
    },
  },
};
