import { Calendar, ChevronDown, Heart, Search, Sparkles, X } from 'lucide-react';
import type { ChangeEvent, MouseEvent } from 'react';
import { themeRegistry } from '../../../../../../themes';
import type { BackgroundsPanelController } from './useBackgroundsPanelController';
import type { BackgroundsPanelProps, BackgroundTileModel, CategoryTabModel, SeasonRowModel } from './types';

interface BackgroundsPanelViewProps {
  controller: BackgroundsPanelController;
  currentBg: string;
  animatedBackgrounds: BackgroundsPanelProps['animatedBackgrounds'];
  favoriteBackgrounds: BackgroundsPanelProps['favoriteBackgrounds'];
  onSelectBackground: BackgroundsPanelProps['onSelectBackground'];
  onToggleFavorite: BackgroundsPanelProps['onToggleFavorite'];
  onUpdateSeasonBackground: BackgroundsPanelProps['onUpdateSeasonBackground'];
}

export function BackgroundsPanelView({
  controller,
  currentBg,
  animatedBackgrounds,
  favoriteBackgrounds,
  onSelectBackground,
  onToggleFavorite,
  onUpdateSeasonBackground,
}: BackgroundsPanelViewProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <PanelHeader />
      <div className="p-6 space-y-4">
        <BackgroundSearch controller={controller} />
        <CategoryTabs
          tabs={controller.categoryTabs}
          onSelectCategory={controller.setActiveCategory}
        />
        <BackgroundGrid
          controller={controller}
          favoriteBackgrounds={favoriteBackgrounds}
          onSelectBackground={onSelectBackground}
          onToggleFavorite={onToggleFavorite}
        />
        <SeasonalSection
          controller={controller}
          currentBg={currentBg}
          animatedBackgrounds={animatedBackgrounds}
          onUpdateSeasonBackground={onUpdateSeasonBackground}
        />
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Backgrounds</h3>
      <p className="text-sm text-sanctuary-500 mt-1">Select a background for your wallet</p>
    </div>
  );
}

function BackgroundSearch({ controller }: { controller: BackgroundsPanelController }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
      <input
        type="text"
        value={controller.searchQuery}
        onChange={(event) => controller.setSearchQuery(event.target.value)}
        placeholder="Search backgrounds..."
        className="w-full pl-10 pr-10 py-2.5 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
      />
      {controller.searchQuery && (
        <button
          onClick={controller.clearSearchQuery}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function CategoryTabs({
  tabs,
  onSelectCategory,
}: {
  tabs: CategoryTabModel[];
  onSelectCategory: BackgroundsPanelController['setActiveCategory'];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => (
        <CategoryTabButton
          key={tab.id}
          tab={tab}
          onClick={() => onSelectCategory(tab.id)}
        />
      ))}
    </div>
  );
}

function CategoryTabButton({
  tab,
  onClick,
}: {
  tab: CategoryTabModel;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all
        ${tab.isActive
          ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-700'
          : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
        }
      `}
    >
      <span className="mr-1.5">{tab.icon}</span>
      <span>{tab.label}</span>
      <CategoryCountBadge tab={tab} />
    </button>
  );
}

function CategoryCountBadge({ tab }: { tab: CategoryTabModel }) {
  return (
    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
      tab.isActive
        ? 'bg-primary-200 dark:bg-primary-800 text-primary-800 dark:text-primary-200'
        : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400'
    }`}>
      {tab.count}
    </span>
  );
}

function BackgroundGrid({
  controller,
  favoriteBackgrounds,
  onSelectBackground,
  onToggleFavorite,
}: {
  controller: BackgroundsPanelController;
  favoriteBackgrounds: BackgroundsPanelProps['favoriteBackgrounds'];
  onSelectBackground: BackgroundsPanelProps['onSelectBackground'];
  onToggleFavorite: BackgroundsPanelProps['onToggleFavorite'];
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
      {controller.backgroundTiles.length === 0 ? (
        <EmptyBackgroundState
          activeCategory={controller.activeCategory}
          favoriteBackgrounds={favoriteBackgrounds}
          searchQuery={controller.searchQuery}
        />
      ) : (
        controller.backgroundTiles.map((background) => (
          <BackgroundTile
            key={background.id}
            background={background}
            onSelectBackground={onSelectBackground}
            onToggleFavorite={onToggleFavorite}
          />
        ))
      )}
    </div>
  );
}

