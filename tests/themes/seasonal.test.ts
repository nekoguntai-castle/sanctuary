/**
 * Seasonal Theme Tests
 *
 * Tests for the season detection utilities, background mapping,
 * and seasonal color palettes.
 */

import {
getCurrentSeason,
getSeasonalBackground,
getSeasonalColors,
getSeasonName,
seasonalPalettes,
type Season,
} from '../../src/themes/seasonal';

describe('Season Detection', () => {
  describe('getCurrentSeason - Northern Hemisphere', () => {
    it('should return spring for March (month 2)', () => {
      const date = new Date(2024, 2, 15); // March 15
      expect(getCurrentSeason(date, 'north')).toBe('spring');
    });

    it('should return spring for April (month 3)', () => {
      const date = new Date(2024, 3, 15); // April 15
      expect(getCurrentSeason(date, 'north')).toBe('spring');
    });

    it('should return spring for May (month 4)', () => {
      const date = new Date(2024, 4, 15); // May 15
      expect(getCurrentSeason(date, 'north')).toBe('spring');
    });

    it('should return summer for June (month 5)', () => {
      const date = new Date(2024, 5, 15); // June 15
      expect(getCurrentSeason(date, 'north')).toBe('summer');
    });

    it('should return summer for July (month 6)', () => {
      const date = new Date(2024, 6, 15); // July 15
      expect(getCurrentSeason(date, 'north')).toBe('summer');
    });

    it('should return summer for August (month 7)', () => {
      const date = new Date(2024, 7, 15); // August 15
      expect(getCurrentSeason(date, 'north')).toBe('summer');
    });

    it('should return fall for September (month 8)', () => {
      const date = new Date(2024, 8, 15); // September 15
      expect(getCurrentSeason(date, 'north')).toBe('fall');
    });

    it('should return fall for October (month 9)', () => {
      const date = new Date(2024, 9, 15); // October 15
      expect(getCurrentSeason(date, 'north')).toBe('fall');
    });

    it('should return fall for November (month 10)', () => {
      const date = new Date(2024, 10, 15); // November 15
      expect(getCurrentSeason(date, 'north')).toBe('fall');
    });

    it('should return winter for December (month 11)', () => {
      const date = new Date(2024, 11, 15); // December 15
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });

    it('should return winter for January (month 0)', () => {
      const date = new Date(2024, 0, 15); // January 15
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });

    it('should return winter for February (month 1)', () => {
      const date = new Date(2024, 1, 15); // February 15
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });
  });

  describe('getCurrentSeason - Southern Hemisphere', () => {
    it('should return fall for March in southern hemisphere', () => {
      const date = new Date(2024, 2, 15); // March 15
      expect(getCurrentSeason(date, 'south')).toBe('fall');
    });

    it('should return winter for June in southern hemisphere', () => {
      const date = new Date(2024, 5, 15); // June 15
      expect(getCurrentSeason(date, 'south')).toBe('winter');
    });

    it('should return spring for September in southern hemisphere', () => {
      const date = new Date(2024, 8, 15); // September 15
      expect(getCurrentSeason(date, 'south')).toBe('spring');
    });

    it('should return summer for December in southern hemisphere', () => {
      const date = new Date(2024, 11, 15); // December 15
      expect(getCurrentSeason(date, 'south')).toBe('summer');
    });
  });

  describe('getCurrentSeason - Default behavior', () => {
    it('should default to northern hemisphere when not specified', () => {
      const date = new Date(2024, 5, 15); // June 15
      expect(getCurrentSeason(date)).toBe('summer');
    });

    it('should use current date when no date provided', () => {
      const result = getCurrentSeason();
      expect(['spring', 'summer', 'fall', 'winter']).toContain(result);
    });
  });

  describe('getCurrentSeason - Edge cases', () => {
    it('should handle season boundary - last day of winter (Feb 28)', () => {
      const date = new Date(2024, 1, 28); // February 28
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });

    it('should handle season boundary - first day of spring (March 1)', () => {
      const date = new Date(2024, 2, 1); // March 1
      expect(getCurrentSeason(date, 'north')).toBe('spring');
    });

    it('should handle leap year February 29', () => {
      const date = new Date(2024, 1, 29); // February 29, 2024 (leap year)
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });

    it('should handle New Years Eve', () => {
      const date = new Date(2024, 11, 31); // December 31
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });

    it('should handle New Years Day', () => {
      const date = new Date(2024, 0, 1); // January 1
      expect(getCurrentSeason(date, 'north')).toBe('winter');
    });
  });
});

