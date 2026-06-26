import {
  parseConsoleIntent,
  rawPlanIntents,
  type BitcoinNetworkStatusIntent,
  type ConsoleIntent,
  type DashboardSummaryIntent,
  type FeeEstimatesIntent,
  type MarketStatusIntent,
  type PriceConversionIntent,
  type TransactionIntent,
  type WalletOverviewIntent,
} from "./consoleProtocolIntents";
import {
  fallbackPromptDateRange,
  referenceYear,
  resolveDateRangeIntent,
} from "./consoleProtocolDates";
import {
  fallbackWalletSelection,
  getScopeWalletIds,
  hasTool,
  intentTargetWalletIds,
  isAutoContext,
  isWalletSetScope,
  promptRequestsAllWallets,
} from "./consoleProtocolScope";
import type {
  ConsolePlanInput,
  ConsolePlannedToolCall,
  FallbackToolPlan,
} from "./consoleProtocolTypes";

export function emptyFallbackPlan(): FallbackToolPlan {
  return { toolCalls: [], warnings: [] };
}

function buildTransactionFallbackPlan(
  input: ConsolePlanInput,
  maxToolCalls: number,
): FallbackToolPlan {
  const selection = fallbackWalletSelection(input);
  const walletIds = selection.walletIds;
  const prompt = input.prompt.toLowerCase();
  const mentionsTransactionHistory =
    /\bhistory\b/.test(prompt) && !/\bbalance\s+history\b/.test(prompt);
  const mentionsTransactions =
    /\b(transactions?|txs?|payments?|wallet activity)\b/.test(prompt) ||
    mentionsTransactionHistory;

  if (
    walletIds.length === 0 ||
    !mentionsTransactions ||
    !hasTool(input, "query_transactions")
  ) {
    return { toolCalls: [], warnings: selection.warnings };
  }

  const selectedWalletIds = walletIds.slice(0, maxToolCalls);
  const warnings = toolCallLimitWarnings(
    walletIds.length,
    selectedWalletIds.length,
  );
  warnings.push(...selection.warnings);
  return {
    toolCalls: selectedWalletIds.map((walletId) => ({
      name: "query_transactions",
      input: {
        walletId,
        ...fallbackPromptDateRange(input),
      },
      reason: "Fallback plan for wallet transaction request.",
    })),
    warnings,
  };
}

type PromptTermSet = ReadonlySet<string>;

const DASHBOARD_PROMPT_TERMS = new Set([
  "all wallet",
  "all wallets",
  "portfolio",
  "dashboard",
  "balance",
  "balances",
  "overview",
  "summary",
  "total",
]);
const OVERVIEW_PROMPT_TERMS = new Set([
  "wallet",
  "balance",
  "overview",
  "summary",
]);

const containsAnyTerm = (text: string, terms: PromptTermSet): boolean =>
  Array.from(terms).some((term) => text.includes(term));

const asksForBroadHealth = (text: string): boolean =>
  text.includes("how ") && (text.includes(" doing") || text.includes(" look"));

const asksForDashboardFallback = (prompt: string): boolean => {
  const text = prompt.toLowerCase();
  return (
    containsAnyTerm(text, DASHBOARD_PROMPT_TERMS) || asksForBroadHealth(text)
  );
};

const allowsDashboardFallback = (input: ConsolePlanInput): boolean =>
  !isAutoContext(input) || promptRequestsAllWallets(input.prompt);

function withFallbackApplied(plan: FallbackToolPlan) {
  if (plan.toolCalls.length === 0) return plan;

  const warnings = ["fallback_plan_applied"];
  warnings.push(...plan.warnings);
  return {
    toolCalls: plan.toolCalls,
    warnings,
  };
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings));
}

export function buildFallbackToolPlan(
  input: ConsolePlanInput | undefined,
  maxToolCalls: number,
): FallbackToolPlan {
  if (!input || maxToolCalls <= 0) return emptyFallbackPlan();

  const candidates = [
    buildPublicToolFallbackPlan(input, maxToolCalls),
    buildTransactionFallbackPlan(input, maxToolCalls),
    buildDashboardFallbackPlan(input),
    buildOverviewFallbackPlan(input),
  ];

  const selected = candidates.find((plan) => plan.toolCalls.length > 0);
  if (selected) return withFallbackApplied(selected);

  return {
    toolCalls: [],
    warnings: uniqueWarnings(candidates.flatMap((plan) => plan.warnings)),
  };
}

function transactionIntentLimit(intent: TransactionIntent) {
  return intent.limit?.kind === "explicit" ? { limit: intent.limit.value } : {};
}

function transactionIntentCallInput(
  intent: TransactionIntent,
  walletId: string,
  currentYear: number,
): Record<string, unknown> {
  const filters = intent.filters ?? {};
  return {
    walletId,
    ...resolveDateRangeIntent(filters.dateRange, currentYear),
    ...(filters.type ? { type: filters.type } : {}),
    ...transactionIntentLimit(intent),
  };
}

