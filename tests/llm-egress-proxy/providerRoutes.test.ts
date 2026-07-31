import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detectProviderModels: vi.fn(),
  listOllamaModels: vi.fn(),
  listProviderModels: vi.fn(),
}));

vi.mock("../../llm-egress-proxy/src/providerDetection", () => ({
  detectProviderModels: mocks.detectProviderModels,
}));

vi.mock("../../llm-egress-proxy/src/providerModels", () => ({
  listOllamaModels: mocks.listOllamaModels,
  listProviderModels: mocks.listProviderModels,
}));

import { registerProviderRoutes } from "../../llm-egress-proxy/src/providerRoutes";

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
      endpoint: "http://host.docker.internal:11434",
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

describe("LLM egress proxy provider routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers provider discovery and model-listing routes only", () => {
    const { app, routes } = makeApp();

    registerProviderRoutes(app as any, makeDeps() as any);

    expect([...routes.post.keys()]).toEqual([
      "/detect-ollama",
      "/detect-provider",
      "/check-provider",
      "/check-ollama",
    ]);
    expect([...routes.get.keys()]).toEqual(["/list-models"]);
    expect([...routes.delete.keys()]).toEqual([]);
    expect(routes.post.has("/pull-model")).toBe(false);
    expect(routes.delete.has("/delete-model")).toBe(false);
  });

  it("detects providers and rejects blocked provider endpoints", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    mocks.detectProviderModels.mockResolvedValueOnce({
      found: true,
      endpoint: "http://host.docker.internal:11434",
      models: ["llama3.2"],
    });

    const foundRes = makeResponse();
    await routes.post.get("/detect-provider")!(
      {
        body: {
          endpoint: "http://host.docker.internal:11434",
          preferredProviderType: "ollama",
        },
      },
      foundRes,
    );

    expect(mocks.detectProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "http://host.docker.internal:11434",
      }),
      "http://host.docker.internal:11434",
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
      { body: { endpoint: "http://host.docker.internal:11434" } },
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

  it("checks configured provider compatibility", async () => {
    const { app, routes } = makeApp();
    registerProviderRoutes(app as any, makeDeps() as any);

    mocks.listProviderModels.mockResolvedValueOnce([]);
    const compatibleRes = makeResponse();
    await routes.post.get("/check-provider")!({}, compatibleRes);
    expect(compatibleRes.json).toHaveBeenCalledWith({
      compatible: true,
      endpointType: "host",
      providerType: "ollama",
    });

    const missing = makeApp();
    registerProviderRoutes(
      missing.app as any,
      makeDeps({ endpoint: "" }) as any,
    );
    const missingRes = makeResponse();
    await missing.routes.post.get("/check-provider")!({}, missingRes);
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
    await blocked.routes.post.get("/check-provider")!({}, blockedRes);
    expect(blockedRes.json).toHaveBeenCalledWith({
      compatible: false,
      reason: "host_not_allowed",
    });
  });

  it("detects local Ollama and counts blocked custom endpoints", async () => {
    const { app, routes } = makeApp();
    const deps = makeDeps();
    registerProviderRoutes(app as any, deps as any);

    mocks.listOllamaModels.mockRejectedValueOnce(new Error("no host service"));
    mocks.listOllamaModels.mockResolvedValueOnce([
      { name: "llama3.2", size: 0, modifiedAt: "" },
    ]);

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
    expect(mocks.listOllamaModels).toHaveBeenNthCalledWith(
      1,
      "http://host.docker.internal:11434",
      3000,
    );
    expect(mocks.listOllamaModels).toHaveBeenNthCalledWith(
      2,
      "http://localhost:11434",
      3000,
    );
  });
});
