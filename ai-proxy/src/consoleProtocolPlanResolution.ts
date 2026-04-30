import { rawPlanIntents } from "./consoleProtocolIntents";
import {
  keepKnownToolCalls,
  parsedPlanToolCalls,
  parseStructuredPlan,
} from "./consoleProtocolPlanParsing";
import {
  buildFallbackToolPlan,
  emptyFallbackPlan,
  resolvePlanIntents,
} from "./consoleProtocolPlanning";
import type {
  ConsolePlanInput,
  ConsolePlanResponse,
  ConsolePlannedToolCall,
  FallbackToolPlan,
} from "./consoleProtocolTypes";

function fallbackForParsedPlan(
  parsed: Record<string, unknown>,
  toolCalls: ConsolePlannedToolCall[],
  intentPlan: FallbackToolPlan,
  input: ConsolePlanInput | undefined,
  maxToolCalls: number,
): FallbackToolPlan {
  const hasIntentOutput = rawPlanIntents(parsed).length > 0;
  return toolCalls.length === 0 &&
    intentPlan.toolCalls.length === 0 &&
    !hasIntentOutput
    ? buildFallbackToolPlan(input, maxToolCalls)
    : emptyFallbackPlan();
}

function parsedPlanWarnings(
  knownCalls: ReturnType<typeof keepKnownToolCalls>,
  maxToolCalls: number,
  intentPlan: FallbackToolPlan,
  fallback: FallbackToolPlan,
): string[] {
  return [
    ...(knownCalls.rejectedToolCount > 0
      ? ["model_response_unknown_tool"]
      : []),
    ...(knownCalls.toolCalls.length > maxToolCalls
      ? ["tool_call_limit_applied"]
      : []),
    ...intentPlan.warnings,
    ...fallback.warnings,
  ];
}

function resolvedPlanToolCalls(
  toolCalls: ConsolePlannedToolCall[],
  intentPlan: FallbackToolPlan,
  fallback: FallbackToolPlan,
): ConsolePlannedToolCall[] {
  if (toolCalls.length > 0) return toolCalls;
  return intentPlan.toolCalls.length > 0
    ? intentPlan.toolCalls
    : fallback.toolCalls;
}

export function parseConsolePlanResponse(
  raw: string,
  maxToolCalls: number,
  input?: ConsolePlanInput,
): ConsolePlanResponse {
  const parsed = parseStructuredPlan(raw);
  if (!parsed) {
    const fallback = buildFallbackToolPlan(input, maxToolCalls);
    return {
      toolCalls: fallback.toolCalls,
      warnings: ["model_response_not_json", ...fallback.warnings],
    };
  }

  const knownCalls = keepKnownToolCalls(parsedPlanToolCalls(parsed), input);
  const toolCalls = knownCalls.toolCalls.slice(0, maxToolCalls);
  const intentPlan =
    toolCalls.length === 0
      ? resolvePlanIntents(parsed, input, maxToolCalls)
      : emptyFallbackPlan();
  const fallback = fallbackForParsedPlan(
    parsed,
    toolCalls,
    intentPlan,
    input,
    maxToolCalls,
  );

  return {
    toolCalls: resolvedPlanToolCalls(toolCalls, intentPlan, fallback),
    warnings: parsedPlanWarnings(
      knownCalls,
      maxToolCalls,
      intentPlan,
      fallback,
    ),
  };
}
