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
  parseConsolePlanResponse,
} from "./consoleProtocol";
import { rateLimit } from "./rateLimit";

interface ConsoleRoutesDeps {
  getAiConfig(): AiConfig;
}

function requireEnabledConfig(aiConfig: AiConfig, res: Response): boolean {
  if (aiConfig.enabled) return true;
  res.status(503).json({ error: "AI is not enabled" });
  return false;
}

function failureStatus(result: Extract<AiRequestResult, { ok: false }>): number {
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

function sendAiFailure(
  res: Response,
  result: Extract<AiRequestResult, { ok: false }>,
): Response {
  return res.status(failureStatus(result)).json({
    error: result.message,
    reason: result.reason,
    ...(result.status === undefined ? {} : { upstreamStatus: result.status }),
  });
}

export function registerConsoleRoutes(app: Express, deps: ConsoleRoutesDeps): void {
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

    const result = await callExternalAIWithMessagesResult(
      aiConfig,
      buildConsolePlanMessages(body),
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

    res.json(parseConsolePlanResponse(result.content, body.maxToolCalls, body));
  });

  /**
   * Console answer synthesis.
   *
   * INPUT: User prompt + sanitized Sanctuary tool facts/provenance
   * OUTPUT: Assistant response text.
   */
  app.post("/console/synthesize", rateLimit, async (req: Request, res: Response) => {
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
  });
}
