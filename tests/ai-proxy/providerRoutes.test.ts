import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectProviderModels: vi.fn(),
  listProviderModels: vi.fn(),
  streamModelPull: vi.fn(),
}));

vi.mock("../../ai-proxy/src/providerDetection", () => ({
  detectProviderModels: mocks.detectProviderModels,
}));

vi.mock("../../ai-proxy/src/providerModels", () => ({
  listProviderModels: mocks.listProviderModels,
}));

vi.mock("../../ai-proxy/src/modelPull", () => ({
  streamModelPull: mocks.streamModelPull,
}));

import { registerProviderRoutes } from "../../ai-proxy/src/providerRoutes";

const fetchMock = vi.fn();

function makeApp() {
  const routes = {
    delete: new Map<string, Function>(),
    get: new Map<string, Function>(),
    post: new Map<string, Function>(),
  };
  return {
    app: {
      delete: (path: string, ...handlers: Function[]) =>
        routes.delete.set(path, handlers.at(-1)!),
      get: (path: string, ...handlers: Function[]) =>
        routes.get.set(path, handlers.at(-1)!),
      post: (path: string, ...handlers: Function[]) =>
        routes.post.set(path, handlers.at(-1)!),
    },
    routes,
  };
}

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function makeDeps(
  aiConfig: Partial<{
    enabled: boolean;
    endpoint: string;
    model: string;
    providerType: string;
  }> = {},
) {
  return {
    backendUrl: "http://backend:3001",
    getAiConfig: vi.fn(() => ({
      enabled: true,
      endpoint: "http://ollama:11434",
      model: "llama3.2",
      providerType: "ollama",
      ...aiConfig,
    })),
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
}

describe("AI proxy provider routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    mocks.streamModelPull.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers provider discovery and model-management routes", () => {
    const { app, routes } = makeApp();

    registerProviderRoutes(app as any, makeDeps() as any);

    expect([...routes.post.keys()]).toEqual([
      "/detect-ollama",
      "/detect-provider",
      "/pull-model",
      "/check-ollama",
    ]);
    expect([...routes.get.keys()]).toEqual(["/list-models"]);
    expect([...routes.delete.keys()]).toEqual(["/delete-model"]);
  });

  it("detects providers and rejects blocked provider endpoints", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    mocks.detectProviderModels.mockResolvedValueOnce({
      found: true,
      endpoint: "http://ollama:11434",
      models: ["llama3.2"],
    });

    const foundRes = makeResponse();
    await routes.post.get("/detect-provider")!(
      {
        body: {
          endpoint: "http://ollama:11434",
          preferredProviderType: "ollama",
        },
      },
      foundRes,
    );

    expect(mocks.detectProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://ollama:11434" }),
      "http://ollama:11434",
      "ollama",
      undefined,
    );
    expect(foundRes.status).toHaveBeenCalledWith(200);

    mocks.detectProviderModels.mockResolvedValueOnce({
      found: false,
      blockedReason: "host_not_allowed",
    });

    const blockedRes = makeResponse();
    await routes.post.get("/detect-provider")!(
      { body: { endpoint: "http://ollama:11434" } },
      blockedRes,
    );

    expect(blockedRes.status).toHaveBeenCalledWith(400);
    expect(blockedRes.json).toHaveBeenCalledWith({
      found: false,
      blockedReason: "host_not_allowed",
    });
  });

  it("lists configured models and maps provider failures to 502", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    mocks.listProviderModels.mockResolvedValueOnce([{ name: "llama3.2" }]);

    const successRes = makeResponse();
    await routes.get.get("/list-models")!({}, successRes);
    expect(successRes.json).toHaveBeenCalledWith({
      models: [{ name: "llama3.2" }],
    });

    mocks.listProviderModels.mockRejectedValueOnce(new Error("offline"));
    const failureRes = makeResponse();
    await routes.get.get("/list-models")!({}, failureRes);
    expect(failureRes.status).toHaveBeenCalledWith(502);
    expect(failureRes.json).toHaveBeenCalledWith({
      error: "Cannot connect to AI endpoint",
    });
  });

  it("starts Ollama model pulls and rejects OpenAI-compatible pulls", async () => {
    const ollama = makeApp();
    registerProviderRoutes(ollama.app as any, makeDeps() as any);

    const pullRes = makeResponse();
    await ollama.routes.post.get("/pull-model")!(
      { body: { model: "llama3.2" } },
      pullRes,
    );

    expect(pullRes.json).toHaveBeenCalledWith({
      success: true,
      status: "started",
      model: "llama3.2",
    });
    expect(mocks.streamModelPull).toHaveBeenCalledWith(
      "llama3.2",
      "http://ollama:11434",
      "http://backend:3001",
    );

    const openAi = makeApp();
    registerProviderRoutes(
      openAi.app as any,
      makeDeps({
        endpoint: "http://lmstudio.local:1234/v1",
        providerType: "openai-compatible",
      }) as any,
    );

    const rejectedRes = makeResponse();
    await openAi.routes.post.get("/pull-model")!(
      { body: { model: "remote-model" } },
      rejectedRes,
    );

    expect(rejectedRes.status).toHaveBeenCalledWith(400);
    expect(rejectedRes.json).toHaveBeenCalledWith({
      error:
        "Model pull is only supported for Ollama providers. Manage models in your OpenAI-compatible provider.",
    });
  });

  it("deletes Ollama models and returns provider delete errors", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    fetchMock.mockResolvedValueOnce({ ok: true });
    const successRes = makeResponse();
    await routes.delete.get("/delete-model")!(
      { body: { model: "llama3.2" } },
      successRes,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama:11434/api/delete",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ name: "llama3.2" }),
      }),
    );
    expect(successRes.json).toHaveBeenCalledWith({
      success: true,
      model: "llama3.2",
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: vi.fn().mockResolvedValue("not installed"),
    });
    const failureRes = makeResponse();
    await routes.delete.get("/delete-model")!(
      { body: { model: "missing" } },
      failureRes,
    );
    expect(failureRes.status).toHaveBeenCalledWith(502);
    expect(failureRes.json).toHaveBeenCalledWith({
      error: "Failed to delete model: not installed",
    });
  });

  it("checks configured Ollama compatibility", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    mocks.listProviderModels.mockResolvedValueOnce([]);
    const compatibleRes = makeResponse();
    await routes.post.get("/check-ollama")!({}, compatibleRes);
    expect(compatibleRes.json).toHaveBeenCalledWith({
      compatible: true,
      endpointType: "container",
      providerType: "ollama",
    });

    const missing = makeApp();
    registerProviderRoutes(missing.app as any, makeDeps({ endpoint: "" }) as any);
    const missingRes = makeResponse();
    await missing.routes.post.get("/check-ollama")!({}, missingRes);
    expect(missingRes.json).toHaveBeenCalledWith({
      compatible: false,
      reason: "no_endpoint",
    });

    const blocked = makeApp();
    registerProviderRoutes(
      blocked.app as any,
      makeDeps({ endpoint: "http://203.0.113.10:11434" }) as any,
    );
    const blockedRes = makeResponse();
    await blocked.routes.post.get("/check-ollama")!({}, blockedRes);
    expect(blockedRes.json).toHaveBeenCalledWith({
      compatible: false,
      reason: "host_not_allowed",
    });
  });

  it("detects local Ollama and counts blocked custom endpoints", async () => {
    const { app, routes } = makeApp();
    const deps = makeDeps();
    registerProviderRoutes(app as any, deps as any);

    fetchMock.mockRejectedValueOnce(new Error("no host service"));
    fetchMock.mockRejectedValueOnce(new Error("no bridge service"));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [{ name: "llama3.2" }],
      }),
    });

    const res = makeResponse();
    await routes.post.get("/detect-ollama")!(
      {
        body: {
          customEndpoints: ["http://203.0.113.10:11434"],
        },
      },
      res,
    );

    expect(deps.log.warn).toHaveBeenCalledWith(
      "Skipping disallowed custom Ollama endpoint",
      { reason: "host_not_allowed" },
    );
    expect(res.json).toHaveBeenCalledWith({
      found: true,
      endpoint: "http://localhost:11434",
      models: ["llama3.2"],
    });
  });
});
