/**
 * Backgrounds Panel
 *
 * Search, category filtering, background grid, and seasonal section.
 */

import React, { useState } from 'react';
import { Search, X, Heart, Sparkles, Calendar, ChevronDown } from 'lucide-react';
import type { BackgroundOption, SeasonalBackgrounds } from '../../../../../types';
import { Season, themeRegistry } from '../../../../../themes';
import { CATEGORIES, BackgroundCategory, getBackgroundsByCategory } from '../../../../../themes/backgroundCategories';
import { seasonIcons } from '../iconMaps';

interface BackgroundInfo {
  id: BackgroundOption;
  name: string;
  icon: any;
}

interface BackgroundsPanelProps {
  currentBg: string;
  staticBackgrounds: BackgroundInfo[];
  animatedBackgrounds: BackgroundInfo[];
  favoriteBackgrounds: BackgroundOption[];
  userSeasonalBgs: SeasonalBackgrounds | undefined;
  onSelectBackground: (bg: BackgroundOption) => void;
  onToggleFavorite: (bg: BackgroundOption) => void;
  onUpdateSeasonBackground: (season: Season, background: string) => void;
}

export const BackgroundsPanel: React.FC<BackgroundsPanelProps> = ({
  currentBg,
  staticBackgrounds,
  animatedBackgrounds,
  favoriteBackgrounds,
  userSeasonalBgs,
  onSelectBackground,
  onToggleFavorite,
  onUpdateSeasonBackground,
}) => {
  const [activeCategory, setActiveCategory] = useState<BackgroundCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [seasonalExpanded, setSeasonalExpanded] = useState(false);

  const allBackgrounds = [...staticBackgrounds, ...animatedBackgrounds];

  const currentSeason = themeRegistry.getCurrentSeason();
  const seasonalBackground = themeRegistry.getSeasonalBackground(userSeasonalBgs);

  // Get the configured or default background for a specific season
  const getSeasonBackground = (season: Season): string => {
    if (userSeasonalBgs?.[season]) {
      return userSeasonalBgs[season] as string;
    }
    return themeRegistry.getDefaultSeasonalBackground(season);
  };

  // Filter backgrounds based on active category and search query
  const getFilteredBackgrounds = () => {
    let filtered: typeof allBackgrounds = [];

    if (activeCategory === 'all') {
      filtered = [...allBackgrounds];
    } else if (activeCategory === 'favorites') {
      filtered = allBackgrounds.filter(bg => favoriteBackgrounds.includes(bg.id));
    } else {
      const categoryBgIds = getBackgroundsByCategory(activeCategory);
      filtered = allBackgrounds.filter(bg => categoryBgIds.includes(bg.id));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(bg =>
        bg.name.toLowerCase().includes(query) ||
        bg.id.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  const filteredBackgrounds = getFilteredBackgrounds();

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Backgrounds</h3>
        <p className="text-sm text-sanctuary-500 mt-1">Select a background for your wallet</p>
      </div>
      <div className="p-6 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search backgrounds..."
            className="w-full pl-10 pr-10 py-2.5 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(category => {
            const isActive = activeCategory === category.id;
            const count = category.id === 'favorites'
              ? favoriteBackgrounds.length
              : getBackgroundsByCategory(category.id).length;

            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`
                  inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${isActive
                    ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-700'
                    : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                  }
                `}
              >
                <span className="mr-1.5">{category.icon}</span>
                <span>{category.label}</span>
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  isActive
                    ? 'bg-primary-200 dark:bg-primary-800 text-primary-800 dark:text-primary-200'
                    : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Background Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {filteredBackgrounds.length === 0 ? (
            <div className="col-span-full py-8 text-center text-sanctuary-500">
              {activeCategory === 'favorites' && favoriteBackgrounds.length === 0 ? (
                <div className="space-y-2">
                  <Heart className="w-8 h-8 mx-auto text-sanctuary-300 dark:text-sanctuary-600" />
                  <p className="text-sm">No favorites yet</p>
                  <p className="text-xs">Click the heart icon on any background to add it to your favorites</p>
                </div>
              ) : searchQuery ? (
                <p className="text-sm">No backgrounds match "{searchQuery}"</p>
              ) : (
                <p className="text-sm">No backgrounds in this category</p>
              )}
            </div>
          ) : (
            filteredBackgrounds.map(bg => {
              const isAnimated = animatedBackgrounds.some(ab => ab.id === bg.id);
              const isFavorite = favoriteBackgrounds.includes(bg.id);

              return (
                <div
                  key={bg.id}
                  className={`
                    relative rounded-xl border transition-all h-20 group
                    ${currentBg === bg.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400'
                      : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
                    }
                  `}
                >
                  {/* Main button area */}
                  <button
                    onClick={() => onSelectBackground(bg.id)}
                    className="w-full h-full p-3 flex flex-col items-center justify-center text-center"
                  >
                    <bg.icon className={`w-5 h-5 mb-2 ${currentBg === bg.id ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
                    <span className={`text-[10px] font-medium ${currentBg === bg.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>
                      {bg.name}
                    </span>
                  </button>

                  {/* Animated indicator */}
                  {isAnimated && (
                    <span className="absolute top-1 left-1">
                      <Sparkles className="w-3 h-3 text-primary-400" />
                    </span>
                  )}

                  {/* Favorite button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(bg.id);
                    }}
                    className={`
                      absolute top-1 right-1 p-1 rounded-full transition-all
                      ${isFavorite
                        ? 'text-rose-500'
                        : 'text-sanctuary-300 dark:text-sanctuary-600 opacity-0 group-hover:opacity-100 hover:text-rose-400'
                      }
                    `}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Time-Based / Seasonal - Collapsible */}
        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          {/* Collapsible Header with Toggle */}
          <div className="flex items-center justify-between p-3 -mx-3 rounded-xl hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors">
            <button
              onClick={() => setSeasonalExpanded(!seasonalExpanded)}
              className="flex items-center space-x-2 flex-1"
            >
              <Calendar className="w-4 h-4 text-primary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Seasonal Backgrounds</span>
              {!seasonalExpanded && (
                <span className="text-xs text-sanctuary-500 ml-2">
                  {themeRegistry.getSeasonName()} · {animatedBackgrounds.find(b => b.id === seasonalBackground)?.name || seasonalBackground}
                </span>
              )}
            </button>
            <div className="flex items-center space-x-3">
              {/* Enable/Disable Toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const isCurrentlySeasonal = currentBg === seasonalBackground;
                  onSelectBackground(
                    (isCurrentlySeasonal ? 'minimal' : seasonalBackground) as BackgroundOption
                  );
                }}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  currentBg === seasonalBackground
                    ? 'bg-primary-500'
                    : 'bg-sanctuary-300 dark:bg-sanctuary-600'
                }`}
                title={currentBg === seasonalBackground ? 'Disable seasonal background' : 'Enable seasonal background'}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    currentBg === seasonalBackground ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <button
                onClick={() => setSeasonalExpanded(!seasonalExpanded)}
                className="p-1"
              >
                <ChevronDown className={`w-4 h-4 text-sanctuary-400 transition-transform ${seasonalExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* Collapsible Content */}
          {seasonalExpanded && (
            <div className="mt-3 space-y-4">
              {/* Current Season Info */}
              <div className="flex items-center p-3 surface-secondary rounded-xl">
                <div className="flex items-center space-x-3">
                  {(() => {
                    const SeasonIcon = seasonIcons[currentSeason];
                    return <SeasonIcon className="w-5 h-5 text-primary-500" />;
                  })()}
                  <div>
                    <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      Current Season: {themeRegistry.getSeasonName()}
                    </div>
                    <div className="text-xs text-sanctuary-500">
                      Background: {animatedBackgrounds.find(b => b.id === seasonalBackground)?.name || seasonalBackground}
                    </div>
                  </div>
                </div>
              </div>

              {/* Season Configuration */}
              <div className="space-y-3">
                <p className="text-xs text-sanctuary-500">Configure which animated background appears for each season:</p>
                {(['spring', 'summer', 'fall', 'winter'] as const).map(season => {
                  const SeasonIcon = seasonIcons[season];
                  const isCurrentSeason = season === currentSeason;
                  const currentSeasonBg = getSeasonBackground(season);
                  const seasonNames: Record<Season, string> = {
                    spring: 'Spring',
                    summer: 'Summer',
                    fall: 'Autumn',
                    winter: 'Winter',
                  };

                  return (
                    <div
                      key={season}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        isCurrentSeason
                          ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/30'
                          : 'border-sanctuary-200 dark:border-sanctuary-700'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <SeasonIcon className={`w-5 h-5 ${isCurrentSeason ? 'text-primary-500' : 'text-sanctuary-400'}`} />
                        <span className={`text-sm font-medium ${isCurrentSeason ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-700 dark:text-sanctuary-300'}`}>
                          {seasonNames[season]}
                          {isCurrentSeason && <span className="ml-2 text-xs text-primary-500">(current)</span>}
                        </span>
                      </div>
                      <select
                        value={currentSeasonBg}
                        onChange={(e) => onUpdateSeasonBackground(season, e.target.value)}
                        className="text-sm bg-transparent border border-sanctuary-300 dark:border-sanctuary-600 rounded-lg px-3 py-1.5 text-sanctuary-700 dark:text-sanctuary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {animatedBackgrounds.map(bg => (
                          <option key={bg.id} value={bg.id}>
                            {bg.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
