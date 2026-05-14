export interface WalletReference {
  id: string;
  name: string;
}

export type WalletReferenceResolution =
  | { ok: true; walletId: string }
  | { ok: false; reason: "ambiguous" | "not_found" };

interface WalletReferenceResolverInput {
  prompt: string;
  wallets: WalletReference[];
  scopedWalletIds: Iterable<string>;
}

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizedText(value: string): string {
  return normalizedTokens(value).join(" ");
}

function quotedSegments(value: string): string[] {
  const segments: string[] = [];
  let quote: "'" | '"' | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!quote && (char === "'" || char === '"')) {
      quote = char;
      start = index + 1;
      continue;
    }
    if (quote && char === quote) {
      segments.push(value.slice(start, index));
      quote = null;
    }
  }

  return segments;
}

function isShortName(tokens: string[]): boolean {
  return tokens.length === 1 && tokens[0].length < 3;
}

function containsTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;

  for (let start = 0; start <= tokens.length - sequence.length; start += 1) {
    const matched = sequence.every(
      (token, offset) => tokens[start + offset] === token,
    );
    if (matched) return true;
  }

  return false;
}

function quotedReferenceMatches(prompt: string, walletName: string): boolean {
  const normalizedName = normalizedText(walletName);
  if (!normalizedName) return false;

  return quotedSegments(prompt).some(
    (segment) => normalizedText(segment) === normalizedName,
  );
}

function walletMatchesPrompt(
  prompt: string,
  promptTokens: string[],
  wallet: WalletReference,
): boolean {
  const nameTokens = normalizedTokens(wallet.name);
  if (quotedReferenceMatches(prompt, wallet.name)) return true;
  if (isShortName(nameTokens)) return false;
  return containsTokenSequence(promptTokens, nameTokens);
}

/**
 * Resolves an accessible wallet name mentioned in fallback prompt planning.
 * Unquoted names must match complete normalized tokens, very short names require
 * an exact quoted reference, and multiple scoped matches fail closed as ambiguous.
 */
export function resolveWalletReferenceFromPrompt(
  input: WalletReferenceResolverInput,
): WalletReferenceResolution {
  const scopedWalletIds = new Set(input.scopedWalletIds);
  const promptTokens = normalizedTokens(input.prompt);
  const seenWalletIds = new Set<string>();
  const matches: WalletReference[] = [];
  for (const wallet of input.wallets) {
    if (
      seenWalletIds.has(wallet.id) ||
      !scopedWalletIds.has(wallet.id) ||
      !walletMatchesPrompt(input.prompt, promptTokens, wallet)
    ) {
      continue;
    }
    seenWalletIds.add(wallet.id);
    matches.push(wallet);
  }

  if (matches.length === 0) return { ok: false, reason: "not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, walletId: matches[0].id };
}
