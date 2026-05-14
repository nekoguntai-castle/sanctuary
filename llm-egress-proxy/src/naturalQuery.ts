import { AI_ANALYSIS_TIMEOUT_MS } from "./constants";
import { callExternalAIWithMessagesResult, type AiConfig } from "./aiClient";
import {
  buildConsolePlanMessages,
  currentUtcDateString,
  parseConsolePlanResponse,
  type ConsolePlanResponse,
  type ConsolePlannedToolCall,
  type ConsoleToolDescription,
} from "./consoleProtocol";

type NaturalQueryAggregation = "sum" | "count" | "max" | "min";
type NaturalQuerySortOrder = "asc" | "desc";

interface NaturalQueryObject {
  type: "transactions";
  filter?: Record<string, unknown>;
  sort?: {
    field: string;
    order: NaturalQuerySortOrder;
  };
  limit?: number;
  aggregation?: NaturalQueryAggregation;
}

export type NaturalQueryConversionResult =
  | { ok: true; query: NaturalQueryObject }
  | {
      ok: false;
      status: 500 | 503;
      error: string;
      preview?: string;
    };

const TRANSACTION_FILTER_TOOL: ConsoleToolDescription = {
  name: "query_transactions",
  title: "Query Transactions",
  description:
    "Filter, sort, count, or total the selected wallet's transaction table. Use type sent/received/consolidation, ISO dateFrom/dateTo, label, minAmount/maxAmount, confirmations, sort fields, limit, or aggregation.",
  sensitivity: "wallet",
  requiredScope: "wallet",
  inputFields: [
    "walletId",
    "type",
    "dateFrom",
    "dateTo",
    "confirmations",
    "label",
    "minAmount",
    "maxAmount",
    "sort",
    "sortField",
    "sortOrder",
    "limit",
    "aggregation",
  ],
};