function EmptyBackgroundState({
  activeCategory,
  favoriteBackgrounds,
  searchQuery,
}: Pick<BackgroundsPanelController, 'activeCategory' | 'searchQuery'> & {
  favoriteBackgrounds: BackgroundsPanelProps['favoriteBackgrounds'];
}) {
  return (
    <div className="col-span-full py-8 text-center text-sanctuary-500">
      {activeCategory === 'favorites' && favoriteBackgrounds.length === 0 ? (
        <EmptyFavorites />
      ) : searchQuery ? (
        <p className="text-sm">No backgrounds match "{searchQuery}"</p>
      ) : (
        <p className="text-sm">No backgrounds in this category</p>
      )}
    </div>
  );
}

function EmptyFavorites() {
  return (
    <div className="space-y-2">
      <Heart className="w-8 h-8 mx-auto text-sanctuary-300 dark:text-sanctuary-600" />
      <p className="text-sm">No favorites yet</p>
      <p className="text-xs">Click the heart icon on any background to add it to your favorites</p>
    </div>
  );
}

function BackgroundTile({
  background,
  onSelectBackground,
  onToggleFavorite,
}: {
  background: BackgroundTileModel;
  onSelectBackground: BackgroundsPanelProps['onSelectBackground'];
  onToggleFavorite: BackgroundsPanelProps['onToggleFavorite'];
}) {
  const Icon = background.icon;

  return (
    <div
      className={`
        relative rounded-lg border transition-all h-20 group
        ${background.isCurrent
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/50 ring-1 ring-primary-500 dark:ring-primary-400'
          : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
        }
      `}
    >
      <button
        onClick={() => onSelectBackground(background.id)}
        className="w-full h-full p-3 flex flex-col items-center justify-center text-center"
      >
        <Icon className={`w-5 h-5 mb-2 ${background.isCurrent ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
        <span className={`text-[10px] font-medium ${background.isCurrent ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-500'}`}>
          {background.name}
        </span>
      </button>
      <AnimatedIndicator isAnimated={background.isAnimated} />
      <FavoriteButton
        background={background}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

function AnimatedIndicator({ isAnimated }: { isAnimated: boolean }) {
  if (!isAnimated) return null;

  return (
    <span className="absolute top-1 left-1">
      <Sparkles className="w-3 h-3 text-primary-400" />
    </span>
  );
}

function FavoriteButton({
  background,
  onToggleFavorite,
}: {
  background: BackgroundTileModel;
  onToggleFavorite: BackgroundsPanelProps['onToggleFavorite'];
}) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleFavorite(background.id);
  };

  return (
    <button
      onClick={handleClick}
      className={`
        absolute top-1 right-1 p-1 rounded-full transition-all
        ${background.isFavorite
          ? 'text-rose-500'
          : 'text-sanctuary-300 dark:text-sanctuary-600 opacity-0 group-hover:opacity-100 hover:text-rose-400'
        }
      `}
      title={background.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart className={`w-3.5 h-3.5 ${background.isFavorite ? 'fill-current' : ''}`} />
    </button>
  );
}

function SeasonalSection({
  controller,
  currentBg,
  animatedBackgrounds,
  onUpdateSeasonBackground,
}: {
  controller: BackgroundsPanelController;
  currentBg: string;
  animatedBackgrounds: BackgroundsPanelProps['animatedBackgrounds'];
  onUpdateSeasonBackground: BackgroundsPanelProps['onUpdateSeasonBackground'];
}) {
  return (
    <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <SeasonalHeader controller={controller} currentBg={currentBg} />
      {controller.seasonalExpanded && (
        <SeasonalContent
          controller={controller}
          animatedBackgrounds={animatedBackgrounds}
          onUpdateSeasonBackground={onUpdateSeasonBackground}
        />
      )}
    </div>
  );
}

function SeasonalHeader({
  controller,
  currentBg,
}: {
  controller: BackgroundsPanelController;
  currentBg: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors">
      <button
        onClick={controller.toggleSeasonalExpanded}
        className="flex items-center space-x-2 flex-1"
      >
        <Calendar className="w-4 h-4 text-primary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Seasonal Backgrounds</span>
        <SeasonalSummary controller={controller} />
      </button>
      <div className="flex items-center space-x-3">
        <SeasonalToggle
          currentBg={currentBg}
          controller={controller}
        />
        <SeasonalExpandButton controller={controller} />
      </div>
    </div>
  );
}

function SeasonalSummary({ controller }: { controller: BackgroundsPanelController }) {
  if (controller.seasonalExpanded) return null;

  return (
    <span className="text-xs text-sanctuary-500 ml-2">
      {themeRegistry.getSeasonName()} · {controller.seasonalBackgroundName}
    </span>
  );
}

function SeasonalToggle({
  currentBg,
  controller,
}: {
  currentBg: string;
  controller: BackgroundsPanelController;
}) {
  const isCurrentSeasonal = currentBg === controller.seasonalBackground;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    controller.toggleSeasonalBackground();
  };

  return (
    <button
      onClick={handleClick}
      className={`relative w-9 h-5 rounded-full transition-colors ${
        isCurrentSeasonal ? 'bg-primary-500' : 'bg-sanctuary-300 dark:bg-sanctuary-600'
      }`}
      title={isCurrentSeasonal ? 'Disable seasonal background' : 'Enable seasonal background'}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          isCurrentSeasonal ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function SeasonalExpandButton({ controller }: { controller: BackgroundsPanelController }) {
  return (
    <button
      onClick={controller.toggleSeasonalExpanded}
      className="p-1"
    >
      <ChevronDown className={`w-4 h-4 text-sanctuary-400 transition-transform ${controller.seasonalExpanded ? 'rotate-180' : ''}`} />
    </button>
  );
}

function SeasonalContent({
  controller,
  animatedBackgrounds,
  onUpdateSeasonBackground,
}: {
  controller: BackgroundsPanelController;
  animatedBackgrounds: BackgroundsPanelProps['animatedBackgrounds'];
  onUpdateSeasonBackground: BackgroundsPanelProps['onUpdateSeasonBackground'];
}) {
  return (
    <div className="mt-3 space-y-4">
      <CurrentSeasonInfo controller={controller} />
      <SeasonConfiguration
        rows={controller.seasonRows}
        animatedBackgrounds={animatedBackgrounds}
        onUpdateSeasonBackground={onUpdateSeasonBackground}
      />
    </div>
  );
}

function CurrentSeasonInfo({ controller }: { controller: BackgroundsPanelController }) {
  const CurrentSeasonIcon = controller.seasonRows.find((row) => row.isCurrentSeason)?.Icon;

  return (
    <div className="flex items-center p-3 surface-secondary rounded-lg">
      <div className="flex items-center space-x-3">
        {CurrentSeasonIcon && <CurrentSeasonIcon className="w-5 h-5 text-primary-500" />}
        <div>
          <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Current Season: {themeRegistry.getSeasonName()}
          </div>
          <div className="text-xs text-sanctuary-500">
            Background: {controller.seasonalBackgroundName}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeasonConfiguration({
  rows,
  animatedBackgrounds,
  onUpdateSeasonBackground,
}: {
  rows: SeasonRowModel[];
  animatedBackgrounds: BackgroundsPanelProps['animatedBackgrounds'];
  onUpdateSeasonBackground: BackgroundsPanelProps['onUpdateSeasonBackground'];
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-sanctuary-500">Configure which animated background appears for each season:</p>
      {rows.map((row) => (
        <SeasonRow
          key={row.season}
          row={row}
          animatedBackgrounds={animatedBackgrounds}
          onUpdateSeasonBackground={onUpdateSeasonBackground}
        />
      ))}
    </div>
  );
}

function SeasonRow({
  row,
  animatedBackgrounds,
  onUpdateSeasonBackground,
}: {
  row: SeasonRowModel;
  animatedBackgrounds: BackgroundsPanelProps['animatedBackgrounds'];
  onUpdateSeasonBackground: BackgroundsPanelProps['onUpdateSeasonBackground'];
}) {
  const SeasonIcon = row.Icon;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onUpdateSeasonBackground(row.season, event.target.value);
  };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
        row.isCurrentSeason
          ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/30'
          : 'border-sanctuary-200 dark:border-sanctuary-700'
      }`}
    >
      <div className="flex items-center space-x-3">
        <SeasonIcon className={`w-5 h-5 ${row.isCurrentSeason ? 'text-primary-500' : 'text-sanctuary-400'}`} />
        <span className={`text-sm font-medium ${row.isCurrentSeason ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-700 dark:text-sanctuary-300'}`}>
          {row.label}
          {row.isCurrentSeason && <span className="ml-2 text-xs text-primary-500">(current)</span>}
        </span>
      </div>
      <select
        value={row.currentSeasonBg}
        onChange={handleChange}
        className="text-sm bg-transparent border border-sanctuary-300 dark:border-sanctuary-600 rounded-md px-3 py-1.5 text-sanctuary-700 dark:text-sanctuary-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {animatedBackgrounds.map((background) => (
          <option key={background.id} value={background.id}>
            {background.name}
          </option>
        ))}
      </select>
    </div>
  );
}
