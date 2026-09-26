import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../../../src/api/auth";
import * as priceApi from "../../../src/api/price";
import { useCurrencySettings } from "../../../src/contexts/CurrencyContext";
import {
  authenticatedUser,
  TestConsumer,
  makeAggregatedPrice,
  renderWithProviders,
  renderWithProvidersAndWait,
  setupDefaultMocks,
} from "./helpers";

const providerLog = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: providerLog.warn,
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


type ProviderResponse = Awaited<ReturnType<typeof priceApi.getProviders>>;
function deferredProviders() {
  let resolve!: (value: ProviderResponse) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ProviderResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function ProviderOwnerConsumer() {
  const { availableProviders, priceProvider, reloadAvailableProviders } = useCurrencySettings();
  return <>
    <span data-testid="owned-providers">{availableProviders.join(",")}</span>
    <span data-testid="owned-selection">{priceProvider}</span>
    <button onClick={() => void reloadAvailableProviders()}>Reload owned providers</button>
  </>;
}
async function renderKrakenOwner() {
  vi.mocked(authApi.getCurrentUser).mockResolvedValue({
    ...authenticatedUser,
    preferences: { ...authenticatedUser.preferences, priceProvider: "kraken" },
  });
  const view = renderWithProviders(<ProviderOwnerConsumer />);
  await waitFor(() => expect(screen.getByTestId("owned-selection")).toHaveTextContent("kraken"));
  return view;
}
async function expectNoPreferencePersistence() {
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(authApi.updatePreferences).not.toHaveBeenCalled();
}

describe("CurrencyContext - Provider initialization", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps manual C after mount A and event B resolve in reverse order without persisting auto", async () => {
    const requests = [deferredProviders(), deferredProviders(), deferredProviders()];
    for (const pending of requests) vi.mocked(priceApi.getProviders).mockReturnValueOnce(pending.promise);
    await renderKrakenOwner();
    act(() => { window.dispatchEvent(new Event(priceApi.PRICE_PROVIDERS_CHANGED_EVENT)); });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText("Reload owned providers"));
    expect(priceApi.getProviders).toHaveBeenCalledTimes(3);
    await act(async () => { requests[2].resolve({ providers: ["kraken", "coinbase"], count: 2 }); });
    await act(async () => { requests[1].resolve({ providers: ["mempool"], count: 1 }); });
    await act(async () => { requests[0].resolve({ providers: ["coingecko"], count: 1 }); });
    expect(screen.getByTestId("owned-providers")).toHaveTextContent("auto,kraken,coinbase");
    expect(screen.getByTestId("owned-selection")).toHaveTextContent("kraken");
    await expectNoPreferencePersistence();
  });

  it("ignores stale mount and event failures after the latest manual success", async () => {
    const requests = [deferredProviders(), deferredProviders(), deferredProviders()];
    for (const pending of requests) vi.mocked(priceApi.getProviders).mockReturnValueOnce(pending.promise);
    await renderKrakenOwner();
    act(() => { window.dispatchEvent(new Event(priceApi.PRICE_PROVIDERS_CHANGED_EVENT)); });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText("Reload owned providers"));
    await act(async () => { requests[2].resolve({ providers: ["kraken"], count: 1 }); });
    await act(async () => {
      requests[1].reject(new Error("retired event"));
      requests[0].reject(new Error("retired mount"));
    });
    expect(screen.getByTestId("owned-providers")).toHaveTextContent("auto,kraken");
    expect(screen.getByTestId("owned-selection")).toHaveTextContent("kraken");
    expect(providerLog.warn).not.toHaveBeenCalled();
    await expectNoPreferencePersistence();
  });

  it.each(["success", "failure"])("ignores manual provider %s after unmount without persistence or logs", async outcome => {
    const pending = deferredProviders();
    const view = await renderKrakenOwner();
    vi.mocked(priceApi.getProviders).mockReturnValueOnce(pending.promise);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText("Reload owned providers"));
    view.unmount();
    await act(async () => {
      if (outcome === "success") pending.resolve({ providers: ["mempool"], count: 1 });
      else pending.reject(new Error("retired reload"));
    });
    expect(providerLog.warn).not.toHaveBeenCalled();
    await expectNoPreferencePersistence();
  });

  it("keeps the selected provider when the current request needs an offline fallback", async () => {
    await renderKrakenOwner();
    vi.mocked(priceApi.getProviders).mockRejectedValueOnce(new Error("current offline request"));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByText("Reload owned providers"));
    expect(screen.getByTestId("owned-providers")).toHaveTextContent("auto,mempool,coingecko,kraken,coinbase");
    expect(screen.getByTestId("owned-selection")).toHaveTextContent("kraken");
    expect(providerLog.warn).toHaveBeenCalledWith("Failed to load price providers", { error: expect.any(Error) });
    await expectNoPreferencePersistence();
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
    expect(providerLog.warn).not.toHaveBeenCalled();
  });
});
