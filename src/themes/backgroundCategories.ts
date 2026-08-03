/**
 * Background Categories
 *
 * Organizes registered backgrounds into intuitive categories for easier navigation.
 * A background can belong to multiple categories.
 */

import type { BackgroundOption } from '../types';
import { globalPatterns, type GlobalBackgroundPatternId } from './patterns';
import type { BackgroundCategory } from './types';

export type { BackgroundCategory } from './types';

export interface CategoryInfo {
  id: BackgroundCategory;
  label: string;
  icon: string; // Emoji for category display
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'all', label: 'All', icon: '◉' },
  { id: 'favorites', label: 'Favorites', icon: '★' },
  { id: 'minimal', label: 'Minimal', icon: '○' },
  { id: 'geometric', label: 'Geometric', icon: '◇' },
  { id: 'bitcoin', label: 'Bitcoin', icon: '₿' },
  { id: 'nature', label: 'Nature', icon: '🌿' },
  { id: 'weather', label: 'Weather', icon: '☁' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'zen', label: 'Zen', icon: '☯' },
  { id: 'sky', label: 'Sky', icon: '✦' },
  { id: 'creatures', label: 'Creatures', icon: '🦋' },
  { id: 'landscape', label: 'Landscape', icon: '⛰' },
  { id: 'whimsical', label: 'Whimsical', icon: '✨' },
];

export const BACKGROUND_CATEGORIES = Object.fromEntries(
  globalPatterns.map((pattern) => [pattern.id, pattern.categories])
) as Record<GlobalBackgroundPatternId, readonly BackgroundCategory[]>;

/**
 * Get all backgrounds in a specific category
 */
export function getBackgroundsByCategory(category: BackgroundCategory): BackgroundOption[] {
  if (category === 'favorites') {
    return [];
  }

  if (category === 'all') {
    return globalPatterns.map((pattern) => pattern.id as BackgroundOption);
  }

  return globalPatterns
    .filter((pattern) => pattern.categories.includes(category))
    .map((pattern) => pattern.id as BackgroundOption);
}

/**
 * Get all categories for a specific background
 */
export function getCategoriesForBackground(background: BackgroundOption): readonly BackgroundCategory[] {
  return BACKGROUND_CATEGORIES[background] || [];
}

/**
 * Search backgrounds by name (case-insensitive)
 */
export function searchBackgrounds(
  query: string,
  backgrounds: { id: BackgroundOption; name: string }[]
): { id: BackgroundOption; name: string }[] {
  const lowerQuery = query.toLowerCase();
  return backgrounds.filter(bg =>
    bg.name.toLowerCase().includes(lowerQuery) ||
    bg.id.toLowerCase().includes(lowerQuery)
  );
}
