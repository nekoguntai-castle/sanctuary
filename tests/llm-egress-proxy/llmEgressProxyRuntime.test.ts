import { describe, expect, it, vi } from "vitest";

import {
  applyConfigUpdate,
  createDefaultAiConfig,
  getConfigResponse,
  inferEndpointType,
  requireConfiguredEndpoint,
} from "../../llm-egress-proxy/src/llmEgressProxyRuntime";

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("LLM egress proxy runtime helpers", () => {
  it("creates defaults and applies partial configuration updates", () => {
    const initial = createDefaultAiConfig();

    expect(initial).toEqual({
      enabled: false,
      endpoint: "",
      model: "",
      providerProfileId: "",
      providerType: "",
      apiKey: "",
    });

    expect(
      applyConfigUpdate(initial, {
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3.2",
      }),
    ).toEqual({
      ...initial,
      enabled: true,
      endpoint: "http://host.docker.internal:11434",
      model: "llama3.2",
    });
  });

  it("returns config responses without leaking endpoint or API key values", () => {
    expect(
      getConfigResponse({
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3.2",
        providerProfileId: "local",
        providerType: "ollama",
        apiKey: "provider-secret",
      }),
    ).toEqual({
      enabled: true,
      model: "llama3.2",
      providerProfileId: "local",
      providerType: "ollama",
      endpointConfigured: true,
      credentialConfigured: true,
    });
  });

  it("requires a configured and allowed endpoint", () => {
    const missingRes = makeResponse();
    expect(
      requireConfiguredEndpoint({ ...createDefaultAiConfig() }, missingRes as any),
    ).toBeNull();
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({
      error: "No AI endpoint configured",
    });

    const blockedRes = makeResponse();
    expect(
      requireConfiguredEndpoint(
        { ...createDefaultAiConfig(), endpoint: "http://203.0.113.10:11434" },
        blockedRes as any,
      ),
    ).toBeNull();
    expect(blockedRes.status).toHaveBeenCalledWith(400);
    expect(blockedRes.json).toHaveBeenCalledWith({
      error: "AI endpoint is not allowed",
      reason: "host_not_allowed",
    });

    const allowedRes = makeResponse();
    expect(
      requireConfiguredEndpoint(
        { ...createDefaultAiConfig(), endpoint: "http://host.docker.internal:11434" },
        allowedRes as any,
      ),
    ).toBe("http://host.docker.internal:11434");
    expect(allowedRes.status).not.toHaveBeenCalled();
  });

  it("classifies endpoint locations for provider diagnostics", () => {
    expect(inferEndpointType("http://host.docker.internal:11434")).toBe("host");
    expect(inferEndpointType("http://localhost:11434")).toBe("host");
    expect(inferEndpointType("https://lmstudio.local/v1")).toBe("remote");
  });
});
