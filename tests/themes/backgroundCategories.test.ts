/**
 * Background Categories Tests
 *
 * Tests for the background categorization system used in Settings.
 */

import {
  CATEGORIES,
  BACKGROUND_CATEGORIES,
  BackgroundCategory,
  getBackgroundsByCategory,
  getCategoriesForBackground,
  searchBackgrounds,
} from '../../themes/backgroundCategories';
import type { BackgroundOption } from '../../types';

describe('Background Categories', () => {
  describe('CATEGORIES constant', () => {
    it('should have all as the first category', () => {
      expect(CATEGORIES[0].id).toBe('all');
    });

    it('should have all required categories', () => {
      const expectedCategories: BackgroundCategory[] = [
        'all',
        'favorites',
        'minimal',
        'geometric',
        'bitcoin',
        'nature',
        'weather',
        'water',
        'zen',
        'sky',
        'creatures',
        'landscape',
        'whimsical',
      ];
      const categoryIds = CATEGORIES.map(c => c.id);
      expectedCategories.forEach(cat => {
        expect(categoryIds).toContain(cat);
      });
    });

    it('should have label and icon for each category', () => {
      CATEGORIES.forEach(category => {
        expect(category.label).toBeTruthy();
        expect(category.icon).toBeTruthy();
      });
    });
  });

  describe('BACKGROUND_CATEGORIES mapping', () => {
    it('should have categories for all backgrounds', () => {
      Object.entries(BACKGROUND_CATEGORIES).forEach(([bgId, categories]) => {
        expect(categories.length).toBeGreaterThan(0);
      });
    });

    it('should have valid category values', () => {
      const validCategories = CATEGORIES.map(c => c.id);
      Object.entries(BACKGROUND_CATEGORIES).forEach(([bgId, categories]) => {
        categories.forEach(cat => {
          expect(validCategories).toContain(cat);
        });
      });
    });

    it('should categorize zen background correctly', () => {
      expect(BACKGROUND_CATEGORIES['zen']).toContain('minimal');
      expect(BACKGROUND_CATEGORIES['zen']).toContain('zen');
    });

    it('should categorize bitcoin-particles correctly', () => {
      expect(BACKGROUND_CATEGORIES['bitcoin-particles']).toContain('bitcoin');
    });

    it('should categorize sakura-petals correctly', () => {
      expect(BACKGROUND_CATEGORIES['sakura-petals']).toContain('nature');
      expect(BACKGROUND_CATEGORIES['sakura-petals']).toContain('zen');
      expect(BACKGROUND_CATEGORIES['sakura-petals']).toContain('whimsical');
    });
  });

  describe('getBackgroundsByCategory', () => {
    it('should return backgrounds for minimal category', () => {
      const backgrounds = getBackgroundsByCategory('minimal');
      expect(backgrounds).toContain('minimal');
      expect(backgrounds).toContain('zen');
    });

    it('should return backgrounds for bitcoin category', () => {
      const backgrounds = getBackgroundsByCategory('bitcoin');
      expect(backgrounds).toContain('bitcoin-particles');
      expect(backgrounds).toContain('floating-shields');
    });

    it('should return backgrounds for zen category', () => {
      const backgrounds = getBackgroundsByCategory('zen');
      expect(backgrounds).toContain('zen');
      expect(backgrounds).toContain('koi-shadows');
    });

    it('should return empty array for favorites (managed by user preferences)', () => {
      // Favorites is a special category managed by user preferences
      const backgrounds = getBackgroundsByCategory('favorites');
      expect(backgrounds).toEqual([]);
    });

    it('should return all backgrounds for all category', () => {
      const backgrounds = getBackgroundsByCategory('all');
      // Should return all backgrounds that have categories defined
      expect(backgrounds.length).toBeGreaterThan(50);
      expect(backgrounds).toContain('minimal');
      expect(backgrounds).toContain('sakura-petals');
      expect(backgrounds).toContain('bitcoin-particles');
    });

    it('should return array type', () => {
      const backgrounds = getBackgroundsByCategory('nature');
      expect(Array.isArray(backgrounds)).toBe(true);
    });
  });

  describe('getCategoriesForBackground', () => {
    it('should return categories for zen', () => {
      const categories = getCategoriesForBackground('zen');
      expect(categories).toContain('minimal');
      expect(categories).toContain('zen');
    });

    it('should return categories for snowfall', () => {
      const categories = getCategoriesForBackground('snowfall');
      expect(categories).toContain('weather');
      expect(categories).toContain('whimsical');
    });

    it('should return categories for koi-shadows', () => {
      const categories = getCategoriesForBackground('koi-shadows');
      expect(categories).toContain('zen');
      expect(categories).toContain('creatures');
      expect(categories).toContain('water');
    });

    it('should return array type', () => {
      const categories = getCategoriesForBackground('minimal');
      expect(Array.isArray(categories)).toBe(true);
    });

    it('should return empty array for unknown background IDs', () => {
      const categories = getCategoriesForBackground('__unknown__' as BackgroundOption);
      expect(categories).toEqual([]);
    });
  });

  describe('searchBackgrounds', () => {
    const testBackgrounds = [
      { id: 'zen' as BackgroundOption, name: 'Zen' },
      { id: 'sakura-petals' as BackgroundOption, name: 'Sakura Petals' },
      { id: 'snowfall' as BackgroundOption, name: 'Snowfall' },
      { id: 'bitcoin-particles' as BackgroundOption, name: 'Bitcoin Particles' },
    ];

    it('should find backgrounds by name', () => {
      const results = searchBackgrounds('sakura', testBackgrounds);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('sakura-petals');
    });

    it('should find backgrounds by id', () => {
      const results = searchBackgrounds('bitcoin', testBackgrounds);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('bitcoin-particles');
    });

    it('should be case insensitive', () => {
      const results = searchBackgrounds('ZEN', testBackgrounds);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('zen');
    });

    it('should return multiple matches', () => {
      const results = searchBackgrounds('s', testBackgrounds);
      expect(results.length).toBeGreaterThan(1);
    });

    it('should return empty array for no matches', () => {
      const results = searchBackgrounds('nonexistent', testBackgrounds);
      expect(results).toEqual([]);
    });

    it('should handle empty query', () => {
      const results = searchBackgrounds('', testBackgrounds);
      expect(results.length).toBe(testBackgrounds.length);
    });
  });

  describe('Category Coverage', () => {
    it('should have no orphaned backgrounds (all should have at least one category)', () => {
      Object.entries(BACKGROUND_CATEGORIES).forEach(([bgId, categories]) => {
        expect(categories.length).toBeGreaterThan(0);
      });
    });

    it('each regular category should have at least one background', () => {
      CATEGORIES.forEach(category => {
        // Skip 'all' and 'favorites' as they're handled specially by the UI
        if (category.id !== 'favorites' && category.id !== 'all') {
          const backgrounds = getBackgroundsByCategory(category.id);
          expect(backgrounds.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
