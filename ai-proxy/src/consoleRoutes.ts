import type { Express, Request, Response } from "express";
import { AI_REQUEST_TIMEOUT_MS } from "./constants";
import type { AiConfig } from "./aiClient";
import { callExternalAIWithMessages } from "./aiClient";
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

    const result = await callExternalAIWithMessages(
      aiConfig,
      buildConsolePlanMessages(body),
      AI_REQUEST_TIMEOUT_MS,
    );

    if (!result) {
      return res.status(503).json({ error: "AI endpoint not available" });
    }

    res.json(parseConsolePlanResponse(result, body.maxToolCalls));
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

    const result = await callExternalAIWithMessages(
      aiConfig,
      buildConsoleSynthesisMessages(body),
      AI_REQUEST_TIMEOUT_MS,
    );

    if (!result) {
      return res.status(503).json({ error: "AI endpoint not available" });
    }

    res.json({ response: result });
  });
}
