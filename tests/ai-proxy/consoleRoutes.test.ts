import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callExternalAIWithMessages: vi.fn(),
}));

vi.mock("../../ai-proxy/src/aiClient", () => ({
  callExternalAIWithMessages: mocks.callExternalAIWithMessages,
  parseStructuredResponse: (raw: string) => JSON.parse(raw),
}));

import { registerConsoleRoutes } from "../../ai-proxy/src/consoleRoutes";

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
    mocks.callExternalAIWithMessages.mockResolvedValue(JSON.stringify({
      toolCalls: [{ name: "get_fee_estimates", input: {} }],
    }));
    registerConsoleRoutes(app as any, { getAiConfig: () => enabledConfig });

    await routes.get("/console/plan")!({ body: planningBody }, res);

    expect(mocks.callExternalAIWithMessages).toHaveBeenCalledWith(
      enabledConfig,
      expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      expect.any(Number),
    );
    expect(res.json).toHaveBeenCalledWith({
      toolCalls: [{ name: "get_fee_estimates", input: {} }],
      warnings: [],
    });
  });

  it("synthesizes console answers from compact tool results", async () => {
    const { app, routes } = makeApp();
    const res = makeResponse();
    mocks.callExternalAIWithMessages.mockResolvedValue("Fees are available.");
    registerConsoleRoutes(app as any, { getAiConfig: () => enabledConfig });

    await routes.get("/console/synthesize")!({
      body: {
        prompt: "Summarize fees",
        toolResults: [{ toolName: "get_fee_estimates", status: "completed" }],
      },
    }, res);

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
    mocks.callExternalAIWithMessages.mockResolvedValue(null);
    registerConsoleRoutes(unavailable.app as any, { getAiConfig: () => enabledConfig });
    await unavailable.routes.get("/console/synthesize")!({
      body: {
        prompt: "Summarize",
        toolResults: [],
      },
    }, unavailableRes);
    expect(unavailableRes.status).toHaveBeenCalledWith(503);
    expect(unavailableRes.json).toHaveBeenCalledWith({ error: "AI endpoint not available" });
  });
});
