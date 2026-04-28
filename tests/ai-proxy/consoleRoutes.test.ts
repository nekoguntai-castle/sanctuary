import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callExternalAIWithMessagesResult: vi.fn(),
}));

vi.mock("../../ai-proxy/src/aiClient", () => ({
  callExternalAIWithMessagesResult: mocks.callExternalAIWithMessagesResult,
  parseStructuredResponse: (raw: string) => JSON.parse(raw),
}));

import { registerConsoleRoutes } from "../../ai-proxy/src/consoleRoutes";
import { AI_ANALYSIS_TIMEOUT_MS } from "../../ai-proxy/src/constants";

function makeApp() {
  const routes = new Map<string, Function>();
  return {
    app: {
      post: (path: string, _middleware: unknown, handler: Function) => {
        routes.set(path, handler);
      },
    },
    routes,
  };
}

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const enabledConfig = {
  enabled: true,
  endpoint: "http://ollama:11434",
  model: "llama3.2",
  providerProfileId: "lan",
  providerType: "ollama",
};

const planningBody = {
  prompt: "How is this wallet doing?",
  maxToolCalls: 2,
  tools: [{
    name: "get_fee_estimates",
    title: "Fee estimates",
    description: "Read fees",
    sensitivity: "public",
    requiredScope: "authenticated",
    inputFields: [],
  }],
};

describe("AI proxy console routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers planning and synthesis routes", () => {
    const { app, routes } = makeApp();
    registerConsoleRoutes(app as any, { getAiConfig: () => enabledConfig });

    expect([...routes.keys()]).toEqual(["/console/plan", "/console/synthesize"]);
  });

  it("plans console tool calls through the configured model", async () => {
    const { app, routes } = makeApp();
    const res = makeResponse();
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        toolCalls: [{ name: "get_fee_estimates", input: {} }],
      }),
    });
    registerConsoleRoutes(app as any, { getAiConfig: () => enabledConfig });

    await routes.get("/console/plan")!({ body: planningBody }, res);

    expect(mocks.callExternalAIWithMessagesResult).toHaveBeenCalledWith(
      enabledConfig,
      expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      {
        timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
        temperature: 0,
        maxTokens: 512,
        allowReasoningContent: true,
      },
    );
    expect(res.json).toHaveBeenCalledWith({
      toolCalls: [{ name: "get_fee_estimates", input: {} }],
      warnings: [],
    });
  });

  it("synthesizes console answers from compact tool results", async () => {
    const { app, routes } = makeApp();
    const res = makeResponse();
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: true,
      content: "Fees are available.",
    });
    registerConsoleRoutes(app as any, { getAiConfig: () => enabledConfig });

    await routes.get("/console/synthesize")!({
      body: {
        prompt: "Summarize fees",
        toolResults: [{ toolName: "get_fee_estimates", status: "completed" }],
      },
    }, res);

    expect(mocks.callExternalAIWithMessagesResult).toHaveBeenCalledWith(
      enabledConfig,
      expect.any(Array),
      {
        timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
        temperature: 0.3,
        maxTokens: 1200,
      },
    );
    expect(res.json).toHaveBeenCalledWith({ response: "Fees are available." });
  });

  it("rejects invalid bodies, disabled AI, and unavailable endpoints", async () => {
    const { app, routes } = makeApp();
    registerConsoleRoutes(app as any, {
      getAiConfig: () => ({ ...enabledConfig, enabled: false }),
    });

    const invalidRes = makeResponse();
    await routes.get("/console/plan")!({ body: { prompt: "" } }, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);

    const disabledRes = makeResponse();
    await routes.get("/console/plan")!({ body: planningBody }, disabledRes);
    expect(disabledRes.status).toHaveBeenCalledWith(503);
    expect(disabledRes.json).toHaveBeenCalledWith({ error: "AI is not enabled" });

    const unavailable = makeApp();
    const unavailableRes = makeResponse();
    mocks.callExternalAIWithMessagesResult.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "AI endpoint request timed out after 120000ms",
    });
    registerConsoleRoutes(unavailable.app as any, { getAiConfig: () => enabledConfig });
    await unavailable.routes.get("/console/synthesize")!({
      body: {
        prompt: "Summarize",
        toolResults: [],
      },
    }, unavailableRes);
    expect(unavailableRes.status).toHaveBeenCalledWith(504);
    expect(unavailableRes.json).toHaveBeenCalledWith({
      error: "AI endpoint request timed out after 120000ms",
      reason: "timeout",
    });
  });
});
