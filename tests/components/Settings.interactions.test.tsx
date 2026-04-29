import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../../components/Settings";
import * as authApi from "../../src/api/auth";

const mockState = vi.hoisted(() => {
  return {
    user: {
      id: "user-1",
      username: "tester",
      isAdmin: true,
      preferences: {
        theme: "sanctuary",
        background: "minimal",
        seasonalBackgrounds: { spring: "snowfall" },
        darkMode: false,
        telegram: {
          enabled: false,
          botToken: "",
          chatId: "",
          wallets: {},
        },
        notificationSounds: {
          enabled: true,
          volume: 50,
          confirmation: { enabled: true, sound: "chime" },
          receive: { enabled: true, sound: "chime" },
          send: { enabled: false, sound: "none" },
        },
      },
    },
    updatePreferences: vi.fn(),
    playSound: vi.fn(),
    setFiatCurrency: vi.fn(),
    setUnit: vi.fn(),
    toggleShowFiat: vi.fn(),
    setPriceProvider: vi.fn(),
    refreshPrice: vi.fn(),
    getEventConfig: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("../../contexts/UserContext", () => ({
  useUser: () => ({
    user: mockState.user,
    updatePreferences: mockState.updatePreferences,
  }),
}));

vi.mock("../../contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    currency: "USD",
    setCurrency: vi.fn(),
    format: (sats: number) => `$${sats}`,
    btcPrice: 50000,
    showFiat: true,
    toggleShowFiat: mockState.toggleShowFiat,
    fiatCurrency: "USD",
    setFiatCurrency: mockState.setFiatCurrency,
    unit: "sats",
    setUnit: mockState.setUnit,
    priceProvider: "auto",
    setPriceProvider: mockState.setPriceProvider,
    availableProviders: ["auto", "coingecko"],
    refreshPrice: mockState.refreshPrice,
    priceLoading: false,
    lastPriceUpdate: new Date("2026-03-01T12:00:00Z"),
    currencySymbol: "$",
  }),
  FiatCurrency: {
    USD: "USD",
    EUR: "EUR",
    GBP: "GBP",
    JPY: "JPY",
  },
}));

vi.mock("../../components/PriceProviderDiagnostics", () => ({
  PriceProviderDiagnostics: () => (
    <div data-testid="price-provider-diagnostics">Diagnostics</div>
  ),
}));

vi.mock("../../hooks/useNotificationSound", () => ({
  useNotificationSound: () => ({
    playSound: mockState.playSound,
    soundPresets: [
      { id: "none", name: "None" },
      { id: "chime", name: "Chime" },
      { id: "bell", name: "Bell" },
    ],
    soundEvents: [
      {
        id: "confirmation",
        name: "Confirmation",
        description: "Transaction confirmed",
      },
      { id: "receive", name: "Receive", description: "Bitcoin received" },
      { id: "send", name: "Send", description: "Bitcoin sent" },
    ],
    getEventConfig: mockState.getEventConfig,
  }),
}));

vi.mock("../../src/api/auth", () => ({
  testTelegramConfig: vi.fn(),
  fetchTelegramChatId: vi.fn(),
}));

vi.mock("../../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../utils/errorHandler", () => ({
  logError: (...args: unknown[]) => mockState.logError(...args),
}));

vi.mock("../../themes", () => ({
  themeRegistry: {
    getAllMetadata: vi.fn().mockReturnValue([
      {
        id: "sanctuary",
        name: "Sanctuary",
        preview: { primaryColor: "#7d7870" },
      },
      { id: "dark", name: "Dark", preview: { primaryColor: "#1f2937" } },
    ]),
    getCurrentSeason: vi.fn().mockReturnValue("spring"),
    getSeasonalBackground: vi.fn().mockReturnValue("snowfall"),
    getDefaultSeasonalBackground: vi.fn().mockReturnValue("snowfall"),
    getAllPatterns: vi.fn().mockReturnValue([
      { id: "minimal", name: "Minimal", animated: false },
      { id: "snowfall", name: "Snowfall", animated: true },
    ]),
    getSeasonName: vi.fn().mockReturnValue("Spring"),
  },
  Season: ["spring", "summer", "fall", "winter"],
}));

vi.mock("../../themes/backgroundCategories", () => ({
  CATEGORIES: [
    { id: "all", label: "All", icon: "All" },
    { id: "favorites", label: "Favorites", icon: "Fav" },
  ],
  BACKGROUND_CATEGORIES: [],
  getCategoriesForBackground: vi.fn().mockReturnValue([]),
}));

vi.mock("../../components/ui/Button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    isLoading?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled || isLoading} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../../components/ui/CustomIcons", () => ({
  SanctuaryLogo: () => <span data-testid="sanctuary-logo" />,
  SatsIcon: () => <span data-testid="sats-icon" />,
}));

const resetSettingsMocks = (): void => {
  vi.clearAllMocks();

  mockState.user = {
    id: "user-1",
    username: "tester",
    isAdmin: true,
    preferences: {
      theme: "sanctuary",
      background: "minimal",
      seasonalBackgrounds: { spring: "snowfall" },
      darkMode: false,
      telegram: {
        enabled: false,
        botToken: "",
        chatId: "",
        wallets: {},
      },
      notificationSounds: {
        enabled: true,
        volume: 50,
        confirmation: { enabled: true, sound: "chime" },
        receive: { enabled: true, sound: "chime" },
        send: { enabled: false, sound: "none" },
      },
    },
  };

  mockState.updatePreferences.mockResolvedValue({});
  mockState.logError.mockReturnValue("Handled error");

  mockState.getEventConfig.mockImplementation(
    (eventId: "confirmation" | "receive" | "send") => {
      const settings = mockState.user.preferences.notificationSounds;
      return settings[eventId] ?? { enabled: true, sound: "none" };
    },
  );

  vi.mocked(authApi.fetchTelegramChatId).mockResolvedValue({
    success: true,
    chatId: "987654321",
    username: "satoshi",
  });

  vi.mocked(authApi.testTelegramConfig).mockResolvedValue({ success: true });
};

