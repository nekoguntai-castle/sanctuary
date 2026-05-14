import type { Express, Request, Response } from "express";
import { AI_ANALYSIS_TIMEOUT_MS } from "./constants";
import type { AiConfig, AiRequestResult } from "./aiClient";
import { callExternalAIWithMessagesResult } from "./aiClient";
import {
  ConsolePlanBodySchema,
  ConsoleSynthesisBodySchema,
  parseRequestBody,
} from "./requestSchemas";
import {
  buildConsolePlanMessages,
  buildConsoleSynthesisMessages,
  currentUtcDateString,
  parseConsolePlanResponse,
} from "./consoleProtocol";
import { rateLimit } from "./rateLimit";

interface ConsoleRoutesDeps {
  getAiConfig(): AiConfig;
}

type ConsoleAiFailureReason =
  | "provider_not_configured"
  | Exclude<
      Extract<AiRequestResult, { ok: false }>["reason"],
      "not_configured"
    >;

function requireEnabledConfig(aiConfig: AiConfig, res: Response): boolean {
  if (aiConfig.enabled) return true;
  res
    .status(503)
    .json({ error: "AI is not enabled", reason: "provider_not_configured" });
  return false;
}

function failureStatus(
  result: Extract<AiRequestResult, { ok: false }>,
): number {
  switch (result.reason) {
    case "timeout":
      return 504;
    case "endpoint_not_allowed":
      return 400;
    case "not_configured":
      return 503;
    case "http_error":
    case "invalid_response":
    case "request_failed":
      return 502;
  }
}

function consoleFailureReason(
  result: Extract<AiRequestResult, { ok: false }>,
): ConsoleAiFailureReason {
  return result.reason === "not_configured"
    ? "provider_not_configured"
    : result.reason;
}

function sendAiFailure(
  res: Response,
  result: Extract<AiRequestResult, { ok: false }>,
): Response {
  return res.status(failureStatus(result)).json({
    error: result.message,
    reason: consoleFailureReason(result),
    ...(result.status === undefined ? {} : { upstreamStatus: result.status }),
  });
}

export function registerConsoleRoutes(
  app: Express,
  deps: ConsoleRoutesDeps,
): void {
  /**
   * Console tool planning.
   *
   * INPUT: User prompt + backend-owned tool metadata
   * OUTPUT: Bounded JSON tool-call plan. The backend validates every call.
   */
  app.post("/console/plan", rateLimit, async (req: Request, res: Response) => {
    const body = parseRequestBody(
      ConsolePlanBodySchema,
      req,
      res,
      "console planning request required",
    );
    if (!body) return;

    const aiConfig = deps.getAiConfig();
    if (!requireEnabledConfig(aiConfig, res)) return;

    const planInput = { ...body, currentDate: currentUtcDateString() };
    const result = await callExternalAIWithMessagesResult(
      aiConfig,
      buildConsolePlanMessages(planInput),
      {
        timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
        temperature: 0,
        maxTokens: 512,
        allowReasoningContent: true,
      },
    );

    if (!result.ok) {
      return sendAiFailure(res, result);
    }

    res.json(
      parseConsolePlanResponse(result.content, body.maxToolCalls, planInput),
    );
  });

  /**
   * Console answer synthesis.
   *
   * INPUT: User prompt + sanitized Sanctuary tool facts/provenance
   * OUTPUT: Assistant response text.
   */
  app.post(
    "/console/synthesize",
    rateLimit,
    async (req: Request, res: Response) => {
      const body = parseRequestBody(
        ConsoleSynthesisBodySchema,
        req,
        res,
        "console synthesis request required",
      );
      if (!body) return;

      const aiConfig = deps.getAiConfig();
      if (!requireEnabledConfig(aiConfig, res)) return;

      const result = await callExternalAIWithMessagesResult(
        aiConfig,
        buildConsoleSynthesisMessages(body),
        {
          timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
          temperature: 0.3,
          maxTokens: 1200,
        },
      );

      if (!result.ok) {
        return sendAiFailure(res, result);
      }

      res.json({ response: result.content });
    },
  );
}
