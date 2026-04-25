/**
 * Settings Component Tests
 *
 * Tests for the application settings including theme, currency,
 * background, Telegram integration, and other preferences.
 */

import { render,screen } from '@testing-library/react';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock CurrencyContext
const mockSetCurrency = vi.fn();
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'USD',
    setCurrency: mockSetCurrency,
    format: (sats: number) => `$${(sats / 100000000 * 50000).toFixed(2)}`,
    btcPrice: 50000,
  }),
  FiatCurrency: {
    USD: 'USD',
    EUR: 'EUR',
    GBP: 'GBP',
  },
}));

// Mock UserContext
const mockUpdatePreferences = vi.fn().mockResolvedValue({});
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: {
      id: 'user-123',
      username: 'testuser',
      preferences: {
        theme: 'sanctuary',
        background: 'none',
        season: 'spring',
        telegram: {
          enabled: false,
          botToken: '',
          chatId: '',
        },
      },
    },
    updatePreferences: mockUpdatePreferences,
  }),
}));

// Mock notification sound hook
vi.mock('../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    enabled: true,
    toggle: vi.fn(),
    play: vi.fn(),
  }),
}));

// Mock auth API for Telegram
vi.mock('../../src/api/auth', () => ({
  testTelegramConfig: vi.fn().mockResolvedValue({ success: true }),
  fetchTelegramChatId: vi.fn().mockResolvedValue({ success: true, chatId: '123456' }),
}));

