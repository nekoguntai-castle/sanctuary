import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import {
  useBtcPrice,
  useCurrencyFormatter,
  useCurrencySettings,
} from "../../../contexts/CurrencyContext";
import { renderWithProviders, setupDefaultMocks } from "./helpers";

vi.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../src/api/price", () => ({
  PRICE_PROVIDERS_CHANGED_EVENT: "sanctuary:price-providers-changed",
  getPrice: vi.fn(),
  getPriceFromProvider: vi.fn(),
  getProviders: vi.fn(),
}));

vi.mock("../../../src/api/auth", () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock("../../../src/api/refresh", () => ({
  onTerminalLogout: () => () => {},
  triggerLogout: vi.fn(),
}));

describe("CurrencyContext - Specialized hooks", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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
