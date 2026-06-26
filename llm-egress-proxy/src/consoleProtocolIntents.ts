import { z } from "zod";
import {
  PROXY_TRANSACTION_FILTER_TYPES,
  normalizeProxyTransactionFilterType,
} from "./transactionTypes";
import { toPlainObject } from "./consoleProtocolObjects";

const RelativeDateRangeIntentValueSchema = z.enum([
  "current_year",
  "previous_year",
]);

const DateRangeIntentSchema = z.preprocess(
  (value) => (typeof value === "string" ? { kind: "relative", value } : value),
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("relative"),
        value: RelativeDateRangeIntentValueSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("explicit"),
        dateFrom: z.string().trim().min(1).optional(),
        dateTo: z.string().trim().min(1).optional(),
      })
      .strict()
      .refine((value) => value.dateFrom || value.dateTo),
  ]),
);

const WalletTargetIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current_wallet") }).strict(),
  z.object({ kind: z.literal("all_scoped_wallets") }).strict(),
  z
    .object({
      kind: z.literal("wallet_id"),
      walletId: z.string().trim().min(1),
    })
    .strict(),
]);

const TransactionLimitIntentSchema = z.preprocess(
  (value) => (typeof value === "number" ? { kind: "explicit", value } : value),
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("explicit"),
        value: z.number().int().positive().max(500),
      })
      .strict(),
    z.object({ kind: z.literal("default") }).strict(),
  ]),
);

const TransactionFilterTypeSchema = z.preprocess(
  normalizeProxyTransactionFilterType,
  z.enum(PROXY_TRANSACTION_FILTER_TYPES),
);

function normalizedIntentRecord(value: unknown): Record<string, unknown> {
  const intent = toPlainObject(value);
  const name = typeof intent.name === "string" ? intent.name : intent.intent;
  return { ...intent, name };
}

function normalizedTransactionIntentRecord(
  value: unknown,
): Record<string, unknown> {
  const intent = normalizedIntentRecord(value);
  const rawFilters = intent.filters;
  if (
    !rawFilters ||
    typeof rawFilters !== "object" ||
    Array.isArray(rawFilters)
  ) {
    return intent;
  }

  const filters = rawFilters as Record<string, unknown>;
  const filtersWithoutLimit = { ...filters };
  const legacyLimit = filtersWithoutLimit.limit;
  delete filtersWithoutLimit.limit;

  return {
    ...intent,
    filters:
      Object.keys(filtersWithoutLimit).length > 0
        ? filtersWithoutLimit
        : undefined,
    limit: intent.limit ?? legacyLimit,
  };
}

const TransactionIntentSchema = z.preprocess(
  normalizedTransactionIntentRecord,
  z
    .object({
      name: z.literal("query_transactions"),
      target: WalletTargetIntentSchema,
      filters: z
        .object({
          dateRange: DateRangeIntentSchema.optional(),
          type: TransactionFilterTypeSchema.optional(),
        })
        .strict()
        .optional(),
      limit: TransactionLimitIntentSchema.optional(),
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const WalletOverviewIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("get_wallet_overview"),
      target: WalletTargetIntentSchema,
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const DashboardSummaryTargetIntentSchema = z
  .object({
    kind: z.literal("all_scoped_wallets"),
  })
  .strict();

const DashboardSummaryIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("get_dashboard_summary"),
      target: DashboardSummaryTargetIntentSchema.default({
        kind: "all_scoped_wallets",
      }),
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const MarketStatusIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("get_market_status"),
      currencies: z
        .array(z.string().trim().min(3).max(8))
        .min(1)
        .max(8)
        .optional(),
      includeFees: z.boolean().optional(),
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const FeeEstimatesIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("get_fee_estimates"),
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const BitcoinNetworkStatusIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("get_bitcoin_network_status"),
      reason: z.string().trim().max(240).optional(),
    })
    .strict(),
);

const PriceConversionIntentSchema = z.preprocess(
  normalizedIntentRecord,
  z
    .object({
      name: z.literal("convert_price"),
      sats: z
        .union([z.string().trim().min(1), z.number().positive()])
        .optional(),
      fiatAmount: z.number().positive().optional(),
      currency: z.string().trim().min(3).max(8).optional(),
      reason: z.string().trim().max(240).optional(),
    })
    .strict()
    .refine(
      (value) =>
        (value.sats === undefined) !== (value.fiatAmount === undefined),
    ),
);

export type TransactionIntent = z.infer<typeof TransactionIntentSchema>;
export type WalletOverviewIntent = z.infer<typeof WalletOverviewIntentSchema>;
export type DashboardSummaryIntent = z.infer<
  typeof DashboardSummaryIntentSchema
>;
export type MarketStatusIntent = z.infer<typeof MarketStatusIntentSchema>;
export type FeeEstimatesIntent = z.infer<typeof FeeEstimatesIntentSchema>;
export type BitcoinNetworkStatusIntent = z.infer<
  typeof BitcoinNetworkStatusIntentSchema
>;
export type PriceConversionIntent = z.infer<typeof PriceConversionIntentSchema>;
export type ConsoleIntent =
  | TransactionIntent
  | WalletOverviewIntent
  | DashboardSummaryIntent
  | MarketStatusIntent
  | FeeEstimatesIntent
  | BitcoinNetworkStatusIntent
  | PriceConversionIntent;
export type WalletTargetIntent = z.infer<typeof WalletTargetIntentSchema>;
export type DateRangeIntent = z.infer<typeof DateRangeIntentSchema>;
export type RelativeDateRangeValue = z.infer<
  typeof RelativeDateRangeIntentValueSchema
>;

export function rawPlanIntents(parsed: Record<string, unknown>) {
  if (Array.isArray(parsed.intents)) return parsed.intents;
  if (typeof parsed.intent === "string") return [parsed];
  return parsed.intent === undefined ? [] : [parsed.intent];
}

function rawIntentName(value: unknown) {
  const intent = toPlainObject(value);
  const name = typeof intent.name === "string" ? intent.name : intent.intent;
  return typeof name === "string" ? name : null;
}

export function parseConsoleIntent(value: unknown): ConsoleIntent | null {
  switch (rawIntentName(value)) {
    case "query_transactions": {
      const parsed = TransactionIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "get_wallet_overview": {
      const parsed = WalletOverviewIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "get_dashboard_summary": {
      const parsed = DashboardSummaryIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "get_market_status": {
      const parsed = MarketStatusIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "get_fee_estimates": {
      const parsed = FeeEstimatesIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "get_bitcoin_network_status": {
      const parsed = BitcoinNetworkStatusIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "convert_price": {
      const parsed = PriceConversionIntentSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    default:
      return null;
  }
}
