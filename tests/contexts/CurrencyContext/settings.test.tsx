import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../../../src/api/auth";
import * as priceApi from "../../../src/api/price";
import { useUser } from "../../../contexts/UserContext";
import {
  TestConsumer,
  authenticatedUser,
  renderWithProviders,
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

function AuthStateMarker() {
  const { user } = useUser();
  return <span data-testid="auth-user-id">{user?.id ?? "none"}</span>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CurrencyContext - Currency settings", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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

    renderWithProviders(
      <>
        <TestConsumer />
        <AuthStateMarker />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-user-id")).toHaveTextContent("user-1");
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

  it("persists currency changes made while auth bootstrap is loading", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bootstrap = deferred<typeof authenticatedUser | null>();

    vi.mocked(authApi.getCurrentUser).mockReturnValue(bootstrap.promise as any);
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

    await user.click(screen.getByTestId("set-eur"));
    expect(screen.getByTestId("fiat-currency")).toHaveTextContent("EUR");

    bootstrap.resolve(authenticatedUser);

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ fiatCurrency: "EUR" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("fiat-currency")).toHaveTextContent("EUR");
    });
  });
});
