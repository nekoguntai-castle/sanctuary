import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { setupDefaultMocks } from "./helpers";

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

describe("CurrencyContext - useCurrency hook", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when used outside provider", () => {
    const TestComponent = () => {
      useCurrency();
      return null;
    };

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // After the CurrencyContext split, the error message names the
    // specific sub-provider that's missing. The contract — throws when
    // outside the provider tree — is preserved.
    expect(() => render(<TestComponent />)).toThrow(
      /must be used within CurrencyPreferencesProvider/,
    );

    consoleSpy.mockRestore();
  });
});
