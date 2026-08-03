import React from "react";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrency } from "../../../src/contexts/CurrencyContext";
import { renderWithProviders, setupDefaultMocks } from "./helpers";

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

describe("CurrencyContext - Currency symbols", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

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
