import axios, { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  describe("HTTP 429 cooldown", () => {
    const START = new Date("2026-11-05T00:00:00.000Z").getTime();

    function rateLimitError(retryAfter?: string): AxiosError {
      const error = new AxiosError("Request failed with status code 429");
      // vi.mock("axios") automocks the class, so set the fields it would carry
      error.message = "Request failed with status code 429";
      error.response = {
        status: 429,
        headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      } as AxiosError["response"];
      return error;
    }

    function at(offsetMs: number): void {
      vi.setSystemTime(new Date(START + offsetMs));
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at(0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Non-regression: a 429 from CoinGecko was retried on every refresh and
    // health probe, keeping the provider rate limited on prod.
    it("skips requests until the Retry-After period has passed", async () => {
      const provider = new TestPriceProvider();
      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError("120"));

      await expect(provider.httpGetPublic("https://example.com/p")).rejects.toThrow(
        "HTTP request failed: Request failed with status code 429",
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Rate limited by provider (HTTP 429); pausing requests",
        { cooldownMs: 120000, consecutiveRateLimits: 1 },
      );

      at(119_999);
      await expect(provider.httpGetPublic("https://example.com/p")).rejects.toThrow(
        "test-provider is rate limited; retrying after 2026-11-05T00:02:00.000Z",
      );
      await expect(provider.healthCheck()).resolves.toBe(false);
      expect(axios.get).toHaveBeenCalledTimes(1);

      at(120_000);
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { ok: true } });
      await expect(provider.httpGetPublic("https://example.com/p")).resolves.toEqual({ ok: true });
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it("backs off exponentially without Retry-After and resets after a success", async () => {
      const provider = new TestPriceProvider();
      const call = () => provider.httpGetPublic("https://example.com/p");

      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError());
      await expect(call()).rejects.toThrow("HTTP request failed");
      expect(mockLogger.warn).toHaveBeenLastCalledWith(expect.any(String), {
        cooldownMs: 60000,
        consecutiveRateLimits: 1,
      });

      at(60_000);
      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError("not-a-date"));
      await expect(call()).rejects.toThrow("HTTP request failed");
      expect(mockLogger.warn).toHaveBeenLastCalledWith(expect.any(String), {
        cooldownMs: 120000,
        consecutiveRateLimits: 2,
      });

      at(180_000);
      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} });
      await call();

      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError());
      await expect(call()).rejects.toThrow("HTTP request failed");
      expect(mockLogger.warn).toHaveBeenLastCalledWith(expect.any(String), {
        cooldownMs: 60000,
        consecutiveRateLimits: 1,
      });
    });

    it("caps the cooldown and accepts an HTTP-date Retry-After", async () => {
      const provider = new TestPriceProvider();
      const call = () => provider.httpGetPublic("https://example.com/p");

      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError("86400"));
      await expect(call()).rejects.toThrow("HTTP request failed");
      expect(mockLogger.warn).toHaveBeenLastCalledWith(expect.any(String), {
        cooldownMs: 900000,
        consecutiveRateLimits: 1,
      });

      at(900_000);
      const retryAt = new Date(START + 900_000 + 300_000).toUTCString();
      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError(retryAt));
      await expect(call()).rejects.toThrow("HTTP request failed");
      expect(mockLogger.warn).toHaveBeenLastCalledWith(expect.any(String), {
        cooldownMs: 300000,
        consecutiveRateLimits: 2,
      });
    });

    it("counts concurrent 429s from one burst as a single rate-limit event", async () => {
      const provider = new TestPriceProvider();
      vi.mocked(axios.get)
        .mockRejectedValueOnce(rateLimitError())
        .mockRejectedValueOnce(rateLimitError());

      await Promise.allSettled([
        provider.httpGetPublic("https://example.com/a"),
        provider.httpGetPublic("https://example.com/b"),
      ]);

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(String), {
        cooldownMs: 60000,
        consecutiveRateLimits: 1,
      });
    });

    it("extends the pause when a later 429 in the burst asks for longer", async () => {
      const provider = new TestPriceProvider();
      vi.mocked(axios.get)
        .mockRejectedValueOnce(rateLimitError())
        .mockRejectedValueOnce(rateLimitError("300"));

      await Promise.allSettled([
        provider.httpGetPublic("https://example.com/a"),
        provider.httpGetPublic("https://example.com/b"),
      ]);

      at(299_999);
      await expect(provider.httpGetPublic("https://example.com/p")).rejects.toThrow(
        "retrying after 2026-11-05T00:05:00.000Z",
      );
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it("skips the circuit breaker while cooling down so skipped calls are not counted as failures", async () => {
      const provider = new TestPriceProvider();
      vi.mocked(axios.get).mockRejectedValueOnce(rateLimitError());
      await expect(provider.httpGetPublic("https://example.com/p")).rejects.toThrow(
        "HTTP request failed",
      );
      const circuitExecute = vi.spyOn((provider as any).circuit, "execute");

      await expect(provider.getPrice("usd")).rejects.toThrow("test-provider is rate limited");
      expect(circuitExecute).not.toHaveBeenCalled();
    });

    it("does not enter a cooldown for other HTTP errors", async () => {
      const provider = new TestPriceProvider();
      const serverError = rateLimitError();
      serverError.response = { status: 503, headers: {} } as AxiosError["response"];
      vi.mocked(axios.get)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { ok: true } });

      await expect(provider.httpGetPublic("https://example.com/p")).rejects.toThrow(
        "HTTP request failed",
      );
      await expect(provider.httpGetPublic("https://example.com/p")).resolves.toEqual({ ok: true });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
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
