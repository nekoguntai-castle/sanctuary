import type { BackgroundOption, SeasonalBackgrounds } from '../../../../../../types';
import { themeRegistry, type Season } from '../../../../../../themes';
import type { BackgroundCategory, CategoryInfo } from '../../../../../../themes/backgroundCategories';
import { seasonIcons } from '../../iconMaps';
import type {
  BackgroundInfo,
  BackgroundTileModel,
  CategoryTabModel,
  SeasonRowModel,
} from './types';

const fallbackSeasonalBackground = 'minimal';

const seasonNames: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Autumn',
  winter: 'Winter',
};

const seasons: Season[] = ['spring', 'summer', 'fall', 'winter'];

export const getAllBackgrounds = (
  staticBackgrounds: BackgroundInfo[],
  animatedBackgrounds: BackgroundInfo[]
) => [...staticBackgrounds, ...animatedBackgrounds];

export const getAvailableBackgroundIds = (backgrounds: BackgroundInfo[]) => {
  return new Set(backgrounds.map((background) => background.id));
};

export const getSeasonBackground = (
  userSeasonalBgs: SeasonalBackgrounds | undefined,
  season: Season
) => {
  return userSeasonalBgs?.[season] || themeRegistry.getDefaultSeasonalBackground(season);
};

export const getBackgroundsForCategory = (
  category: BackgroundCategory,
  backgrounds: BackgroundInfo[],
  favoriteBackgrounds: BackgroundOption[]
) => {
  if (category === 'all') return backgrounds;
  if (category === 'favorites') {
    return backgrounds.filter((background) => favoriteBackgrounds.includes(background.id));
  }

  return backgrounds.filter((background) => background.categories.includes(category));
};

export const getFilteredBackgrounds = (
  backgrounds: BackgroundInfo[],
  searchQuery: string
) => {
  const query = searchQuery.trim().toLowerCase();

  if (!query) return backgrounds;

  return backgrounds.filter((background) => {
    return background.name.toLowerCase().includes(query) || background.id.toLowerCase().includes(query);
  });
};

export const getCategoryTabModel = ({
  category,
  activeCategory,
  allBackgrounds,
  favoriteBackgrounds,
  availableBackgroundIds,
}: {
  category: CategoryInfo;
  activeCategory: BackgroundCategory;
  allBackgrounds: BackgroundInfo[];
  favoriteBackgrounds: BackgroundOption[];
  availableBackgroundIds: Set<BackgroundOption>;
}): CategoryTabModel => ({
  id: category.id,
  label: category.label,
  icon: category.icon,
  count: getCategoryCount(category.id, allBackgrounds, favoriteBackgrounds, availableBackgroundIds),
  isActive: activeCategory === category.id,
});

export const getBackgroundTileModel = ({
  background,
  currentBg,
  animatedBackgrounds,
  favoriteBackgrounds,
}: {
  background: BackgroundInfo;
  currentBg: string;
  animatedBackgrounds: BackgroundInfo[];
  favoriteBackgrounds: BackgroundOption[];
}): BackgroundTileModel => ({
  ...background,
  isAnimated: animatedBackgrounds.some((animated) => animated.id === background.id),
  isCurrent: currentBg === background.id,
  isFavorite: favoriteBackgrounds.includes(background.id),
});

export const getSeasonalBackgroundName = (
  animatedBackgrounds: BackgroundInfo[],
  seasonalBackground: string
) => {
  return animatedBackgrounds.find((background) => background.id === seasonalBackground)?.name || seasonalBackground;
};

export const getSeasonalToggleBackground = (
  currentBg: string,
  seasonalBackground: string
): BackgroundOption => {
  return (currentBg === seasonalBackground ? fallbackSeasonalBackground : seasonalBackground) as BackgroundOption;
};

export const getSeasonRows = (
  userSeasonalBgs: SeasonalBackgrounds | undefined,
  currentSeason: Season
): SeasonRowModel[] => {
  return seasons.map((season) => ({
    season,
    label: seasonNames[season],
    Icon: seasonIcons[season],
    isCurrentSeason: season === currentSeason,
    currentSeasonBg: getSeasonBackground(userSeasonalBgs, season),
  }));
};

const getCategoryCount = (
  category: BackgroundCategory,
  allBackgrounds: BackgroundInfo[],
  favoriteBackgrounds: BackgroundOption[],
  availableBackgroundIds: Set<BackgroundOption>
) => {
  if (category === 'favorites') {
    return favoriteBackgrounds.filter((backgroundId) => availableBackgroundIds.has(backgroundId)).length;
  }

  return getBackgroundsForCategory(category, allBackgrounds, favoriteBackgrounds).length;
};
