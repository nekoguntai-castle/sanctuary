import type { Express, Request, Response } from "express";
import {
  callExternalAIWithMessages,
  parseStructuredResponse,
} from "./aiClient";
import { AI_ANALYSIS_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS } from "./constants";
import type { Logger } from "./logger";
import { rateLimit } from "./rateLimit";
import {
  AnalyzeBodySchema,
  ChatBodySchema,
  parseRequestBody,
  type AnalysisType,
} from "./requestSchemas";
import type { GetAiConfig } from "./aiProxyRuntime";

interface InsightRouteDeps {
  getAiConfig: GetAiConfig;
  log: Logger;
}

const systemPrompts: Record<AnalysisType, string> = {
  utxo_health: `You are a Bitcoin treasury advisor analyzing UTXO health. Based on the wallet data, provide a concise analysis.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: dust UTXOs, consolidation opportunities, fee savings potential.`,

  fee_timing: `You are a Bitcoin fee analyst. Based on recent fee data, identify fee timing opportunities.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: fee trends, optimal send timing, cost comparisons.`,

  anomaly: `You are a Bitcoin spending pattern analyst. Based on transaction velocity data, detect anomalies.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: unusual spending velocity, comparison to historical averages.`,

  tax: `You are a Bitcoin tax advisor. Based on UTXO age data, provide tax-relevant insights.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: short-term vs long-term capital gains, UTXOs approaching long-term threshold.`,

  consolidation: `You are a Bitcoin UTXO management strategist. Based on combined UTXO and fee data, recommend a consolidation strategy.
Respond with a JSON object: {"title": "short title", "summary": "1-2 sentence summary", "severity": "info|warning|critical", "analysis": "detailed analysis paragraph"}
Focus on: when to consolidate, how many UTXOs, expected savings, privacy considerations.`,
};

export function registerInsightRoutes(app: Express, deps: InsightRouteDeps) {
  app.post("/analyze", rateLimit, async (req: Request, res: Response) => {
    const body = parseRequestBody(
      AnalyzeBodySchema,
      req,
      res,
      "type and context required",
    );
    if (!body) return;

    const { type, context } = body;
    const aiConfig = deps.getAiConfig();

    if (!aiConfig.enabled) {
      return res.status(503).json({ error: "AI is not enabled" });
    }

    const messages = [
      { role: "system", content: systemPrompts[type] },
      {
        role: "user",
        content: `Wallet data:\n${JSON.stringify(context, null, 2)}`,
      },
    ];

    const result = await callExternalAIWithMessages(
      aiConfig,
      messages,
      AI_ANALYSIS_TIMEOUT_MS,
    );

    if (!result) {
      return res.status(503).json({ error: "AI endpoint not available" });
    }

    const parsed = parseStructuredResponse(result);
    if (!parsed || !parsed.title || !parsed.summary) {
      deps.log.error("Analysis response not structured correctly", {
        preview: result.substring(0, 300),
      });
      return res
        .status(500)
        .json({ error: "AI did not return valid analysis" });
    }

    if (
      typeof parsed.severity !== "string" ||
      !["info", "warning", "critical"].includes(parsed.severity)
    ) {
      parsed.severity = "info";
    }

    res.json({
      title: parsed.title,
      summary: parsed.summary,
      severity: parsed.severity,
      analysis: parsed.analysis || parsed.summary,
    });
  });

  app.post("/chat", rateLimit, async (req: Request, res: Response) => {
    const body = parseRequestBody(
      ChatBodySchema,
      req,
      res,
      "messages array required",
    );
    if (!body) return;

    const { messages, walletContext } = body;
    const aiConfig = deps.getAiConfig();

    if (!aiConfig.enabled) {
      return res.status(503).json({ error: "AI is not enabled" });
    }

    const systemMessage = {
      role: "system",
      content: `You are a Bitcoin treasury advisor for a self-hosted wallet coordinator called Sanctuary. You help users understand their wallet health, UTXO management, fee optimization, and spending patterns. You never have access to private keys or addresses — only aggregate statistics and sanitized metadata. Be concise and actionable.${walletContext ? `\n\nWallet context:\n${JSON.stringify(walletContext, null, 2)}` : ""}`,
    };

    const aiMessages = [systemMessage, ...messages];
    const result = await callExternalAIWithMessages(
      aiConfig,
      aiMessages,
      AI_REQUEST_TIMEOUT_MS,
    );

    if (!result) {
      return res.status(503).json({ error: "AI endpoint not available" });
    }

    res.json({ response: result });
  });
}
