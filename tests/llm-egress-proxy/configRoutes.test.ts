import { describe, expect, it, vi } from "vitest";

import { registerConfigRoutes } from "../../llm-egress-proxy/src/configRoutes";

function makeApp() {
  const routes = {
    get: new Map<string, Function>(),
    post: new Map<string, Function>(),
  };
  return {
    app: {
      get: (path: string, handler: Function) => routes.get.set(path, handler),
      post: (path: string, handler: Function) => routes.post.set(path, handler),
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

function makeDeps() {
  const aiConfig = {
    enabled: true,
    endpoint: "http://host.docker.internal:11434",
    model: "llama3.2",
    providerProfileId: "local",
    providerType: "ollama",
    apiKey: "provider-secret",
  };

  return {
    getAiConfig: vi.fn(() => aiConfig),
    updateAiConfig: vi.fn((update: Partial<typeof aiConfig>) => ({
      ...aiConfig,
      ...update,
    })),
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
}

describe("LLM egress proxy config routes", () => {
  it("returns sanitized provider configuration", () => {
    const { app, routes } = makeApp();
    const deps = makeDeps();
    const res = makeResponse();
    registerConfigRoutes(app as any, deps);

    routes.get.get("/config")!({}, res);

    expect(res.json).toHaveBeenCalledWith({
      enabled: true,
      model: "llama3.2",
      providerProfileId: "local",
      providerType: "ollama",
      endpointConfigured: true,
      credentialConfigured: true,
    });
  });

  it("updates allowed provider configuration without returning secrets", () => {
    const { app, routes } = makeApp();
    const deps = makeDeps();
    const res = makeResponse();
    registerConfigRoutes(app as any, deps);

    routes.post.get("/config")!(
      {
        body: {
          enabled: true,
          endpoint: "http://host.docker.internal:11434",
          model: "qwen3",
          apiKey: "new-secret",
        },
      },
      res,
    );

    expect(deps.updateAiConfig).toHaveBeenCalledWith({
      enabled: true,
      endpoint: "http://host.docker.internal:11434",
      model: "qwen3",
      apiKey: "new-secret",
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      config: expect.objectContaining({
        model: "qwen3",
        endpointConfigured: true,
        credentialConfigured: true,
      }),
    });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("new-secret");
  });

  it("rejects invalid bodies and disallowed provider endpoints", () => {
    const { app, routes } = makeApp();
    const deps = makeDeps();
    registerConfigRoutes(app as any, deps);

    const invalidRes = makeResponse();
    routes.post.get("/config")!({ body: { endpoint: "ftp://ollama" } }, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(deps.updateAiConfig).not.toHaveBeenCalled();

    const blockedRes = makeResponse();
    routes.post.get("/config")!(
      { body: { endpoint: "http://203.0.113.10:11434" } },
      blockedRes,
    );
    expect(blockedRes.status).toHaveBeenCalledWith(400);
    expect(blockedRes.json).toHaveBeenCalledWith({
      error: "AI endpoint is not allowed",
      reason: "host_not_allowed",
    });
    expect(deps.log.warn).toHaveBeenCalledWith(
      "Rejected AI provider endpoint configuration",
      { reason: "host_not_allowed" },
    );
  });
});
