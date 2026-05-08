import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as priceApi from "../../../src/api/price";
import {
  TestConsumer,
  renderWithProviders,
  setupDefaultMocks,
} from "./helpers";
import { screen } from "@testing-library/react";

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

describe("CurrencyContext - Price refresh", () => {
  beforeEach(setupDefaultMocks);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes price on demand", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId("refresh-price"));

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
    });
  });

  it("auto-refreshes price every 60 seconds", async () => {
    renderWithProviders(<TestConsumer />);

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(1);
    });

    // Advance 60 seconds
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    await waitFor(() => {
      expect(priceApi.getPrice).toHaveBeenCalledTimes(2);
    });
  });
});
