import axios, { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("axios");

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

import { BasePriceProvider } from "../../../../src/services/price/providers/base";
import type { PriceData } from "../../../../src/services/price/types";

class TestPriceProvider extends BasePriceProvider {
  constructor(
    private readonly impl: (currency: string) => Promise<PriceData> = async (
      currency,
    ) => ({
      provider: "test-provider",
      price: 50000,
      currency,
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    }),
  ) {
    super({
      name: "test-provider",
      priority: 1,
      supportedCurrencies: ["usd"],
      timeoutMs: 1234,
      circuitBreaker: {
        failureThreshold: 2,
        recoveryTimeout: 1000,
      },
    });
  }

  protected fetchPrice(currency: string): Promise<PriceData> {
    return this.impl(currency);
  }

  public httpGetPublic<T>(
    url: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return this.httpGet<T>(url, params);
  }
}

describe("BasePriceProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes supported currencies and supports case-insensitive checks", () => {
    const provider = new TestPriceProvider();

    expect(provider.supportedCurrencies).toEqual(["USD"]);
    expect(provider.supportsCurrency("usd")).toBe(true);
    expect(provider.supportsCurrency("USD")).toBe(true);
    expect(provider.supportsCurrency("eur")).toBe(false);
  });

  it("returns false from healthCheck when circuit does not allow requests", async () => {
    const provider = new TestPriceProvider();
    vi.spyOn((provider as any).circuit, "isAllowingRequests").mockReturnValue(
      false,
    );

    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it("returns false from healthCheck when getPrice throws", async () => {
    const provider = new TestPriceProvider(async () => {
      throw new Error("provider down");
    });

    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it("throws when getPrice is requested for unsupported currency", async () => {
    const provider = new TestPriceProvider();

    await expect(provider.getPrice("eur")).rejects.toThrow(
      "Currency EUR not supported by test-provider",
    );
  });

  it("fetches diagnostic prices without circuit breaker execution", async () => {
    const fetchPrice = vi.fn(async (currency: string) => ({
      provider: "test-provider",
      price: 41000,
      currency,
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    }));
    const provider = new TestPriceProvider(fetchPrice);
    const circuitExecute = vi.spyOn((provider as any).circuit, "execute");

    await expect(provider.testPrice("usd")).resolves.toMatchObject({
      price: 41000,
      currency: "USD",
    });

    expect(fetchPrice).toHaveBeenCalledWith("USD");
    expect(circuitExecute).not.toHaveBeenCalled();
  });

  it("rejects diagnostic prices for unsupported currencies", async () => {
    const fetchPrice = vi.fn();
    const provider = new TestPriceProvider(fetchPrice);

    await expect(provider.testPrice("eur")).rejects.toThrow(
      "Currency EUR not supported by test-provider",
    );
    expect(fetchPrice).not.toHaveBeenCalled();
  });

  it("wraps AxiosError values from httpGet with a provider-friendly message", async () => {
    const provider = new TestPriceProvider();
    vi.mocked(axios.get).mockRejectedValueOnce(
      new AxiosError("timeout", "ERR_NETWORK"),
    );

    await expect(
      provider.httpGetPublic("https://example.com/prices"),
    ).rejects.toThrow("HTTP request failed:");
  });

  it("rethrows non-Axios errors from httpGet", async () => {
    const provider = new TestPriceProvider();
    const unexpected = new Error("unexpected");
    vi.mocked(axios.get).mockRejectedValueOnce(unexpected);

    await expect(
      provider.httpGetPublic("https://example.com/prices"),
    ).rejects.toBe(unexpected);
  });

  it("executes lifecycle hooks and logs health changes", async () => {
    const provider = new TestPriceProvider();

    await provider.onRegister();
    await provider.onUnregister();
    provider.onHealthChange(true);

    expect(mockLogger.debug).toHaveBeenCalledWith("Provider registered");
    expect(mockLogger.debug).toHaveBeenCalledWith("Provider unregistered");
    expect(mockLogger.info).toHaveBeenCalledWith("Health status changed", {
      healthy: true,
    });
  });
});
