/**
 * LLM egress proxy transaction filter values.
 *
 * Keep this module proxy-local to preserve the proxy isolation boundary. These
 * values mirror Sanctuary's persisted transaction filter vocabulary, while
 * natural-language aliases are normalized before proxy callers receive filters.
 */

export const PROXY_TRANSACTION_FILTER_TYPES = [
  "sent",
  "received",
  "consolidation",
] as const;

export type ProxyTransactionFilterType = (typeof PROXY_TRANSACTION_FILTER_TYPES)[number];

export const PROXY_TRANSACTION_TYPE_ALIASES = {
  send: "sent",
  receive: "received",
} as const;

type ProxyTransactionTypeAlias = keyof typeof PROXY_TRANSACTION_TYPE_ALIASES;

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isProxyTransactionFilterType(
  value: unknown,
): value is ProxyTransactionFilterType {
  return includesString(PROXY_TRANSACTION_FILTER_TYPES, value);
}

export function normalizeProxyTransactionFilterType(
  value: unknown,
): ProxyTransactionFilterType | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (isProxyTransactionFilterType(normalized)) return normalized;
  return PROXY_TRANSACTION_TYPE_ALIASES[normalized as ProxyTransactionTypeAlias] ?? null;
}
