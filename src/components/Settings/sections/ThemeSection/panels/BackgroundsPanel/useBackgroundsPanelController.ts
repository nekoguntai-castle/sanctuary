import { useMemo, useState } from 'react';
import { themeRegistry } from '../../../../../../themes';
import { CATEGORIES, type BackgroundCategory } from '../../../../../../themes/backgroundCategories';
import {
  getAllBackgrounds,
  getAvailableBackgroundIds,
  getBackgroundsForCategory,
  getBackgroundTileModel,
  getCategoryTabModel,
  getFilteredBackgrounds,
  getSeasonRows,
  getSeasonalBackgroundName,
  getSeasonalToggleBackground,
} from './backgroundsPanelHelpers';
import type {
  BackgroundsPanelProps,
  BackgroundTileModel,
  CategoryTabModel,
  SeasonRowModel,
} from './types';

export interface BackgroundsPanelController {
  activeCategory: BackgroundCategory;
  searchQuery: string;
  seasonalExpanded: boolean;
  currentSeason: ReturnType<typeof themeRegistry.getCurrentSeason>;
  seasonalBackground: string;
  seasonalBackgroundName: string;
  categoryTabs: CategoryTabModel[];
  backgroundTiles: BackgroundTileModel[];
  seasonRows: SeasonRowModel[];
  setActiveCategory: (category: BackgroundCategory) => void;
  setSearchQuery: (query: string) => void;
  clearSearchQuery: () => void;
  toggleSeasonalExpanded: () => void;
  toggleSeasonalBackground: () => void;
}

export const useBackgroundsPanelController = ({
  currentBg,
  staticBackgrounds,
  animatedBackgrounds,
  favoriteBackgrounds,
  userSeasonalBgs,
  onSelectBackground,
}: BackgroundsPanelProps): BackgroundsPanelController => {
  const [activeCategory, setActiveCategory] = useState<BackgroundCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [seasonalExpanded, setSeasonalExpanded] = useState(false);

  const allBackgrounds = useMemo(
    () => getAllBackgrounds(staticBackgrounds, animatedBackgrounds),
    [animatedBackgrounds, staticBackgrounds]
  );
  const availableBackgroundIds = useMemo(
    () => getAvailableBackgroundIds(allBackgrounds),
    [allBackgrounds]
  );
  const currentSeason = themeRegistry.getCurrentSeason();
  const seasonalBackground = themeRegistry.getSeasonalBackground(userSeasonalBgs);
  const seasonalBackgroundName = getSeasonalBackgroundName(animatedBackgrounds, seasonalBackground);

  const categoryTabs = useMemo(
    () =>
      CATEGORIES.map((category) =>
        getCategoryTabModel({
          category,
          activeCategory,
          allBackgrounds,
          favoriteBackgrounds,
          availableBackgroundIds,
        })
      ),
    [activeCategory, allBackgrounds, availableBackgroundIds, favoriteBackgrounds]
  );

  const backgroundTiles = useMemo(() => {
    const backgroundsForCategory = getBackgroundsForCategory(
      activeCategory,
      allBackgrounds,
      favoriteBackgrounds
    );
    const filteredBackgrounds = getFilteredBackgrounds(backgroundsForCategory, searchQuery);

    return filteredBackgrounds.map((background) =>
      getBackgroundTileModel({
        background,
        currentBg,
        animatedBackgrounds,
        favoriteBackgrounds,
      })
    );
  }, [activeCategory, allBackgrounds, animatedBackgrounds, currentBg, favoriteBackgrounds, searchQuery]);

  const seasonRows = useMemo(
    () => getSeasonRows(userSeasonalBgs, currentSeason),
    [currentSeason, userSeasonalBgs]
  );

  return {
    activeCategory,
    searchQuery,
    seasonalExpanded,
    currentSeason,
    seasonalBackground,
    seasonalBackgroundName,
    categoryTabs,
    backgroundTiles,
    seasonRows,
    setActiveCategory,
    setSearchQuery,
    clearSearchQuery: () => setSearchQuery(''),
    toggleSeasonalExpanded: () => setSeasonalExpanded((expanded) => !expanded),
    toggleSeasonalBackground: () => {
      onSelectBackground(getSeasonalToggleBackground(currentBg, seasonalBackground));
    },
  };
};
