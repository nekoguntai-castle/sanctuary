import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import {
  useBtcPrice,
  useCurrencyFormatter,
  useCurrencySettings,
  usePriceFreeFormatter,
} from "../../../contexts/CurrencyContext";
import { usePriceContext } from "../../../contexts/PriceContext";
import { useCurrencyPreferencesContext } from "../../../contexts/CurrencyPreferencesContext";
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

  it("usePriceFreeFormatter returns only format + unit", async () => {
    const TestPriceFree = () => {
      const { format, unit } = usePriceFreeFormatter();
      return (
        <div>
          <span data-testid="format">{format(50000)}</span>
          <span data-testid="format-btc">
            {format(100000000, { forceSats: false })}
          </span>
          <span data-testid="unit">{unit}</span>
        </div>
      );
    };

    renderWithProviders(<TestPriceFree />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalled();
    });

    expect(screen.getByTestId("format")).toHaveTextContent("50,000 sats");
    expect(screen.getByTestId("unit")).toHaveTextContent("sats");
  });

  it("usePriceContext throws when used outside PriceProvider", () => {
    const Outside = () => {
      usePriceContext();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow(
      /usePriceContext must be used within PriceProvider/,
    );
    spy.mockRestore();
  });

  it("useCurrencyPreferencesContext throws when used outside its provider", () => {
    const Outside = () => {
      useCurrencyPreferencesContext();
      return null;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow(
      /must be used within CurrencyPreferencesProvider/,
    );
    spy.mockRestore();
  });

  it("keeps the same availableProviders reference when the list is unchanged", async () => {
    const refs: string[][] = [];
    const TestProviders = () => {
      const { availableProviders } = useCurrencySettings();
      refs.push(availableProviders);
      return <span data-testid="providers">{availableProviders.join(",")}</span>;
    };

    renderWithProviders(<TestProviders />);

    await waitFor(() => {
      expect(screen.getByTestId("providers")).toHaveTextContent(
        "auto,mempool,coingecko,kraken,coinbase",
      );
    });

    const stableRef = refs[refs.length - 1];

    // Fire the providers-changed event with the SAME provider list. The
    // shallow-equal guard in applyAvailableProviders must return the prior
    // array reference rather than producing a new one.
    await waitFor(() => {
      window.dispatchEvent(new Event(priceApi.PRICE_PROVIDERS_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(priceApi.getProviders).toHaveBeenCalledTimes(2);
    });

    // The last captured reference is identical to the one before the event.
    expect(refs[refs.length - 1]).toBe(stableRef);
  });
});