function buildTransactionIntentToolPlan(
  intent: TransactionIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
): FallbackToolPlan {
  if (!hasTool(input, "query_transactions") || maxToolCalls <= 0) {
    return emptyFallbackPlan();
  }

  const walletIds = intentTargetWalletIds(intent.target, input);
  const selectedWalletIds = walletIds.slice(0, maxToolCalls);
  const currentYear = referenceYear(input);
  return {
    toolCalls: selectedWalletIds.map((walletId) =>
      transactionIntentToolCall(intent, walletId, currentYear),
    ),
    warnings: toolCallLimitWarnings(walletIds.length, selectedWalletIds.length),
  };
}

export function toolCallLimitWarnings(
  totalCount: number,
  selectedCount: number,
): string[] {
  return totalCount > selectedCount ? ["tool_call_limit_applied"] : [];
}

function transactionIntentToolCall(
  intent: TransactionIntent,
  walletId: string,
  currentYear: number,
): ConsolePlannedToolCall {
  return {
    name: "query_transactions",
    input: transactionIntentCallInput(intent, walletId, currentYear),
    reason: intent.reason ?? "Resolved transaction query intent.",
  };
}

function buildWalletOverviewIntentToolPlan(
  intent: WalletOverviewIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
): FallbackToolPlan {
  if (!hasTool(input, "get_wallet_overview") || maxToolCalls <= 0) {
    return emptyFallbackPlan();
  }

  const walletIds = intentTargetWalletIds(intent.target, input);
  const selectedWalletIds = walletIds.slice(0, maxToolCalls);
  return {
    toolCalls: selectedWalletIds.map((walletId) => ({
      name: "get_wallet_overview",
      input: { walletId },
      reason: intent.reason ?? "Resolved wallet overview intent.",
    })),
    warnings: toolCallLimitWarnings(walletIds.length, selectedWalletIds.length),
  };
}

function buildDashboardSummaryIntentToolPlan(
  intent: DashboardSummaryIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  if (
    !hasTool(input, "get_dashboard_summary") ||
    maxToolCalls <= 0 ||
    getScopeWalletIds(input.scope).length === 0
  ) {
    return emptyFallbackPlan();
  }

  return {
    toolCalls: [
      {
        name: "get_dashboard_summary",
        input: {},
        reason: intent.reason ?? "Resolved dashboard summary intent.",
      },
    ],
    warnings: [],
  };
}

function buildPublicToolIntentPlan(
  input: ConsolePlanInput,
  toolName: string,
  callInput: Record<string, unknown>,
  reason: string,
  maxToolCalls: number,
): FallbackToolPlan {
  if (!hasTool(input, toolName) || maxToolCalls <= 0) {
    return emptyFallbackPlan();
  }

  return {
    toolCalls: [
      {
        name: toolName,
        input: callInput,
        reason,
      },
    ],
    warnings: [],
  };
}

function marketStatusCallInput(
  intent: MarketStatusIntent,
): Record<string, unknown> {
  return {
    ...(intent.currencies ? { currencies: intent.currencies } : {}),
    ...(intent.includeFees === undefined
      ? {}
      : { includeFees: intent.includeFees }),
  };
}

function priceConversionCallInput(
  intent: PriceConversionIntent,
): Record<string, unknown> {
  return {
    ...(intent.sats === undefined ? {} : { sats: intent.sats }),
    ...(intent.fiatAmount === undefined
      ? {}
      : { fiatAmount: intent.fiatAmount }),
    ...(intent.currency ? { currency: intent.currency } : {}),
  };
}

function buildMarketStatusIntentToolPlan(
  intent: MarketStatusIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  return buildPublicToolIntentPlan(
    input,
    "get_market_status",
    marketStatusCallInput(intent),
    intent.reason ?? "Resolved market status intent.",
    maxToolCalls,
  );
}

function buildFeeEstimatesIntentToolPlan(
  intent: FeeEstimatesIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  return buildPublicToolIntentPlan(
    input,
    "get_fee_estimates",
    {},
    intent.reason ?? "Resolved fee estimates intent.",
    maxToolCalls,
  );
}

function buildBitcoinNetworkStatusIntentToolPlan(
  intent: BitcoinNetworkStatusIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  return buildPublicToolIntentPlan(
    input,
    "get_bitcoin_network_status",
    {},
    intent.reason ?? "Resolved Bitcoin network status intent.",
    maxToolCalls,
  );
}

function buildPriceConversionIntentToolPlan(
  intent: PriceConversionIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  return buildPublicToolIntentPlan(
    input,
    "convert_price",
    priceConversionCallInput(intent),
    intent.reason ?? "Resolved price conversion intent.",
    maxToolCalls,
  );
}

