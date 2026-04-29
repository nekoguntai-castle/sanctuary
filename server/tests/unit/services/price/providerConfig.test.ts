import { beforeEach, describe, expect, it } from "vitest";

import { circuitBreakerRegistry } from "../../../../src/services/circuitBreaker";
import {
  createConfiguredPriceProviders,
  createKnownPriceProvider,
  getKnownPriceProviderInfos,
  resolveEnabledPriceProviderNames,
} from "../../../../src/services/price/providers";

describe("price provider configuration", () => {
  beforeEach(() => {
    circuitBreakerRegistry.clear();
  });

  it("enables every known provider by default", () => {
    expect(resolveEnabledPriceProviderNames({} as NodeJS.ProcessEnv)).toEqual([
      "mempool",
      "coingecko",
      "kraken",
      "coinbase",
      "binance",
    ]);
  });

  it("supports an allow list and disabled-provider exclusions", () => {
    const env = {
      PRICE_PROVIDERS_ENABLED: "mempool, binance, unknown",
      PRICE_PROVIDERS_DISABLED: "binance",
    } as NodeJS.ProcessEnv;

    expect(resolveEnabledPriceProviderNames(env)).toEqual(["mempool"]);
  });

  it("returns diagnostics for enabled and disabled providers", () => {
    const env = {
      PRICE_PROVIDERS_DISABLED: "binance",
    } as NodeJS.ProcessEnv;

    const providers = getKnownPriceProviderInfos(env);

    expect(
      providers.find((provider) => provider.name === "mempool"),
    ).toMatchObject({
      enabled: true,
      priority: 100,
    });
    expect(
      providers.find((provider) => provider.name === "binance"),
    ).toMatchObject({
      enabled: false,
      supportedCurrencies: ["USD", "EUR", "GBP"],
    });
  });

  it("creates providers only for resolved enabled names", () => {
    const env = {
      PRICE_PROVIDERS: "all",
      PRICE_PROVIDERS_DISABLED: "binance,coinbase",
    } as NodeJS.ProcessEnv;

    const providers = createConfiguredPriceProviders(env);

    expect(providers.map((provider) => provider.name)).toEqual([
      "mempool",
      "coingecko",
      "kraken",
    ]);
  });

  it("creates a known provider by name and rejects unknown names", () => {
    expect(createKnownPriceProvider(" Mempool ")?.name).toBe("mempool");
    expect(createKnownPriceProvider("does-not-exist")).toBeNull();
  });

  it("can create diagnostic providers without registering circuit breakers", () => {
    createKnownPriceProvider("coingecko", { registerCircuitBreaker: false });

    expect(circuitBreakerRegistry.getAllHealth()).toEqual([]);

    createKnownPriceProvider("coingecko");

    expect(circuitBreakerRegistry.getAllHealth().map((health) => health.name)).toEqual([
      "price-coingecko",
      "price-coingecko-chart",
    ]);
  });
});
