# Sanctuary Wallet Theme System

This directory contains the extensible theme system for Sanctuary Wallet. Themes are modular and can be easily added without modifying core application code.

## Architecture Overview

The theme system consists of:

- **Theme Registry** (`registry.ts`) - Manages all registered themes and patterns
- **Theme Types** (`types.ts`) - TypeScript interfaces for themes
- **Global Patterns** (`patterns.ts`) - Backgrounds available to all themes
- **Theme Folders** - Each theme lives in its own directory

## Adding a New Theme

To add a new theme, follow these steps:

### 1. Create a Theme Folder

Create a new folder in `/src/themes` with your theme name:

```
/src/themes/
  └── my-awesome-theme/
      └── index.ts
```

### 2. Define Your Theme

Create an `index.ts` file that exports a `ThemeDefinition`:

```typescript
import type { ThemeDefinition } from '../types';

export const myAwesomeTheme: ThemeDefinition = {
  id: 'my-awesome-theme',
  name: 'My Awesome Theme',
  author: 'Your Name',
  version: '1.0.0',
  description: 'A brief description of your theme',

  colors: {
    light: {
      // Background colors (50-950 scale, lightest to darkest)
      bg: {
        50: '#ffffff',
        100: '#f5f5f5',
        // ... up to 950
      },

      // Primary colors (used for buttons, highlights, etc.)
      primary: {
        50: '#fff0f0',
        100: '#ffe0e0',
        // ... up to 950
      },

      // Success colors (positive actions, confirmations)
      success: {
        500: '#10b981',
        // Optional: define other shades
      },

      // Warning colors (caution, pending states)
      warning: {
        500: '#f59e0b',
        // Optional: define other shades
      },
    },

    dark: {
      // Same structure as light mode
      // Colors can be inverted or completely different
      bg: {
        50: '#1a1a1a',
        // ...
      },
      // ... etc
    },
  },

  // Optional: Theme-specific background patterns
  patterns: [
    {
      id: 'my-pattern',
      name: 'My Pattern',
      description: 'Optional description',
      categories: ['minimal'],
      iconKey: 'image',
      svgLight: 'data:image/svg+xml,...',
      svgDark: 'data:image/svg+xml,...',
    },
  ],
};
```

### 3. Register Your Theme

Add your theme to `/src/themes/index.ts`:

```typescript
import { myAwesomeTheme } from './my-awesome-theme';

themeRegistry.registerMany([
  sanctuaryTheme,
  serenityTheme,
  forestTheme,
  cyberTheme,
  myAwesomeTheme,  // Add your theme here
]);
```

### 4. Update Types (if needed)

If your theme ID is not dynamically generated, add it to `/types.ts`:

```typescript
export type ThemeOption = 'sanctuary' | 'serenity' | 'forest' | 'cyber' | 'my-awesome-theme';
```

### 5. Test Your Theme

Start the application and navigate to Settings > Personalization. Your theme should appear in the Color Theme selector.

## Color Scales Explained

Sanctuary uses Tailwind's 50-950 color scale system:

- **50-300**: Very light shades (text on dark backgrounds, light UI elements)
- **400-600**: Mid-tones (borders, muted elements)
- **700-950**: Dark shades (text on light backgrounds, dark UI elements)

### Color Mapping

- `bg-*`: Used for backgrounds, borders, structural elements
- `primary-*`: Used for themed elements (buttons, links, highlights)
- `success-*`: Used for positive actions (single-sig wallets, confirmations)
- `warning-*`: Used for cautions (multi-sig, pending transactions)

### Tailwind Classes

Your colors are accessible via Tailwind classes:

```tsx
<div className="bg-sanctuary-100 dark:bg-sanctuary-900">
  <h1 className="text-primary-600 dark:text-primary-400">Hello</h1>
  <button className="bg-success-500">Confirm</button>
</div>
```

## Backgrounds

### Global Backgrounds

Global backgrounds are defined in `patterns.ts`. This is the source of truth for background IDs, names, categories, icon keys, and animated/static metadata.

- `minimal` - No pattern
- `zen` - Dot grid
- `dots` - Polka dot grid
- `cross` - Crosshatch texture
- `noise` - Subtle grain texture
- `circuit` - Tech geometric
- `topography` - Map lines
- `waves` - Flowing water
- `lines` - Diagonal stripes
- `sanctuary` - Repeating logo
- `sanctuary-hero` - Large centered logo
- `hexagons` - Honeycomb grid
- `triangles` - Geometric tessellation
- `stars` - Starfield
- `aurora` - Gradient mesh waves
- `mountains` - Mountain silhouettes

Animated canvas backgrounds also live in `patterns.ts` with `animated: true`. The animation hook file must exist in `src/components/animations` using the kebab-case to camelCase convention, such as `paper-airplanes` -> `paperAirplanes.ts`.

To add a global background:

1. Add the pattern entry in `src/themes/patterns.ts`.
2. Add categories and an `iconKey` in the metadata maps in `src/themes/patterns.ts`.
3. Add static CSS in `index.html` or an animation hook in `src/components/animations`.
4. Update seasonal defaults in `src/themes/seasonal/index.ts` only if the background should be a seasonal default.
5. Run the focused background tests.

### Theme-Specific Patterns

Themes can define their own patterns by including a `patterns` array in the theme definition. These patterns will only appear when that theme is active. Prefer adding category and icon metadata before exposing theme-specific patterns in Settings.

## Example Themes

### Minimal Theme

```typescript
export const minimalTheme: ThemeDefinition = {
  id: 'minimal',
  name: 'Minimal',
  colors: {
    light: {
      bg: { 50: '#ffffff', 950: '#000000' },
      primary: { 500: '#333333' },
      success: { 500: '#22c55e' },
      warning: { 500: '#f59e0b' },
    },
    dark: {
      bg: { 50: '#000000', 950: '#ffffff' },
      primary: { 500: '#eeeeee' },
      success: { 500: '#22c55e' },
      warning: { 500: '#f59e0b' },
    },
  },
};
```

### Ocean Theme with Custom Pattern

```typescript
export const oceanTheme: ThemeDefinition = {
  id: 'ocean',
  name: 'Ocean',
  colors: {
    light: {
      bg: {
        50: '#f0f9ff',
        500: '#0ea5e9',
        950: '#0c4a6e',
      },
      primary: {
        500: '#0284c7',
      },
      success: { 500: '#10b981' },
      warning: { 500: '#f59e0b' },
    },
    // ... dark mode
  },
  patterns: [
    {
      id: 'ocean-waves',
      name: 'Ocean Waves',
      categories: ['water'],
      iconKey: 'waves',
      svgLight: 'data:image/svg+xml,%3Csvg...',
      svgDark: 'data:image/svg+xml,%3Csvg...',
    },
  ],
};
```

## Tips for Theme Development

1. **Start with light mode** - Get the light mode colors working first, then adapt for dark mode
2. **Use existing themes as reference** - Look at `/src/themes/sanctuary/index.ts` for a complete example
3. **Test both modes** - Always test your theme in both light and dark mode
4. **Consider accessibility** - Ensure sufficient contrast between text and backgrounds
5. **Use color tools** - Tools like [Coolors](https://coolors.co) or [Paletton](https://paletton.com) can help generate harmonious color scales
6. **Preview in app** - The Settings page shows a live preview of your theme

## Need Help?

Check out the existing themes for examples:
- `/src/themes/sanctuary` - Neutral, earthy theme
- `/src/themes/serenity` - Dual-personality theme (light = beach, dark = night sky)
- `/src/themes/forest` - Nature-inspired green theme
- `/src/themes/cyber` - Synthwave neon theme
