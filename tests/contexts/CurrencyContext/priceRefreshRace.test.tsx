import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import {
  TestConsumer,
  makeAggregatedPrice,
  renderWithProviders,
  setupDefaultMocks,
} from "./helpers";

vi.mock("../../../src/utils/logger", () => ({
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

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

describe("CurrencyContext - Price refresh race safety", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies only the latest currency's price when an earlier fetch resolves after a later one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const deferreds: Deferred<Awaited<ReturnType<typeof priceApi.getPrice>>>[] =
      [];
    vi.mocked(priceApi.getPrice).mockImplementation(() => {
      const deferred = createDeferred<
        Awaited<ReturnType<typeof priceApi.getPrice>>
      >();
      deferreds.push(deferred);
      return deferred.promise;
    });

    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    // Switch currency while the first (USD) fetch is still pending. This
    // triggers a second fetch for the new (EUR) currency.
    await user.click(screen.getByTestId("set-eur"));

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
    });

    // Resolve the second (EUR) request first, then the stale first (USD)
    // request. The stale response must not clobber the newer result.
    await act(async () => {
      deferreds[1].resolve(
        makeAggregatedPrice({ price: 60000, currency: "EUR" }),
      );
    });
    await act(async () => {
      deferreds[0].resolve(
        makeAggregatedPrice({ price: 50000, currency: "USD" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("btc-price").textContent).toBe("60000");
    });
    expect(screen.getByTestId("price-loading").textContent).toBe("false");
  });

  it("ignores a stale rejection from a superseded currency request", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const deferreds: Deferred<Awaited<ReturnType<typeof priceApi.getPrice>>>[] =
      [];
    vi.mocked(priceApi.getPrice).mockImplementation(() => {
      const deferred = createDeferred<
        Awaited<ReturnType<typeof priceApi.getPrice>>
      >();
      deferreds.push(deferred);
      return deferred.promise;
    });

    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId("set-eur"));

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
    });

    // Resolve the latest (EUR) request successfully first.
    await act(async () => {
      deferreds[1].resolve(
        makeAggregatedPrice({ price: 60000, currency: "EUR" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("btc-price").textContent).toBe("60000");
    });

    // The stale (USD) request then rejects. It must not surface an error
    // for the currency the user has already moved past.
    await act(async () => {
      deferreds[0].reject(new Error("stale network failure"));
    });

    expect(screen.getByTestId("price-error").textContent).toBe("null");
    expect(screen.getByTestId("btc-price").textContent).toBe("60000");
    expect(screen.getByTestId("price-loading").textContent).toBe("false");
  });

  it("keeps loading true while a newer same-currency refresh is still in flight when an older one settles", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const deferreds: Deferred<Awaited<ReturnType<typeof priceApi.getPrice>>>[] =
      [];
    vi.mocked(priceApi.getPrice).mockImplementation(() => {
      const deferred = createDeferred<
        Awaited<ReturnType<typeof priceApi.getPrice>>
      >();
      deferreds.push(deferred);
      return deferred.promise;
    });

    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    // A manual refresh while the initial mount fetch is still pending
    // starts a second request for the same currency.
    await user.click(screen.getByTestId("refresh-price"));

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
    });

    // The older (mount) request settles first. It must not clear loading
    // or apply its price while the newer manual refresh is still pending.
    await act(async () => {
      deferreds[0].resolve(
        makeAggregatedPrice({ price: 40000, currency: "USD" }),
      );
    });

    expect(screen.getByTestId("price-loading").textContent).toBe("true");
    expect(screen.getByTestId("btc-price").textContent).toBe("null");

    // The newer request settling now applies its result and clears loading.
    await act(async () => {
      deferreds[1].resolve(
        makeAggregatedPrice({ price: 45000, currency: "USD" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("btc-price").textContent).toBe("45000");
    });
    expect(screen.getByTestId("price-loading").textContent).toBe("false");
  });

  it("ignores a response that lands after the provider unmounts", async () => {
    const deferreds: Deferred<Awaited<ReturnType<typeof priceApi.getPrice>>>[] =
      [];
    vi.mocked(priceApi.getPrice).mockImplementation(() => {
      const deferred = createDeferred<
        Awaited<ReturnType<typeof priceApi.getPrice>>
      >();
      deferreds.push(deferred);
      return deferred.promise;
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    view.unmount();

    // The in-flight request from before unmount resolves afterwards. The
    // cleanup-bumped request id must keep this from touching state on the
    // torn-down provider (no React "state update on unmounted component"
    // warning).
    await act(async () => {
      deferreds[0].resolve(
        makeAggregatedPrice({ price: 70000, currency: "USD" }),
      );
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
