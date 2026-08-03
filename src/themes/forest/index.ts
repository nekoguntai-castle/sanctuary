/**
 * Forest Theme
 *
 * Light mode: Sunlit forest clearing with warm dappled light, moss, and ferns
 * Dark mode: Deep woods at twilight with rich bark and soft moss highlights
 *
 * Author: Sanctuary Wallet Team
 */

import type { ThemeDefinition } from '../types';

export const forestTheme: ThemeDefinition = {
  id: 'forest',
  name: 'Forest',
  author: 'Sanctuary Wallet Team',
  version: '2.0.0',
  description: 'Sunlit clearing in light mode, deep woods twilight in dark mode',

  colors: {
    light: {
      // Background colors (Warm dappled sunlight through leaves)
      bg: {
        50: '#fdfcf8',   // Bright sunlight
        100: '#f8f6ef',  // Warm cream
        200: '#f0ebe0',  // Parchment
        300: '#e4ddd0',  // Dried leaf
        400: '#c4b9a4',  // Weathered wood
        500: '#8c8272',  // Bark
        600: '#6b6355',  // Dark bark
        700: '#4a4438',  // Deep shadow
        800: '#2e2a22',  // Forest floor
        900: '#1a1814',  // Deep shade
        950: '#0d0c0a',  // Darkness
      },

      // Primary colors (Deep forest green / moss)
      primary: {
        50: '#f2f8f4',   // Lightest moss
        100: '#e0efe4',  // Pale fern
        200: '#c3dfcc',  // Soft sage
        300: '#98c7a8',  // Light moss
        400: '#6aab7f',  // Fern green
        500: '#4a8f62',  // Forest green (main)
        600: '#3a7350',  // Deep forest
        700: '#315c43',  // Dark moss
        800: '#2b4a38',  // Shadow green
        900: '#253d30',  // Deep woods
        950: '#122119',  // Darkest green
      },

      // Success colors (Fresh spring fern)
      success: {
        50: '#f4faf3',
        100: '#e5f4e3',
        200: '#cce9c8',
        500: '#5cb85c',  // Fresh leaf
        600: '#4a9a4a',
        700: '#3d7d3d',
        800: '#346434',
      },

      // Warning colors (Autumn gold / chanterelle mushroom)
      warning: {
        50: '#fdf8ed',
        100: '#f9edcf',
        200: '#f3db9e',
        500: '#d4a24a',  // Golden chanterelle
        600: '#b8862e',
        700: '#966a1f',
        800: '#7a541a',
      },

      // Sent colors (Wild violet / woodland flower)
      sent: {
        50: '#f8f5fc',
        100: '#f0eaf8',
        200: '#e2d6f2',
        500: '#8e6bb8',  // Wild violet
        600: '#755699',
        700: '#5e447a',
        800: '#4a3660',
        900: '#3b2c4d',
        950: '#241b30',
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

      // Mainnet colors (Deep evergreen)
      mainnet: {
        50: '#effaf4',
        100: '#d8f3e4',
        200: '#b4e6cd',
        300: '#82d3ad',
        400: '#4eb888',
        500: '#2d9a6a',  // Evergreen
        600: '#207c55',
        700: '#1c6346',
        800: '#1a4f3a',
        900: '#174130',
        950: '#0a241a',
      },

      // Testnet colors (Autumn amber)
      testnet: {
        50: '#fefaed',
        100: '#fbf1cb',
        200: '#f7e193',
        300: '#f2cb54',
        400: '#edb52a',
        500: '#db9812',  // Golden autumn
        600: '#b8740d',
        700: '#93540f',
        800: '#794313',
        900: '#653813',
        950: '#3a1c06',
      },

      // Signet colors (Forest berry purple)
      signet: {
        50: '#fbf6fd',
        100: '#f5ebfa',
        200: '#edd9f5',
        300: '#dfbdec',
        400: '#cc96de',
        500: '#b46dcb',  // Elderberry
        600: '#984eab',
        700: '#7e3f8c',
        800: '#683673',
        900: '#57305f',
        950: '#36153d',
      },
    },

    dark: {
      // Background colors (Deep forest at twilight - bark and shadow)
      bg: {
        50: '#e8e4dc',   // Pale lichen (for text)
        100: '#d4cfc4',  // Light bark
        200: '#b8b1a3',  // Weathered wood
        300: '#968d7c',  // Aged bark
        400: '#736a5a',  // Dark wood
        500: '#544d40',  // Deep bark
        600: '#3d3830',  // Forest shadow
        700: '#2a2620',  // Deep twilight
        800: '#1c1a16',  // Dark understory
        900: '#121110',  // Night forest
        950: '#0a0908',  // Deepest shadow
      },

      // Primary colors (Soft moss / lichen glow)
      primary: {
        50: '#1a2a1f',   // Deep moss shadow
        100: '#243828',  // Dark fern
        200: '#324a38',  // Forest shadow
        300: '#4a6850',  // Twilight green
        400: '#6a8a70',  // Soft moss
        500: '#8aaa8f',  // Lichen (main)
        600: '#a6c2aa',  // Pale moss
        700: '#c2d8c5',  // Light lichen
        800: '#ddeadf',  // Moonlit moss
        900: '#eef5ef',  // Brightest
        950: '#f8fbf8',  // Pure light
      },

      // Success colors (Firefly / bioluminescent glow)
      success: {
        50: '#162a1a',
        100: '#1e3d22',
        200: '#2a5430',
        500: '#68d878',  // Firefly glow
        600: '#8ae496',
        700: '#adefb4',
        800: '#cff7d4',
        900: '#e8fcea',
        950: '#f4fef5',
      },

      // Warning colors (Distant campfire amber)
      warning: {
        50: '#2a1f0d',
        100: '#3d2c10',
        200: '#574016',
        500: '#e0a84a',  // Campfire glow
        600: '#e8bc6e',
        700: '#f0cf92',
        800: '#f6e0b6',
        900: '#faf0da',
        950: '#fdf8ed',
      },

      // Sent colors (Night violet - inverted)
      sent: {
        50: '#241b30',
        100: '#3b2c4d',
        200: '#4a3660',
        500: '#a888cc',  // Twilight violet
        600: '#baa0d8',
        700: '#ccb8e4',
        800: '#ddd0ef',
        900: '#eee8f7',
        950: '#f8f5fc',
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

      // Mainnet colors (Evergreen - inverted for dark)
      mainnet: {
        50: '#0a241a',
        100: '#174130',
        200: '#1a4f3a',
        300: '#1c6346',
        400: '#207c55',
        500: '#2d9a6a',
        600: '#4eb888',
        700: '#82d3ad',
        800: '#b4e6cd',
        900: '#d8f3e4',
        950: '#effaf4',
      },

      // Testnet colors (Autumn amber - inverted)
      testnet: {
        50: '#3a1c06',
        100: '#653813',
        200: '#794313',
        300: '#93540f',
        400: '#b8740d',
        500: '#db9812',
        600: '#edb52a',
        700: '#f2cb54',
        800: '#f7e193',
        900: '#fbf1cb',
        950: '#fefaed',
      },

      // Signet colors (Forest berry - inverted)
      signet: {
        50: '#36153d',
        100: '#57305f',
        200: '#683673',
        300: '#7e3f8c',
        400: '#984eab',
        500: '#b46dcb',
        600: '#cc96de',
        700: '#dfbdec',
        800: '#edd9f5',
        900: '#f5ebfa',
        950: '#fbf6fd',
      },
    },
  },
};
