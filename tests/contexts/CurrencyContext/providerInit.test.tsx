import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import { useCurrencySettings } from "../../../contexts/CurrencyContext";
import {
  TestConsumer,
  makeAggregatedPrice,
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

describe("CurrencyContext - Provider initialization", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("falls back to static providers when provider loading fails", async () => {
    vi.mocked(priceApi.getProviders).mockRejectedValue(new Error("offline"));

    const TestSettingsProviders = () => {
      const { availableProviders } = useCurrencySettings();
      return (
        <span data-testid="providers">{availableProviders.join(",")}</span>
      );
    };

    renderWithProviders(<TestSettingsProviders />);

    await waitFor(() => {
      expect(screen.getByTestId("providers")).toHaveTextContent(
        "auto,mempool,coingecko,kraken,coinbase",
      );
    });
  });

  it("falls back to static providers when provider reload fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(priceApi.getProviders).mockResolvedValue({
      providers: ["kraken"],
      count: 1,
    });

    const TestSettingsProviders = () => {
      const { availableProviders, reloadAvailableProviders } =
        useCurrencySettings();
      return (
        <div>
          <span data-testid="providers">{availableProviders.join(",")}</span>
          <button
            data-testid="reload-providers"
            onClick={() => void reloadAvailableProviders()}
          >
            Reload
          </button>
        </div>
      );
    };

    renderWithProviders(<TestSettingsProviders />);

    await waitFor(() => {
      expect(screen.getByTestId("providers")).toHaveTextContent(
        "auto,kraken",
      );
    });

    const initialProviderLoadCount = vi.mocked(priceApi.getProviders).mock
      .calls.length;
    vi.mocked(priceApi.getProviders).mockRejectedValueOnce(
      new Error("offline"),
    );

    await user.click(screen.getByTestId("reload-providers"));

    await waitFor(() => {
      expect(screen.getByTestId("providers")).toHaveTextContent(
        "auto,mempool,coingecko,kraken,coinbase",
      );
    });
    expect(vi.mocked(priceApi.getProviders).mock.calls.length).toBeGreaterThan(
      initialProviderLoadCount,
    );
  });

  it("falls back to auto when the selected provider is disabled globally", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId("price-provider")).toHaveTextContent("auto");
    });

    await user.click(screen.getByTestId("set-provider"));

    expect(screen.getByTestId("price-provider")).toHaveTextContent("kraken");

    vi.mocked(priceApi.getProviders).mockResolvedValueOnce({
      providers: ["mempool", "coingecko"],
      count: 2,
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(priceApi.PRICE_PROVIDERS_CHANGED_EVENT),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("price-provider")).toHaveTextContent("auto");
    });
  });

  it("ignores successful provider loading after unmount", async () => {
    let resolveProviders!: (
      value: Awaited<ReturnType<typeof priceApi.getProviders>>,
    ) => void;
    vi.mocked(priceApi.getProviders).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProviders = resolve;
        }),
    );

    const view = renderWithProviders(<TestConsumer />);
    view.unmount();

    await act(async () => {
      resolveProviders({ providers: ["kraken"], count: 1 });
      await Promise.resolve();
    });
  });

  it("ignores failed provider loading after unmount", async () => {
    let rejectProviders!: (error: Error) => void;
    vi.mocked(priceApi.getProviders).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectProviders = reject;
        }),
    );

    const view = renderWithProviders(<TestConsumer />);
    view.unmount();

    await act(async () => {
      rejectProviders(new Error("offline"));
      await Promise.resolve();
    });
  });
});