describe('Seasonal Background Mapping', () => {
  describe('getSeasonalBackground', () => {
    it('should return sakura-petals for spring', () => {
      expect(getSeasonalBackground('spring')).toBe('sakura-petals');
    });

    it('should return fireflies for summer', () => {
      expect(getSeasonalBackground('summer')).toBe('fireflies');
    });

    it('should return falling-leaves for fall', () => {
      expect(getSeasonalBackground('fall')).toBe('falling-leaves');
    });

    it('should return snowfall for winter', () => {
      expect(getSeasonalBackground('winter')).toBe('snowfall');
    });
  });

  describe('All seasons have unique backgrounds', () => {
    it('should have different backgrounds for each season', () => {
      const seasons: Season[] = ['spring', 'summer', 'fall', 'winter'];
      const backgrounds = seasons.map(s => getSeasonalBackground(s));
      const uniqueBackgrounds = new Set(backgrounds);
      expect(uniqueBackgrounds.size).toBe(4);
    });
  });
});

describe('Season Display Names', () => {
  describe('getSeasonName', () => {
    it('should return "Spring" for spring', () => {
      expect(getSeasonName('spring')).toBe('Spring');
    });

    it('should return "Summer" for summer', () => {
      expect(getSeasonName('summer')).toBe('Summer');
    });

    it('should return "Autumn" for fall', () => {
      expect(getSeasonName('fall')).toBe('Autumn');
    });

    it('should return "Winter" for winter', () => {
      expect(getSeasonName('winter')).toBe('Winter');
    });
  });
});

describe('Seasonal Color Palettes', () => {
  describe('seasonalPalettes structure', () => {
    const seasons: Season[] = ['spring', 'summer', 'fall', 'winter'];

    seasons.forEach(season => {
      describe(`${season} palette`, () => {
        it('should have light and dark modes', () => {
          expect(seasonalPalettes[season]).toHaveProperty('light');
          expect(seasonalPalettes[season]).toHaveProperty('dark');
        });

        it('should have bg colors in light mode', () => {
          expect(seasonalPalettes[season].light).toHaveProperty('bg');
        });

        it('should have bg colors in dark mode', () => {
          expect(seasonalPalettes[season].dark).toHaveProperty('bg');
        });

        it('should have primary colors in light mode', () => {
          expect(seasonalPalettes[season].light).toHaveProperty('primary');
        });

        it('should have primary colors in dark mode', () => {
          expect(seasonalPalettes[season].dark).toHaveProperty('primary');
        });

        it('should have success colors', () => {
          expect(seasonalPalettes[season].light).toHaveProperty('success');
          expect(seasonalPalettes[season].dark).toHaveProperty('success');
        });

        it('should have warning colors', () => {
          expect(seasonalPalettes[season].light).toHaveProperty('warning');
          expect(seasonalPalettes[season].dark).toHaveProperty('warning');
        });
      });
    });
  });

  describe('getSeasonalColors', () => {
    it('should return spring colors for spring', () => {
      const colors = getSeasonalColors('spring');
      expect(colors).toBe(seasonalPalettes.spring);
    });

    it('should return summer colors for summer', () => {
      const colors = getSeasonalColors('summer');
      expect(colors).toBe(seasonalPalettes.summer);
    });

    it('should return fall colors for fall', () => {
      const colors = getSeasonalColors('fall');
      expect(colors).toBe(seasonalPalettes.fall);
    });

    it('should return winter colors for winter', () => {
      const colors = getSeasonalColors('winter');
      expect(colors).toBe(seasonalPalettes.winter);
    });
  });

  describe('Color format validation', () => {
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    const seasons: Season[] = ['spring', 'summer', 'fall', 'winter'];

    seasons.forEach(season => {
      it(`${season} light bg.50 should be valid hex color`, () => {
        expect(seasonalPalettes[season].light.bg[50]).toMatch(hexColorRegex);
      });

      it(`${season} dark bg.950 should be valid hex color`, () => {
        expect(seasonalPalettes[season].dark.bg[950]).toMatch(hexColorRegex);
      });

      it(`${season} primary.500 should be valid hex color`, () => {
        expect(seasonalPalettes[season].light.primary[500]).toMatch(hexColorRegex);
      });
    });
  });
});

describe('Integration: Season to Theme Pipeline', () => {
  it('should get correct background for current season', () => {
    const season = getCurrentSeason();
    const background = getSeasonalBackground(season);
    const expectedBackgrounds = ['sakura-petals', 'fireflies', 'falling-leaves', 'snowfall'];
    expect(expectedBackgrounds).toContain(background);
  });

  it('should get valid colors for current season', () => {
    const season = getCurrentSeason();
    const colors = getSeasonalColors(season);
    expect(colors).toHaveProperty('light');
    expect(colors).toHaveProperty('dark');
    expect(colors.light).toHaveProperty('bg');
    expect(colors.light).toHaveProperty('primary');
  });

  it('should have display name for current season', () => {
    const season = getCurrentSeason();
    const name = getSeasonName(season);
    expect(['Spring', 'Summer', 'Autumn', 'Winter']).toContain(name);
  });
});
