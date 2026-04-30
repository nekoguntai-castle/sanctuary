import { parseStructuredResponse } from "./aiClient";
import { extractJsonObjects } from "./consoleJsonRecovery";
import { toPlainObject } from "./consoleProtocolObjects";
import type {
  ConsolePlanInput,
  ConsolePlannedToolCall,
} from "./consoleProtocolTypes";

export function parseToolCall(value: unknown): ConsolePlannedToolCall | null {
  const call = toPlainObject(value);
  const name = typeof call.name === "string" ? call.name.trim() : "";
  if (!name) return null;

  return {
    name,
    input: toPlainObject(call.input),
    ...(typeof call.reason === "string" && call.reason.trim()
      ? { reason: call.reason.trim().slice(0, 240) }
      : {}),
  };
}

export function keepKnownToolCalls(
  toolCalls: ConsolePlannedToolCall[],
  input?: ConsolePlanInput,
): {
  toolCalls: ConsolePlannedToolCall[];
  rejectedToolCount: number;
} {
  if (!input) {
    return { toolCalls, rejectedToolCount: 0 };
  }

  const knownToolNames = new Set(input.tools.map((tool) => tool.name));
  const knownCalls = toolCalls.filter((call) => knownToolNames.has(call.name));

  return {
    toolCalls: knownCalls,
    rejectedToolCount: toolCalls.length - knownCalls.length,
  };
}

function parsePlanObject(value: unknown): Record<string, unknown> | null {
  const candidate = toPlainObject(value);
  if (
    Array.isArray(candidate.toolCalls) ||
    Array.isArray(candidate.tools) ||
    Array.isArray(candidate.intents) ||
    candidate.intent !== undefined
  ) {
    return candidate;
  }
  return null;
}

function parseJsonCandidate(candidate: string): Record<string, unknown> | null {
  try {
    return parsePlanObject(JSON.parse(candidate));
  } catch {
    return null;
  }
}

function recoverStructuredPlan(raw: string): Record<string, unknown> | null {
  const codeBlocks = Array.from(
    raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
    (match) => match[1]?.trim() ?? "",
  ).filter(Boolean);
  const candidates = [...codeBlocks, ...extractJsonObjects(raw)];

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

export function parseStructuredPlan(
  raw: string,
): Record<string, unknown> | null {
  return (
    parsePlanObject(parseStructuredResponse(raw)) ?? recoverStructuredPlan(raw)
  );
}

export function rawPlanToolCalls(parsed: Record<string, unknown>): unknown[] {
  if (Array.isArray(parsed.toolCalls)) return parsed.toolCalls;
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

export function parsedPlanToolCalls(
  parsed: Record<string, unknown>,
): ConsolePlannedToolCall[] {
  return rawPlanToolCalls(parsed)
    .map(parseToolCall)
    .filter((call): call is ConsolePlannedToolCall => call !== null);
}