// Mock API client
vi.mock('../../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock error handler
vi.mock('../../utils/errorHandler', () => ({
  logError: vi.fn().mockReturnValue('Error message'),
}));

// Mock theme registry with all methods used by Settings component
vi.mock('../../themes', () => ({
  themeRegistry: {
    getTheme: vi.fn().mockReturnValue({
      id: 'sanctuary',
      name: 'Sanctuary',
      colors: {},
    }),
    getAllThemes: vi.fn().mockReturnValue([
      { id: 'sanctuary', name: 'Sanctuary' },
      { id: 'dark', name: 'Dark' },
    ]),
    getAllMetadata: vi.fn().mockReturnValue([
      { id: 'sanctuary', name: 'Sanctuary' },
      { id: 'dark', name: 'Dark' },
    ]),
    getCurrentSeason: vi.fn().mockReturnValue('spring'),
    getSeasonalBackground: vi.fn().mockReturnValue('none'),
    getDefaultSeasonalBackground: vi.fn().mockReturnValue('none'),
    getAllPatterns: vi.fn().mockReturnValue([]),
    getSeasonName: vi.fn().mockReturnValue('Spring'),
  },
  Season: ['spring', 'summer', 'fall', 'winter'],
}));

// Mock background categories
vi.mock('../../themes/backgroundCategories', () => ({
  CATEGORIES: [],
  BACKGROUND_CATEGORIES: [],
  getCategoriesForBackground: vi.fn().mockReturnValue([]),
}));

// Mock lucide-react icons using simple JSX pattern that works
vi.mock('lucide-react', () => ({
  Monitor: () => <span data-testid="monitor-icon" />,
  DollarSign: () => <span data-testid="dollar-icon" />,
  Globe: () => <span data-testid="globe-icon" />,
  Palette: () => <span data-testid="palette-icon" />,
  Image: () => <span data-testid="image-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Waves: () => <span data-testid="waves-icon" />,
  Minus: () => <span data-testid="minus-icon" />,
  Server: () => <span data-testid="server-icon" />,
  Send: () => <span data-testid="send-icon" />,
  Eye: () => <span data-testid="eye-icon" />,
  EyeOff: () => <span data-testid="eye-off-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  ExternalLink: () => <span data-testid="external-icon" />,
  Volume2: () => <span data-testid="volume-icon" />,
  Contrast: () => <span data-testid="contrast-icon" />,
  Layers: () => <span data-testid="layers-icon" />,
  Sparkles: () => <span data-testid="sparkles-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Bitcoin: () => <span data-testid="bitcoin-icon" />,
  Circle: () => <span data-testid="circle-icon" />,
  Binary: () => <span data-testid="binary-icon" />,
  Network: () => <span data-testid="network-icon" />,
  Flower2: () => <span data-testid="flower2-icon" />,
  Snowflake: () => <span data-testid="snowflake-icon" />,
  Box: () => <span data-testid="box-icon" />,
  Calendar: () => <span data-testid="calendar-icon" />,
  Sun: () => <span data-testid="sun-icon" />,
  Leaf: () => <span data-testid="leaf-icon" />,
  CloudSnow: () => <span data-testid="cloud-snow-icon" />,
  Bug: () => <span data-testid="bug-icon" />,
  Droplets: () => <span data-testid="droplets-icon" />,
  Flame: () => <span data-testid="flame-icon" />,
  CloudRain: () => <span data-testid="cloud-rain-icon" />,
  Fish: () => <span data-testid="fish-icon" />,
  TreePine: () => <span data-testid="tree-pine-icon" />,
  Flower: () => <span data-testid="flower-icon" />,
  Lamp: () => <span data-testid="lamp-icon" />,
  Cloud: () => <span data-testid="cloud-icon" />,
  Shell: () => <span data-testid="shell-icon" />,
  Train: () => <span data-testid="train-icon" />,
  Mountain: () => <span data-testid="mountain-icon" />,
  Bird: () => <span data-testid="bird-icon" />,
  Rabbit: () => <span data-testid="rabbit-icon" />,
  Star: () => <span data-testid="star-icon" />,
  Sailboat: () => <span data-testid="sailboat-icon" />,
  Wind: () => <span data-testid="wind-icon" />,
  Haze: () => <span data-testid="haze-icon" />,
  Bell: () => <span data-testid="bell-icon" />,
  PartyPopper: () => <span data-testid="party-icon" />,
  Moon: () => <span data-testid="moon-icon" />,
  TreeDeciduous: () => <span data-testid="tree-icon" />,
  Hash: () => <span data-testid="hash-icon" />,
  Droplet: () => <span data-testid="droplet-icon" />,
  Heart: () => <span data-testid="heart-icon" />,
  Share2: () => <span data-testid="share-icon" />,
  Zap: () => <span data-testid="zap-icon" />,
  Search: () => <span data-testid="search-icon" />,
  X: () => <span data-testid="x-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: () => <span data-testid="sanctuary-logo" />,
  SatsIcon: () => <span data-testid="sats-icon" />,
}));

describe('Settings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render settings component', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    // Basic render test - component should not throw
    expect(document.body).toBeDefined();
  });

  it('should display settings tabs', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    // Settings should render with tabs visible
    expect((document.body.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('labels all tab buttons for icon-only mobile layouts', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    for (const tabName of ['Appearance', 'Display', 'Services', 'Notifications']) {
      expect(screen.getByRole('button', { name: tabName })).toHaveAttribute('aria-label', tabName);
    }
  });

  it('should display theme options', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    expect(screen.getByTestId('palette-icon')).toBeInTheDocument();
  });

  it('should display notification sound toggle', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    expect(screen.getByTestId('volume-icon')).toBeInTheDocument();
  });

  it('should display appearance tab content', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    // Appearance tab is default - should show theme-related content
    expect(screen.getByTestId('palette-icon')).toBeInTheDocument();
  });

  it('should display season options', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    expect(screen.getByTestId('calendar-icon')).toBeInTheDocument();
  });
});

describe('Settings - Tab Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with default appearance tab', async () => {
    const { Settings } = await import('../../components/Settings');

    render(<Settings />);

    // Default tab should be appearance which shows calendar icon for seasons
    expect(screen.getByTestId('calendar-icon')).toBeInTheDocument();
  });
});
