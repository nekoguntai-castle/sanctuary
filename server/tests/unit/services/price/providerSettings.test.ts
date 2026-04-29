import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSystemSettings } = vi.hoisted(() => ({
  mockSystemSettings: {
    value: null as string | null,
    getValue: vi.fn(async () => mockSystemSettings.value),
    setJson: vi.fn(async (_key: string, value: unknown) => {
      mockSystemSettings.value = JSON.stringify(value);
      return { key: "price.providers.config", value: mockSystemSettings.value };
    }),
  },
}));

vi.mock("../../../../src/repositories/systemSettingRepository", () => ({
  SystemSettingKeys: {
    PRICE_PROVIDER_CONFIG: "price.providers.config",
  },
  getValue: mockSystemSettings.getValue,
  setJson: mockSystemSettings.setJson,
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  readPriceProviderConfig,
  setPriceProviderEnabled,
  writePriceProviderConfig,
} from "../../../../src/services/price/providerSettings";
import { SystemSettingKeys } from "../../../../src/repositories/systemSettingRepository";

describe("price provider settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSystemSettings.value = null;
  });

  it("bootstraps defaults when the DB setting is missing and no legacy env exists", async () => {
    const config = await readPriceProviderConfig({} as NodeJS.ProcessEnv);

    expect(config.enabled).toEqual([
      "mempool",
      "coingecko",
      "kraken",
      "coinbase",
    ]);
    expect(mockSystemSettings.setJson).toHaveBeenCalledWith(
      SystemSettingKeys.PRICE_PROVIDER_CONFIG,
      expect.objectContaining({
        enabled: ["mempool", "coingecko", "kraken", "coinbase"],
      }),
    );
  });

  it("bootstraps from legacy env only before DB config exists", async () => {
    const config = await readPriceProviderConfig({
      PRICE_PROVIDERS_ENABLED: "coingecko,binance,unknown",
      PRICE_PROVIDERS_DISABLED: "binance",
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toEqual(["coingecko"]);
  });

  it("uses the stored DB config instead of legacy env after bootstrap", async () => {
    mockSystemSettings.value = JSON.stringify({
      version: 1,
      enabled: ["mempool"],
      updatedAt: "2026-04-29T00:00:00.000Z",
      updatedBy: "admin-1",
    });

    const config = await readPriceProviderConfig({
      PRICE_PROVIDERS_ENABLED: "binance",
    } as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      enabled: ["mempool"],
      updatedBy: "admin-1",
    });
    expect(mockSystemSettings.setJson).not.toHaveBeenCalled();
  });

  it("filters unknown and duplicate provider names on write", async () => {
    const config = await writePriceProviderConfig(
      ["binance", "unknown", "binance", "mempool"],
      "admin-1",
    );

    expect(config.enabled).toEqual(["mempool", "binance"]);
    expect(config.updatedBy).toBe("admin-1");
  });

  it("rejects disabling the last enabled provider", async () => {
    mockSystemSettings.value = JSON.stringify({
      version: 1,
      enabled: ["mempool"],
      updatedAt: "2026-04-29T00:00:00.000Z",
      updatedBy: null,
    });

    await expect(setPriceProviderEnabled("mempool", false)).rejects.toThrow(
      "At least one price provider must remain enabled",
    );
  });

  it("rejects unknown providers", async () => {
    await expect(setPriceProviderEnabled("unknown", true)).rejects.toThrow(
      "Unknown price provider: unknown",
    );
  });
});