function buildConsoleIntentToolPlan(
  intent: ConsoleIntent,
  input: ConsolePlanInput,
  maxToolCalls: number,
) {
  switch (intent.name) {
    case "query_transactions":
      return buildTransactionIntentToolPlan(intent, input, maxToolCalls);
    case "get_wallet_overview":
      return buildWalletOverviewIntentToolPlan(intent, input, maxToolCalls);
    case "get_dashboard_summary":
      return buildDashboardSummaryIntentToolPlan(intent, input, maxToolCalls);
    case "get_market_status":
      return buildMarketStatusIntentToolPlan(intent, input, maxToolCalls);
    case "get_fee_estimates":
      return buildFeeEstimatesIntentToolPlan(intent, input, maxToolCalls);
    case "get_bitcoin_network_status":
      return buildBitcoinNetworkStatusIntentToolPlan(
        intent,
        input,
        maxToolCalls,
      );
    case "convert_price":
      return buildPriceConversionIntentToolPlan(intent, input, maxToolCalls);
  }
}

export function resolvePlanIntents(
  parsed: Record<string, unknown>,
  input: ConsolePlanInput | undefined,
  maxToolCalls: number,
) {
  const rawIntents = rawPlanIntents(parsed);
  if (!input || rawIntents.length === 0) return emptyFallbackPlan();

  const toolCalls: ConsolePlannedToolCall[] = [];
  const warnings: string[] = [];
  let invalidIntentCount = 0;
  let unresolvedIntentCount = 0;

  for (const rawIntent of rawIntents) {
    const intent = parseConsoleIntent(rawIntent);
    if (!intent) {
      invalidIntentCount += 1;
      continue;
    }
    const plan = buildConsoleIntentToolPlan(
      intent,
      input,
      maxToolCalls - toolCalls.length,
    );
    if (plan.toolCalls.length === 0) {
      unresolvedIntentCount += 1;
    }
    toolCalls.push(...plan.toolCalls);
    warnings.push(...plan.warnings);
  }

  return {
    toolCalls,
    warnings: [
      ...(invalidIntentCount > 0 ? ["model_response_invalid_intent"] : []),
      ...(unresolvedIntentCount > 0
        ? ["model_response_unresolved_intent"]
        : []),
      ...warnings,
    ],
  };
}

function asksForOverviewFallback(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    containsAnyTerm(text, OVERVIEW_PROMPT_TERMS) || asksForBroadHealth(text)
  );
}

function buildPublicToolFallbackPlan(
  input: ConsolePlanInput,
  maxToolCalls: number,
): FallbackToolPlan {
  if (maxToolCalls <= 0) return emptyFallbackPlan();

  const text = input.prompt.toLowerCase();
  if (/\b(fees?|fee estimates?|sat\/vbytes?|sat\/vbs?)\b/.test(text)) {
    return hasTool(input, "get_fee_estimates")
      ? {
          toolCalls: [
            {
              name: "get_fee_estimates",
              input: {},
              reason: "Fallback plan for fee estimate request.",
            },
          ],
          warnings: [],
        }
      : emptyFallbackPlan();
  }

  if (/\b(network|mempool|block height|height|blocks?)\b/.test(text)) {
    return hasTool(input, "get_bitcoin_network_status")
      ? {
          toolCalls: [
            {
              name: "get_bitcoin_network_status",
              input: {},
              reason: "Fallback plan for Bitcoin network status request.",
            },
          ],
          warnings: [],
        }
      : emptyFallbackPlan();
  }

  if (/\b(price|worth|rate|market)\b/.test(text)) {
    return hasTool(input, "get_market_status")
      ? {
          toolCalls: [
            {
              name: "get_market_status",
              input: {},
              reason: "Fallback plan for market status request.",
            },
          ],
          warnings: [],
        }
      : emptyFallbackPlan();
  }

  return emptyFallbackPlan();
}

function buildOverviewFallbackPlan(input: ConsolePlanInput): FallbackToolPlan {
  const selection = fallbackWalletSelection(input);
  const walletIds = selection.walletIds;
  const walletId = walletIds.length === 1 ? walletIds[0] : null;
  if (
    !walletId ||
    !asksForOverviewFallback(input.prompt) ||
    !hasTool(input, "get_wallet_overview")
  ) {
    return { toolCalls: [], warnings: selection.warnings };
  }

  const plan = buildWalletOverviewFallbackPlan(walletId);
  return { toolCalls: plan.toolCalls, warnings: selection.warnings };
}

function buildDashboardFallbackPlan(input: ConsolePlanInput): FallbackToolPlan {
  if (
    !isWalletSetScope(input.scope) ||
    !allowsDashboardFallback(input) ||
    !asksForDashboardFallback(input.prompt) ||
    !hasTool(input, "get_dashboard_summary")
  ) {
    return emptyFallbackPlan();
  }

  return {
    toolCalls: [
      {
        name: "get_dashboard_summary",
        input: { limit: 100 },
        reason: "Fallback plan for all-wallet dashboard summary.",
      },
    ],
    warnings: [],
  };
}

function buildWalletOverviewFallbackPlan(walletId: string): FallbackToolPlan {
  return {
    toolCalls: [
      {
        name: "get_wallet_overview",
        input: { walletId },
        reason: "Fallback plan for wallet overview request.",
      },
    ],
    warnings: [],
  };
}
