/**
 * Tests for CurrencyContext
 *
 * Tests currency formatting, fiat price fetching, and user preferences.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CurrencyProvider,
  useBtcPrice,
  useCurrency,
  useCurrencyFormatter,
  useCurrencySettings,
} from "../../contexts/CurrencyContext";
import { UserProvider } from "../../contexts/UserContext";
import * as authApi from "../../src/api/auth";
import * as priceApi from "../../src/api/price";

vi.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the APIs
vi.mock("../../src/api/price", () => ({
  getPrice: vi.fn(),
  getPriceFromProvider: vi.fn(),
  getProviders: vi.fn(),
}));

vi.mock("../../src/api/auth", () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
}));

// Mock the refresh module so UserContext's onTerminalLogout subscribe
// + triggerLogout call do not exercise the Web Lock / BroadcastChannel
// paths during currency tests.
vi.mock("../../src/api/refresh", () => ({
  onTerminalLogout: () => () => {},
  triggerLogout: vi.fn(),
}));

const authenticatedUser = {
  id: "user-1",
  username: "testuser",
  email: "test@example.com",
  isAdmin: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  preferences: {
    darkMode: true,
    unit: "sats" as const,
    fiatCurrency: "USD" as const,
    showFiat: false,
    theme: "sanctuary" as const,
    background: "minimal" as const,
    priceProvider: "auto",
  },
};

const makeAggregatedPrice = (
  overrides: Partial<Awaited<ReturnType<typeof priceApi.getPrice>>> = {},
) => ({
  price: 50000,
  currency: "USD",
  sources: [
    {
      provider: "coingecko",
      price: 50000,
      currency: "USD",
      timestamp: new Date().toISOString(),
      change24h: 2.5,
    },
  ],
  median: 50000,
  average: 50000,
  timestamp: new Date().toISOString(),
  cached: false,
  change24h: 2.5,
  ...overrides,
});

// Test component that exposes context values
function TestConsumer() {
  const currency = useCurrency();

  return (
    <div>
      <span data-testid="show-fiat">{currency.showFiat.toString()}</span>
      <span data-testid="fiat-currency">{currency.fiatCurrency}</span>
      <span data-testid="unit">{currency.unit}</span>
      <span data-testid="btc-price">{currency.btcPrice ?? "null"}</span>
      <span data-testid="price-change">
        {currency.priceChange24h ?? "null"}
      </span>
      <span data-testid="price-loading">
        {currency.priceLoading.toString()}
      </span>
      <span data-testid="price-error">{currency.priceError ?? "null"}</span>
      <span data-testid="currency-symbol">{currency.currencySymbol}</span>
      <span data-testid="formatted-sats">{currency.format(100000)}</span>
      <span data-testid="formatted-fiat">
        {currency.formatFiat(100000) ?? "null"}
      </span>
      <span data-testid="fiat-value">
        {currency.getFiatValue(100000) ?? "null"}
      </span>
      <span data-testid="price-provider">{currency.priceProvider}</span>
      <button data-testid="toggle-fiat" onClick={currency.toggleShowFiat}>
        Toggle Fiat
      </button>
      <button
        data-testid="set-eur"
        onClick={() => currency.setFiatCurrency("EUR")}
      >
        Set EUR
      </button>
      <button data-testid="set-btc" onClick={() => currency.setUnit("btc")}>
        Set BTC
      </button>
      <button
        data-testid="set-provider"
        onClick={() => currency.setPriceProvider("kraken")}
      >
        Set Provider
      </button>
      <button data-testid="refresh-price" onClick={currency.refreshPrice}>
        Refresh
      </button>
    </div>
  );
}

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <UserProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </UserProvider>,
  );
}

async function renderWithProvidersAndWait(ui: React.ReactNode) {
  const view = renderWithProviders(ui);
  await waitFor(() => {
    expect(priceApi.getPrice).toHaveBeenCalled();
  });
  return view;
}

describe("CurrencyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Default mock responses
    vi.mocked(priceApi.getPrice).mockResolvedValue(makeAggregatedPrice());
    vi.mocked(priceApi.getPriceFromProvider).mockResolvedValue(
      makeAggregatedPrice().sources[0],
    );
    vi.mocked(priceApi.getProviders).mockResolvedValue({
      providers: ["mempool", "coingecko", "kraken", "coinbase"],
      count: 4,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Provider initialization", () => {
    it("initializes with default values", async () => {
      await renderWithProvidersAndWait(<TestConsumer />);

      expect(screen.getByTestId("show-fiat")).toHaveTextContent("false");
      expect(screen.getByTestId("fiat-currency")).toHaveTextContent("USD");
      expect(screen.getByTestId("unit")).toHaveTextContent("sats");
      expect(screen.getByTestId("currency-symbol")).toHaveTextContent("$");
      expect(screen.getByTestId("price-provider")).toHaveTextContent("auto");
    });

    it("fetches price on mount", async () => {
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledWith("USD", true);
      });

      await waitFor(() => {
        expect(screen.getByTestId("btc-price")).toHaveTextContent("50000");
      });
    });

    it("sets price loading state", async () => {
      let resolvePrice!: (
        price: Awaited<ReturnType<typeof priceApi.getPrice>>,
      ) => void;
      vi.mocked(priceApi.getPrice).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePrice = resolve;
          }),
      );

      renderWithProviders(<TestConsumer />);

      expect(screen.getByTestId("price-loading")).toHaveTextContent("true");

      await act(async () => {
        resolvePrice(makeAggregatedPrice());
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("price-loading")).toHaveTextContent("false");
      });
    });

    it("handles price fetch error", async () => {
      vi.mocked(priceApi.getPrice).mockRejectedValue(
        new Error("Network error"),
      );

      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("price-error")).toHaveTextContent(
          "Failed to fetch price",
        );
      });

      expect(screen.getByTestId("btc-price")).toHaveTextContent("null");
    });

    it("normalizes missing 24h change to null", async () => {
      vi.mocked(priceApi.getPrice).mockResolvedValue(
        makeAggregatedPrice({ change24h: undefined as unknown as number }),
      );

      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("btc-price")).toHaveTextContent("50000");
        expect(screen.getByTestId("price-change")).toHaveTextContent("null");
      });
    });
  });

  describe("Currency formatting", () => {
    it("formats sats correctly", async () => {
      await renderWithProvidersAndWait(<TestConsumer />);

      expect(screen.getByTestId("formatted-sats")).toHaveTextContent(
        "100,000 sats",
      );
    });

    it("formats as BTC when unit is btc", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await renderWithProvidersAndWait(<TestConsumer />);

      await user.click(screen.getByTestId("set-btc"));

      expect(screen.getByTestId("formatted-sats")).toHaveTextContent(
        "0.001 BTC",
      );
    });

    it("returns null for fiat when showFiat is false", async () => {
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("btc-price")).toHaveTextContent("50000");
      });

      expect(screen.getByTestId("formatted-fiat")).toHaveTextContent("null");
    });

    it("formats fiat when showFiat is true", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("btc-price")).toHaveTextContent("50000");
      });

      await user.click(screen.getByTestId("toggle-fiat"));

      await waitFor(() => {
        // 100000 sats = 0.001 BTC * 50000 = $50
        expect(screen.getByTestId("formatted-fiat")).toHaveTextContent(
          "$50.00",
        );
      });
    });

    it("shows placeholder when price unavailable", async () => {
      vi.mocked(priceApi.getPrice).mockRejectedValue(new Error("No price"));

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("price-error")).not.toHaveTextContent("null");
      });

      await user.click(screen.getByTestId("toggle-fiat"));

      expect(screen.getByTestId("formatted-fiat")).toHaveTextContent("-----");
    });

    it("formats fiat price helper for null and numeric values", async () => {
      const TestFiatPriceFormatter = () => {
        const { formatFiatPrice } = useCurrency();
        return (
          <div>
            <span data-testid="fiat-price-null">{formatFiatPrice(null)}</span>
            <span data-testid="fiat-price-value">
              {formatFiatPrice(1234.5)}
            </span>
          </div>
        );
      };

      renderWithProviders(<TestFiatPriceFormatter />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalled();
      });

      expect(screen.getByTestId("fiat-price-null")).toHaveTextContent("-----");
      expect(screen.getByTestId("fiat-price-value")).toHaveTextContent(
        "$1,234.50",
      );
    });
  });

  describe("Currency settings", () => {
    it("toggles showFiat", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      expect(screen.getByTestId("show-fiat")).toHaveTextContent("false");

      await user.click(screen.getByTestId("toggle-fiat"));
      expect(screen.getByTestId("show-fiat")).toHaveTextContent("true");

      await user.click(screen.getByTestId("toggle-fiat"));
      expect(screen.getByTestId("show-fiat")).toHaveTextContent("false");
    });

    it("changes fiat currency", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      expect(screen.getByTestId("fiat-currency")).toHaveTextContent("USD");
      expect(screen.getByTestId("currency-symbol")).toHaveTextContent("$");

      await user.click(screen.getByTestId("set-eur"));

      expect(screen.getByTestId("fiat-currency")).toHaveTextContent("EUR");
      expect(screen.getByTestId("currency-symbol")).toHaveTextContent("€");
    });

    it("changes bitcoin unit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      expect(screen.getByTestId("unit")).toHaveTextContent("sats");

      await user.click(screen.getByTestId("set-btc"));

      expect(screen.getByTestId("unit")).toHaveTextContent("btc");
    });

    it("refetches price when currency changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledWith("USD", true);
      });

      await user.click(screen.getByTestId("set-eur"));

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledWith("EUR", true);
      });
    });

    it("changes local price provider", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      expect(screen.getByTestId("price-provider")).toHaveTextContent("auto");

      await user.click(screen.getByTestId("set-provider"));

      expect(screen.getByTestId("price-provider")).toHaveTextContent("kraken");
    });

    it("updates user preferences when authenticated", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(
        authenticatedUser as any,
      );
      vi.mocked(authApi.updatePreferences).mockImplementation(
        async (prefs: any) => ({
          ...authenticatedUser,
          preferences: {
            ...authenticatedUser.preferences,
            ...prefs,
          },
        }),
      );

      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(authApi.getCurrentUser).toHaveBeenCalled();
      });

      await user.click(screen.getByTestId("set-eur"));
      await user.click(screen.getByTestId("set-btc"));
      await user.click(screen.getByTestId("set-provider"));
      await user.click(screen.getByTestId("toggle-fiat"));

      await waitFor(() => {
        expect(authApi.updatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ fiatCurrency: "EUR" }),
        );
        expect(authApi.updatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ unit: "btc" }),
        );
        expect(authApi.updatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ priceProvider: "kraken" }),
        );
        expect(authApi.updatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ showFiat: true }),
        );
      });
    });
  });

  describe("Price refresh", () => {
    it("refreshes price on demand", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByTestId("refresh-price"));

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
      });
    });

    it("auto-refreshes price every 60 seconds", async () => {
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
      });

      // Advance 60 seconds
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("getFiatValue", () => {
    it("calculates fiat value from sats", async () => {
      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("btc-price")).toHaveTextContent("50000");
      });

      // 100000 sats = 0.001 BTC * 50000 = 50
      expect(screen.getByTestId("fiat-value")).toHaveTextContent("50");
    });

    it("returns null when price unavailable", async () => {
      vi.mocked(priceApi.getPrice).mockRejectedValue(new Error("No price"));

      renderWithProviders(<TestConsumer />);

      await waitFor(() => {
        expect(screen.getByTestId("price-error")).not.toHaveTextContent("null");
      });

      expect(screen.getByTestId("fiat-value")).toHaveTextContent("null");
    });
  });

  describe("Currency symbols", () => {
    it.each([
      ["USD", "$"],
      ["EUR", "€"],
      ["GBP", "£"],
      ["JPY", "¥"],
    ])("shows correct symbol for %s", async (currency, symbol) => {
      const TestCurrencySymbol = () => {
        const { setFiatCurrency, currencySymbol } = useCurrency();
        React.useEffect(() => {
          setFiatCurrency(currency as "USD" | "EUR" | "GBP" | "JPY");
        }, []);
        return <span data-testid="symbol">{currencySymbol}</span>;
      };

      renderWithProviders(<TestCurrencySymbol />);

      await waitFor(() => {
        expect(screen.getByTestId("symbol")).toHaveTextContent(symbol);
      });
    });
  });

  describe("useCurrency hook", () => {
    it("throws when used outside provider", () => {
      const TestComponent = () => {
        useCurrency();
        return null;
      };

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => render(<TestComponent />)).toThrow(
        "useCurrency must be used within CurrencyProvider",
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Specialized hooks", () => {
    it("useCurrencyFormatter returns formatting functions", async () => {
      const TestFormatter = () => {
        const { format, currencySymbol, unit } = useCurrencyFormatter();
        return (
          <div>
            <span data-testid="format">{format(50000)}</span>
            <span data-testid="symbol">{currencySymbol}</span>
            <span data-testid="unit">{unit}</span>
          </div>
        );
      };

      renderWithProviders(<TestFormatter />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalled();
      });

      expect(screen.getByTestId("format")).toHaveTextContent("50,000 sats");
      expect(screen.getByTestId("symbol")).toHaveTextContent("$");
      expect(screen.getByTestId("unit")).toHaveTextContent("sats");
    });

    it("useBtcPrice returns price data", async () => {
      const TestPriceHook = () => {
        const { btcPrice, priceChange24h, priceLoading } = useBtcPrice();
        return (
          <div>
            <span data-testid="price">{btcPrice ?? "null"}</span>
            <span data-testid="change">{priceChange24h ?? "null"}</span>
            <span data-testid="loading">{priceLoading.toString()}</span>
          </div>
        );
      };

      renderWithProviders(<TestPriceHook />);

      await waitFor(() => {
        expect(screen.getByTestId("price")).toHaveTextContent("50000");
        expect(screen.getByTestId("change")).toHaveTextContent("2.5");
      });
    });

    it("useCurrencySettings returns settings", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      const TestSettings = () => {
        const {
          showFiat,
          toggleShowFiat,
          fiatCurrency,
          unit,
          priceProvider,
          availableProviders,
        } = useCurrencySettings();
        return (
          <div>
            <span data-testid="showFiat">{showFiat.toString()}</span>
            <span data-testid="fiat">{fiatCurrency}</span>
            <span data-testid="unit">{unit}</span>
            <span data-testid="provider">{priceProvider}</span>
            <span data-testid="providers">{availableProviders.join(",")}</span>
            <button data-testid="toggle" onClick={toggleShowFiat}>
              Toggle
            </button>
          </div>
        );
      };

      renderWithProviders(<TestSettings />);

      await waitFor(() => {
        expect(priceApi.getPrice).toHaveBeenCalled();
      });

      expect(screen.getByTestId("showFiat")).toHaveTextContent("false");
      await waitFor(() => {
        expect(screen.getByTestId("providers")).toHaveTextContent(
          "auto,mempool,coingecko,kraken,coinbase",
        );
      });

      await user.click(screen.getByTestId("toggle"));

      expect(screen.getByTestId("showFiat")).toHaveTextContent("true");
    });
  });
});
