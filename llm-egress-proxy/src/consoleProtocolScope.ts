import { toPlainObject } from "./consoleProtocolObjects";
import type {
  ConsolePlanInput,
  FallbackWalletSelection,
} from "./consoleProtocolTypes";
import type { WalletTargetIntent } from "./consoleProtocolIntents";
import {
  resolveWalletReferenceFromPrompt,
  type WalletReference,
  type WalletReferenceResolution,
} from "./walletReferenceResolver";

export function hasTool(input: ConsolePlanInput, toolName: string): boolean {
  for (const tool of input.tools) {
    if (tool.name === toolName) return true;
  }
  return false;
}

export function getScopeWalletIds(scope: unknown): Array<string> {
  const record = toPlainObject(scope);
  if (record.kind === "wallet" && typeof record.walletId === "string") {
    return [record.walletId];
  }
  if (record.kind === "wallet_set" && Array.isArray(record.walletIds)) {
    const seen = new Set<string>();
    const walletIds: string[] = [];
    for (const walletId of record.walletIds) {
      if (
        typeof walletId !== "string" ||
        walletId.trim() === "" ||
        seen.has(walletId)
      ) {
        continue;
      }
      seen.add(walletId);
      walletIds.push(walletId);
    }
    return walletIds;
  }
  if (record.kind === "object" && typeof record.walletId === "string") {
    return [record.walletId];
  }
  return [];
}

export function isWalletSetScope(scope: unknown): boolean {
  return toPlainObject(scope).kind === "wallet_set";
}

export function isAutoContext(input: ConsolePlanInput): boolean {
  return toPlainObject(input.context).mode === "auto";
}

export function promptRequestsAllWallets(prompt: string): boolean {
  return /\b(all|every|each)\s+(visible\s+)?wallets?\b|\bacross\s+wallets?\b|\bportfolio\b|\beverything\b/i.test(
    prompt,
  );
}

function promptRequestsAllTransactions(prompt: string): boolean {
  return /\ball\s+(?:wallet\s+)?(?:transactions?|txs?|payments?)\b/i.test(
    prompt,
  );
}

function promptRequestsCurrentWallet(prompt: string): boolean {
  return /\b(?:this|current|selected)\s+wallet\b/i.test(prompt);
}

function contextWallets(input: ConsolePlanInput): Array<WalletReference> {
  const context = toPlainObject(input.context);
  if (!Array.isArray(context.wallets)) return [];

  return context.wallets.flatMap((value) => {
    const wallet = toPlainObject(value);
    return typeof wallet.id === "string" && typeof wallet.name === "string"
      ? [{ id: wallet.id, name: wallet.name }]
      : [];
  });
}

function namedWalletReference(
  input: ConsolePlanInput,
): WalletReferenceResolution {
  return resolveWalletReferenceFromPrompt({
    prompt: input.prompt,
    wallets: contextWallets(input),
    scopedWalletIds: getScopeWalletIds(input.scope),
  });
}

function currentWalletId(input: ConsolePlanInput): string | null {
  const value = toPlainObject(input.context).currentWalletId;
  return typeof value === "string" &&
    getScopeWalletIds(input.scope).includes(value)
    ? value
    : null;
}

function selectedFallbackWallets(
  walletIds: string[],
  warnings: string[] = [],
): FallbackWalletSelection {
  return { walletIds, warnings };
}

export function fallbackWalletSelection(input: ConsolePlanInput) {
  const scopeWalletIds = getScopeWalletIds(input.scope);
  if (!isAutoContext(input)) return selectedFallbackWallets(scopeWalletIds);

  const namedWallet = namedWalletReference(input);
  if (namedWallet.ok) return selectedFallbackWallets([namedWallet.walletId]);
  if (namedWallet.reason === "ambiguous") {
    return selectedFallbackWallets([], ["wallet_reference_ambiguous"]);
  }

  const current = currentWalletId(input);
  if (promptRequestsCurrentWallet(input.prompt)) {
    return selectedFallbackWallets(current ? [current] : []);
  }

  if (
    promptRequestsAllWallets(input.prompt) ||
    promptRequestsAllTransactions(input.prompt)
  ) {
    return selectedFallbackWallets(scopeWalletIds);
  }

  return selectedFallbackWallets(current ? [current] : scopeWalletIds);
}

function scopedWalletId(input: ConsolePlanInput): string | null {
  const walletIds = getScopeWalletIds(input.scope);
  return walletIds.length === 1 ? walletIds[0] : null;
}

export function intentTargetWalletIds(
  target: WalletTargetIntent,
  input: ConsolePlanInput,
): Array<string> {
  const scopeWalletIds = getScopeWalletIds(input.scope);
  switch (target.kind) {
    case "all_scoped_wallets":
      return scopeWalletIds;
    case "wallet_id":
      return scopeWalletIds.includes(target.walletId) ? [target.walletId] : [];
    case "current_wallet":
      return [currentWalletId(input) ?? scopedWalletId(input)].filter(
        (walletId): walletId is string => Boolean(walletId),
      );
  }
}
