import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceTab } from '../../components/Settings/sections/ThemeSection';

const mockUpdatePreferences = vi.fn();

let mockUser: {
  preferences: {
    theme?: string;
    background?: string;
    darkMode?: boolean;
    seasonalBackgrounds?: Record<string, string>;
    favoriteBackgrounds?: string[];
    contrastLevel?: number;
    patternOpacity?: number;
  };
} | null = null;

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockUser,
    updatePreferences: mockUpdatePreferences,
  }),
}));

vi.mock('../../themes', () => ({
  Season: ['spring', 'summer', 'fall', 'winter'],
  themeRegistry: {
    getAllMetadata: vi.fn(() => [
      { id: 'sanctuary', name: 'Sanctuary', preview: { primaryColor: '#7d7870' } },
      { id: 'dark', name: 'Dark', preview: { primaryColor: '#111827' } },
    ]),
    getCurrentSeason: vi.fn(() => 'spring'),
    getSeasonName: vi.fn(() => 'Spring'),
    getSeasonalBackground: vi.fn((seasonalBackgrounds?: Record<string, string>) => seasonalBackgrounds?.spring || 'snowfall'),
    getDefaultSeasonalBackground: vi.fn(() => 'snowfall'),
    getAllPatterns: vi.fn(() => [
      { id: 'minimal', name: 'Minimal', animated: false },
      { id: 'zen', name: 'Zen', animated: false },
      { id: 'snowfall', name: 'Snowfall', animated: true },
      { id: 'sakura-redux', name: 'Sakura Redux', animated: true },
    ]),
  },
}));

vi.mock('../../themes/backgroundCategories', () => ({
  CATEGORIES: [
    { id: 'all', label: 'All', icon: 'A' },
    { id: 'favorites', label: 'Favorites', icon: 'F' },
    { id: 'nature', label: 'Nature', icon: 'N' },
  ],
  getBackgroundsByCategory: vi.fn((category: string) => {
    if (category === 'favorites') return ['snowfall'];
    if (category === 'nature') return ['snowfall', 'sakura-redux'];
    return ['minimal', 'zen', 'snowfall', 'sakura-redux'];
  }),
}));

vi.mock('../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: () => <span data-testid="sanctuary-logo" />,
  SatsIcon: () => <span data-testid="sats-icon" />,
}));

function renderWithUser(overrides?: Partial<NonNullable<typeof mockUser>['preferences']>) {
  mockUser = {
    preferences: {
      theme: 'sanctuary',
      background: 'minimal',
      darkMode: false,
      seasonalBackgrounds: { spring: 'snowfall' },
      favoriteBackgrounds: [],
      contrastLevel: 0,
      patternOpacity: 50,
      ...overrides,
    },
  };

  return render(<AppearanceTab />);
}

function getCategoryButton(label: string): HTMLButtonElement {
  const buttons = screen.getAllByRole('button');
  const match = buttons.find(
    (button) =>
      button.className.includes('inline-flex items-center px-3') &&
      button.textContent?.includes(label),
  );
  if (!match) {
    throw new Error(`Category button not found: ${label}`);
  }
  return match as HTMLButtonElement;
}

function getBackgroundTileButton(name: string): HTMLButtonElement {
  const labels = screen.getAllByText(name);
  const tileLabel = labels.find((label) => label.closest('button')?.className.includes('w-full h-full p-3'));
  const button = tileLabel?.closest('button');
  if (!button) {
    throw new Error(`Background tile button not found: ${name}`);
  }
  return button as HTMLButtonElement;
}

describe('AppearanceTab (ThemeSection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates theme/background and toggles favorites', async () => {
    const user = userEvent.setup();
    renderWithUser();

    await user.click(screen.getByRole('button', { name: /Dark/i }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ theme: 'dark' });

    await user.click(getBackgroundTileButton('Snowfall'));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ background: 'snowfall' });

    const snowfallTile = getBackgroundTileButton('Snowfall').closest('div');
    const snowfallFavorite = snowfallTile?.querySelector('button[title="Add to favorites"]');
    expect(snowfallFavorite).not.toBeNull();
    await user.click(snowfallFavorite as HTMLButtonElement);
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ favoriteBackgrounds: ['snowfall'] });
  });

  it('handles category filters, favorites empty state, and search clear', async () => {
    const user = userEvent.setup();
    renderWithUser();

    await user.click(getCategoryButton('Nature'));
    expect(screen.getByText('Sakura Redux')).toBeInTheDocument();
    expect(screen.queryByText('Minimal')).not.toBeInTheDocument();

    await user.click(getCategoryButton('Favorites'));
    expect(screen.getByText('No favorites yet')).toBeInTheDocument();

    await user.click(getCategoryButton('All'));
    const search = screen.getByPlaceholderText('Search backgrounds...');
    await user.type(search, 'does-not-exist');
    expect(screen.getByText('No backgrounds match "does-not-exist"')).toBeInTheDocument();

    const clearSearchButton = search.parentElement?.querySelector('button');
    expect(clearSearchButton).not.toBeNull();
    await user.click(clearSearchButton as HTMLButtonElement);
    expect(search).toHaveValue('');
  });

  it('supports seasonal background toggle and per-season configuration', async () => {
    const user = userEvent.setup();

    renderWithUser({ background: 'minimal', seasonalBackgrounds: { spring: 'snowfall', summer: 'sakura-redux' } });
    await user.click(screen.getByRole('button', { name: /Seasonal Backgrounds/i }));

    const enableSeasonal = screen.getByTitle('Enable seasonal background');
    await user.click(enableSeasonal);
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ background: 'snowfall' });

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'sakura-redux' } });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      seasonalBackgrounds: {
        spring: 'sakura-redux',
        summer: 'sakura-redux',
      },
    });
  });

  it('disables seasonal mode when already using current seasonal background', async () => {
    const user = userEvent.setup();
    renderWithUser({ background: 'snowfall', seasonalBackgrounds: { spring: 'snowfall' } });

    const disableSeasonal = screen.getByTitle('Disable seasonal background');
    await user.click(disableSeasonal);
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ background: 'minimal' });
  });

  it('toggles seasonal expansion using the chevron button control', async () => {
    const user = userEvent.setup();
    renderWithUser();

    const chevronToggle = Array.from(document.querySelectorAll('button.p-1')).find((button) =>
      button.querySelector('svg.lucide-chevron-down')
    ) as HTMLButtonElement | undefined;

    expect(chevronToggle).toBeInstanceOf(HTMLButtonElement);
    await user.click(chevronToggle as HTMLButtonElement);
    expect(screen.getByText(/Current Season:/)).toBeInTheDocument();

    await user.click(chevronToggle as HTMLButtonElement);
    expect(screen.queryByText(/Current Season:/)).not.toBeInTheDocument();
  });

  it('updates dark mode, contrast level, and pattern visibility', async () => {
    const user = userEvent.setup();
    renderWithUser({ darkMode: false, contrastLevel: 2, patternOpacity: 0 });

    expect(screen.getByText('Much darker')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();

    const darkModeRow = screen.getByText('Dark Mode').closest('div')?.parentElement;
    const darkModeToggle = darkModeRow?.querySelector('button');
    expect(darkModeToggle).not.toBeNull();
    await user.click(darkModeToggle as HTMLButtonElement);
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ darkMode: true });

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0], { target: { value: '-1' } });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ contrastLevel: -1 });

    fireEvent.change(sliders[1], { target: { value: '65' } });
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ patternOpacity: 65 });
  });
});