const registerSoundDisplayAndServicesTest = (): void => {
  it("handles sound settings and display/services controls", async () => {
    const user = userEvent.setup();
    const { container } = render(<Settings />);

    await user.click(screen.getByText("Notifications"));
    expect(screen.getByText("Notification Sounds")).toBeInTheDocument();

    const enableSoundsLabel = screen.getByText("Enable Sounds");
    const masterToggle =
      enableSoundsLabel.parentElement?.parentElement?.querySelector("button");
    expect(masterToggle).not.toBeNull();
    await user.click(masterToggle as HTMLButtonElement);

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationSounds: expect.objectContaining({ enabled: false }),
        }),
      );
    });

    const soundSelects = screen.getAllByRole("combobox");
    await user.selectOptions(soundSelects[0], "bell");

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationSounds: expect.objectContaining({
            confirmation: expect.objectContaining({ sound: "bell" }),
          }),
        }),
      );
    });
    expect(mockState.playSound).toHaveBeenCalledWith("bell", 50);

    const testButtons = screen.getAllByTitle("Test sound");
    await user.click(testButtons[0]);
    expect(mockState.playSound).toHaveBeenCalledWith("chime", 50);

    const volumeSlider = screen.getByRole("slider");
    fireEvent.change(volumeSlider, { target: { value: "70" } });

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationSounds: expect.objectContaining({ volume: 70 }),
        }),
      );
    });

    await user.click(screen.getByText("Display"));
    await user.click(screen.getByText("BTC"));
    expect(mockState.setUnit).toHaveBeenCalledWith("btc");

    const showFiatLabel = screen.getByText("Show Fiat Equivalent");
    const showFiatToggle =
      showFiatLabel.parentElement?.parentElement?.querySelector("button");
    expect(showFiatToggle).not.toBeNull();
    await user.click(showFiatToggle as HTMLButtonElement);
    expect(mockState.toggleShowFiat).toHaveBeenCalled();

    const fiatCurrencySelect = screen.getByRole("combobox");
    await user.selectOptions(fiatCurrencySelect, "EUR");
    expect(mockState.setFiatCurrency).toHaveBeenCalledWith("EUR");

    await user.click(screen.getByText("Services"));
    const providerSelect = screen.getByRole("combobox");
    await user.selectOptions(providerSelect, "coingecko");
    expect(mockState.setPriceProvider).toHaveBeenCalledWith("coingecko");

    await user.click(screen.getByText("Refresh Price"));
    expect(mockState.refreshPrice).toHaveBeenCalled();
    expect(container.textContent).toContain("$50,000");
  });
};

const registerTelegramHappyPathTest = (): void => {
  it("handles Telegram happy path flows", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByText("Notifications"));
    await user.click(screen.getByText("Telegram"));

    const tokenInput = screen.getByPlaceholderText(
      "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    );
    await user.type(tokenInput, "bot-token");

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => {
      expect(authApi.fetchTelegramChatId).toHaveBeenCalledWith("bot-token");
    });
    expect(screen.getByText(/Chat ID found/)).toHaveTextContent(
      "Chat ID found (@satoshi)!",
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("987654321")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => {
      expect(authApi.testTelegramConfig).toHaveBeenCalledWith(
        "bot-token",
        "987654321",
      );
    });
    expect(
      screen.getByText("Test message sent successfully!"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith({
        telegram: {
          botToken: "bot-token",
          chatId: "987654321",
          enabled: false,
          wallets: {},
        },
      });
    });

    expect(screen.getByText("Settings saved successfully")).toBeInTheDocument();

    const disabledLabel = screen.getByText("Disabled");
    const toggleButton = disabledLabel.parentElement?.querySelector("button");
    expect(toggleButton).not.toBeNull();
    await user.click(toggleButton as HTMLButtonElement);

    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith({
        telegram: {
          botToken: "bot-token",
          chatId: "987654321",
          enabled: true,
          wallets: {},
        },
      });
    });
  });
};

const registerTelegramErrorTest = (): void => {
  it("shows Telegram errors for API failures", async () => {
    const user = userEvent.setup();

    mockState.user.preferences.telegram = {
      enabled: true,
      botToken: "existing-token",
      chatId: "existing-chat",
      wallets: {},
    };

    vi.mocked(authApi.testTelegramConfig).mockRejectedValue(
      new Error("test failed"),
    );
    mockState.updatePreferences.mockRejectedValue(new Error("save failed"));
    mockState.logError.mockReturnValue("Failed to test connection");

    render(<Settings />);

    await user.click(screen.getByText("Notifications"));
    await user.click(screen.getByText("Telegram"));

    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(
      await screen.findByText("Failed to test connection"),
    ).toBeInTheDocument();

    mockState.logError.mockReturnValue("Failed to save settings");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Failed to save settings"),
    ).toBeInTheDocument();

    mockState.logError.mockReturnValue("Failed to update settings");
    const enabledLabel = screen.getByText("Enabled");
    const toggleButton = enabledLabel.parentElement?.querySelector("button");
    expect(toggleButton).not.toBeNull();
    await user.click(toggleButton as HTMLButtonElement);

    expect(
      await screen.findByText("Failed to update settings"),
    ).toBeInTheDocument();
  });
};

describe("Settings interactions", () => {
  beforeEach(resetSettingsMocks);

  registerSoundDisplayAndServicesTest();
  registerTelegramHappyPathTest();
  registerTelegramErrorTest();
});
