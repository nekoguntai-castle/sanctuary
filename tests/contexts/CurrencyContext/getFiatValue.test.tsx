import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import {
  TestConsumer,
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

describe("CurrencyContext - getFiatValue", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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