const TX_TYPES = new Set(["sent", "received", "consolidation"]);
const AGGREGATIONS = new Set<NaturalQueryAggregation>([
  "sum",
  "count",
  "max",
  "min",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
};

const finiteNumber = (value: unknown): number | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const positiveInteger = (value: unknown): number | null => {
  const numberValue = finiteNumber(value);
  if (
    numberValue === null ||
    !Number.isInteger(numberValue) ||
    numberValue <= 0
  ) {
    return null;
  }
  return numberValue;
};

const hasEntries = (value: Record<string, unknown>): boolean => {
  return Object.keys(value).length > 0;
};

const normalizeTransactionType = (value: unknown): string | null => {
  const type = nonEmptyString(value)?.toLowerCase();
  if (!type) return null;
  if (type === "receive") return "received";
  if (type === "send") return "sent";
  return TX_TYPES.has(type) ? type : null;
};

const amountObject = (value: unknown): Record<string, number> | null => {
  if (!isRecord(value)) return null;

  const amount: Record<string, number> = {};
  for (const operator of [">", "<", ">=", "<="]) {
    const numberValue = finiteNumber(value[operator]);
    if (numberValue !== null) amount[operator] = numberValue;
  }
  return hasEntries(amount) ? amount : null;
};

function amountFilter(
  input: Record<string, unknown>,
): Record<string, number> | null {
  const existing = amountObject(input.amount);
  if (existing) return existing;

  const minAmount = finiteNumber(input.minAmount);
  const maxAmount = finiteNumber(input.maxAmount);
  const amount: Record<string, number> = {};
  if (minAmount !== null) amount[">="] = minAmount;
  if (maxAmount !== null) amount["<="] = maxAmount;
  return hasEntries(amount) ? amount : null;
}

function transactionFilter(
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  const type = normalizeTransactionType(input.type);
  const dateFrom = nonEmptyString(input.dateFrom);
  const dateTo = nonEmptyString(input.dateTo);
  const confirmations = finiteNumber(input.confirmations);
  const label = nonEmptyString(input.label);
  const amount = amountFilter(input);

  if (type) filter.type = type;
  if (dateFrom) filter.dateFrom = dateFrom;
  if (dateTo) filter.dateTo = dateTo;
  if (confirmations !== null) filter.confirmations = confirmations;
  if (label) filter.label = label;
  if (amount) filter.amount = amount;

  return hasEntries(filter) ? filter : undefined;
}

const parseSort = (
  input: Record<string, unknown>,
): NaturalQueryObject["sort"] => {
  const directSort = isRecord(input.sort) ? input.sort : {};
  const field =
    nonEmptyString(directSort.field) ??
    nonEmptyString(input.sortField) ??
    nonEmptyString(input.orderBy);
  if (!field) return undefined;

  const orderText =
    nonEmptyString(directSort.order) ??
    nonEmptyString(input.sortOrder) ??
    nonEmptyString(input.order);
  return {
    field,
    order: orderText?.toLowerCase() === "asc" ? "asc" : "desc",
  };
};

const parseAggregation = (
  value: unknown,
): NaturalQueryAggregation | undefined => {
  const aggregation = nonEmptyString(value)?.toLowerCase();
  return aggregation && AGGREGATIONS.has(aggregation as NaturalQueryAggregation)
    ? (aggregation as NaturalQueryAggregation)
    : undefined;
};

const transactionCall = (
  plan: ConsolePlanResponse,
): ConsolePlannedToolCall | null => {
  return (
    plan.toolCalls.find((call) => call.name === "query_transactions") ?? null
  );
};

const naturalQueryFromToolCall = (
  call: ConsolePlannedToolCall,
): NaturalQueryObject | null => {
  if (!isRecord(call.input)) return null;

  const query: NaturalQueryObject = { type: "transactions" };
  const filter = transactionFilter(call.input);
  const sort = parseSort(call.input);
  const limit = positiveInteger(call.input.limit);
  const aggregation = parseAggregation(call.input.aggregation);

  if (filter) query.filter = filter;
  if (sort) query.sort = sort;
  if (limit !== null) query.limit = limit;
  if (aggregation) query.aggregation = aggregation;

  return query;
};

const naturalQueryFromPlan = (
  plan: ConsolePlanResponse,
): NaturalQueryObject | null => {
  const call = transactionCall(plan);
  return call ? naturalQueryFromToolCall(call) : null;
};

export function buildNaturalQueryPrompt(input: {
  query: string;
  recentLabels: string;
}): string {
  const labels = input.recentLabels.trim();
  const context =
    labels && labels.toLowerCase() !== "none"
      ? `Known wallet labels: ${labels}`
      : "";

  return [input.query, context].filter(Boolean).join("\n\n");
}

export async function convertNaturalQuery(input: {
  aiConfig: AiConfig;
  query: string;
  walletId: string;
  recentLabels: string;
}): Promise<NaturalQueryConversionResult> {
  const currentDate = currentUtcDateString();
  const plannerInput = {
    prompt: buildNaturalQueryPrompt({
      query: input.query,
      recentLabels: input.recentLabels,
    }),
    currentDate,
    scope: { kind: "wallet", walletId: input.walletId },
    maxToolCalls: 1,
    tools: [TRANSACTION_FILTER_TOOL],
  };
  const fallbackPlannerInput = { ...plannerInput, prompt: input.query };
  const result = await callExternalAIWithMessagesResult(
    input.aiConfig,
    buildConsolePlanMessages(plannerInput),
    {
      timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
      temperature: 0,
      maxTokens: 512,
      allowReasoningContent: true,
    },
  );

  if (!result.ok) {
    const fallbackPlan = parseConsolePlanResponse("", 1, fallbackPlannerInput);
    const fallbackQuery = naturalQueryFromPlan(fallbackPlan);
    if (fallbackQuery) return { ok: true, query: fallbackQuery };

    return { ok: false, status: 503, error: "AI endpoint not available" };
  }

  const plan = parseConsolePlanResponse(
    result.content,
    1,
    fallbackPlannerInput,
  );
  const query = naturalQueryFromPlan(plan);
  if (!query) {
    const modelResponseWasJson = !plan.warnings.includes(
      "model_response_not_json",
    );
    return {
      ok: false,
      status: 500,
      error: modelResponseWasJson
        ? "AI did not return a transaction filter"
        : "AI did not return valid JSON",
      preview: result.content.substring(0, 200),
    };
  }

  return { ok: true, query };
}
