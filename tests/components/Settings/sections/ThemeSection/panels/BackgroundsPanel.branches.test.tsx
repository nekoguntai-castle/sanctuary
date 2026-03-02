import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BackgroundsPanel } from '../../../../../../components/Settings/sections/ThemeSection/panels/BackgroundsPanel';

vi.mock('../../../../../../themes', () => ({
  Season: ['spring', 'summer', 'fall', 'winter'],
  themeRegistry: {
    getCurrentSeason: vi.fn(() => 'spring'),
    getSeasonName: vi.fn(() => 'Spring'),
    getSeasonalBackground: vi.fn((seasonalBackgrounds?: Record<string, string>) => seasonalBackgrounds?.spring || 'snowfall'),
    getDefaultSeasonalBackground: vi.fn(() => 'snowfall'),
  },
}));

vi.mock('../../../../../../themes/backgroundCategories', () => ({
  CATEGORIES: [
    { id: 'all', label: 'All', icon: 'A' },
    { id: 'favorites', label: 'Favorites', icon: 'F' },
  ],
  getBackgroundsByCategory: vi.fn((category: string) => {
    if (category === 'favorites') return ['minimal'];
    return ['minimal', 'snowfall'];
  }),
}));

const IconStub = () => <span data-testid="icon-stub" />;

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof BackgroundsPanel>> = {},
) => {
  const onSelectBackground = vi.fn();
  const onToggleFavorite = vi.fn();
  const onUpdateSeasonBackground = vi.fn();

  render(
    <BackgroundsPanel
      currentBg="minimal"
      staticBackgrounds={[{ id: 'minimal' as any, name: 'Minimal', icon: IconStub }]}
      animatedBackgrounds={[{ id: 'snowfall' as any, name: 'Snowfall', icon: IconStub }]}
      favoriteBackgrounds={[]}
      userSeasonalBgs={{ spring: 'snowfall' } as any}
      onSelectBackground={onSelectBackground}
      onToggleFavorite={onToggleFavorite}
      onUpdateSeasonBackground={onUpdateSeasonBackground}
      {...overrides}
    />
  );

  return { onSelectBackground, onToggleFavorite, onUpdateSeasonBackground };
};

describe('BackgroundsPanel branch coverage', () => {
  it('covers favorite-on branches for button/title/icon states', () => {
    const { onToggleFavorite } = renderPanel({
      favoriteBackgrounds: ['minimal' as any],
    });

    const removeButton = screen.getByTitle('Remove from favorites');
    expect(removeButton.className).toContain('text-rose-500');
    expect(removeButton.querySelector('svg')).toHaveClass('fill-current');

    const addButton = screen.getByTitle('Add to favorites');
    expect(addButton.className).toContain('text-sanctuary-300');

    fireEvent.click(removeButton);
    expect(onToggleFavorite).toHaveBeenCalledWith('minimal');
  });

  it('covers seasonal display fallback when configured background is not in animated list', () => {
    renderPanel({
      userSeasonalBgs: { spring: 'mystery-bg' } as any,
    });

    fireEvent.click(screen.getByRole('button', { name: /Seasonal Backgrounds/i }));
    expect(screen.getByText('Background: mystery-bg')).toBeInTheDocument();
  });
});
