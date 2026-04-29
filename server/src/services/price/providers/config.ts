/**
 * Price provider configuration and factories.
 *
 * The registry should be driven by provider metadata and environment
 * configuration, not by route/UI conditionals.
 */

import { BinancePriceProvider } from "./binance";
import { CoinGeckoPriceProvider } from "./coingecko";
import { CoinbasePriceProvider } from "./coinbase";
import { KrakenPriceProvider } from "./kraken";
import { MempoolPriceProvider } from "./mempool";
import type { PriceProviderRuntimeOptions } from "./base";
import type { IPriceProvider, PriceProviderInfo } from "../types";

export const supportedCurrencies: Record<string, string[]> = {
  mempool: ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY"],
  coingecko: [
    "USD",
    "EUR",
    "GBP",
    "CAD",
    "CHF",
    "AUD",
    "JPY",
    "CNY",
    "KRW",
    "INR",
  ],
  kraken: ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY"],
  coinbase: ["USD", "EUR", "GBP", "CAD"],
  binance: ["USD", "EUR", "GBP"],
};

export const PRICE_PROVIDER_NAMES = [
  "mempool",
  "coingecko",
  "kraken",
  "coinbase",
  "binance",
] as const;

export type PriceProviderName = (typeof PRICE_PROVIDER_NAMES)[number];

interface PriceProviderSpec {
  name: PriceProviderName;
  priority: number;
  supportedCurrencies: string[];
  create: (options?: PriceProviderRuntimeOptions) => IPriceProvider;
}

const providerSpecs: PriceProviderSpec[] = [
  {
    name: "mempool",
    priority: 100,
    supportedCurrencies: supportedCurrencies.mempool,
    create: (options) => new MempoolPriceProvider(options),
  },
  {
    name: "coingecko",
    priority: 90,
    supportedCurrencies: supportedCurrencies.coingecko,
    create: (options) => new CoinGeckoPriceProvider(options),
  },
  {
    name: "kraken",
    priority: 80,
    supportedCurrencies: supportedCurrencies.kraken,
    create: (options) => new KrakenPriceProvider(options),
  },
  {
    name: "coinbase",
    priority: 70,
    supportedCurrencies: supportedCurrencies.coinbase,
    create: (options) => new CoinbasePriceProvider(options),
  },
  {
    name: "binance",
    priority: 60,
    supportedCurrencies: supportedCurrencies.binance,
    create: (options) => new BinancePriceProvider(options),
  },
];

function parseProviderList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function isPriceProviderName(name: string): name is PriceProviderName {
  return (PRICE_PROVIDER_NAMES as readonly string[]).includes(name);
}

function getRequestedProviderNames(
  env: NodeJS.ProcessEnv,
): PriceProviderName[] {
  const configured = env.PRICE_PROVIDERS_ENABLED ?? env.PRICE_PROVIDERS;
  const requested = parseProviderList(configured);

  if (requested.length === 0 || requested.includes("all")) {
    return [...PRICE_PROVIDER_NAMES];
  }

  return requested.filter(isPriceProviderName);
}

function getDisabledProviderNames(env: NodeJS.ProcessEnv): PriceProviderName[] {
  return parseProviderList(env.PRICE_PROVIDERS_DISABLED).filter(
    isPriceProviderName,
  );
}

export function resolveEnabledPriceProviderNames(
  env: NodeJS.ProcessEnv = process.env,
): PriceProviderName[] {
  const disabled = new Set(getDisabledProviderNames(env));
  return getRequestedProviderNames(env).filter((name) => !disabled.has(name));
}

export function getKnownPriceProviderInfos(
  env: NodeJS.ProcessEnv = process.env,
): PriceProviderInfo[] {
  const enabled = new Set(resolveEnabledPriceProviderNames(env));

  return providerSpecs.map((spec) => ({
    name: spec.name,
    priority: spec.priority,
    supportedCurrencies: [...spec.supportedCurrencies],
    enabled: enabled.has(spec.name),
  }));
}

export function createKnownPriceProvider(
  name: string,
  options?: PriceProviderRuntimeOptions,
): IPriceProvider | null {
  const normalizedName = name.trim().toLowerCase();
  const spec = providerSpecs.find(
    (providerSpec) => providerSpec.name === normalizedName,
  );
  return spec?.create(options) ?? null;
}

export function createConfiguredPriceProviders(
  env: NodeJS.ProcessEnv = process.env,
): IPriceProvider[] {
  const enabled = new Set(resolveEnabledPriceProviderNames(env));
  return providerSpecs
    .filter((spec) => enabled.has(spec.name))
    .map((spec) => spec.create());
}
