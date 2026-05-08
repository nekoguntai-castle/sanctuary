import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import { useCurrency } from "../../../contexts/CurrencyContext";
import {
  TestConsumer,
  renderWithProviders,
  renderWithProvidersAndWait,
  setupDefaultMocks,
} from "./helpers";

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

describe("CurrencyContext - Currency formatting", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("suppresses fiat values for test networks even when fiat display is enabled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const TestNetworkFiat = () => {
      const currency = useCurrency();
      return (
        <div>
          <span data-testid="mainnet-fiat">
            {currency.formatFiat(100000, { network: "mainnet" }) ?? "null"}
          </span>
          <span data-testid="testnet-fiat">
            {currency.formatFiat(100000, { network: "testnet" }) ?? "null"}
          </span>
          <span data-testid="signet-value">
            {currency.getFiatValue(100000, { network: "signet" }) ?? "null"}
          </span>
          <button data-testid="toggle-fiat" onClick={currency.toggleShowFiat}>
            Toggle Fiat
          </button>
        </div>
      );
    };

    renderWithProviders(<TestNetworkFiat />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalled();
    });
    await user.click(screen.getByTestId("toggle-fiat"));

    expect(screen.getByTestId("mainnet-fiat")).toHaveTextContent("$50.00");
    expect(screen.getByTestId("testnet-fiat")).toHaveTextContent("null");
    expect(screen.getByTestId("signet-value")).toHaveTextContent("null");
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
