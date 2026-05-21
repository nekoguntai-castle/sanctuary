import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectProviderModels,
  getProviderDetectionOrder,
} from "../../llm-egress-proxy/src/providerDetection";
import {
  PROXY_AI_PROVIDER_TYPES,
  PROXY_PROVIDER_DETECTION_ORDER,
} from "../../llm-egress-proxy/src/providerTypes";

const baseConfig = {
  enabled: true,
  endpoint: "",
  model: "",
};

describe("LLM egress proxy provider detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps detection order aligned with the proxy provider tuple without changing default precedence", () => {
    expect(PROXY_PROVIDER_DETECTION_ORDER).toEqual([
      "openai-compatible",
      "ollama",
    ]);
    expect([...PROXY_PROVIDER_DETECTION_ORDER].sort()).toEqual(
      [...PROXY_AI_PROVIDER_TYPES].sort(),
    );
    expect(getProviderDetectionOrder()).toEqual([
      "openai-compatible",
      "ollama",
    ]);
    expect(getProviderDetectionOrder("ollama")).toEqual([
      "ollama",
      "openai-compatible",
    ]);
    expect(getProviderDetectionOrder("OpenAI-Compatible")).toEqual([
      "openai-compatible",
      "ollama",
    ]);
    expect(getProviderDetectionOrder("anthropic")).toEqual([
      "openai-compatible",
      "ollama",
    ]);
  });

  it("detects LM Studio models on private LAN endpoints without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "qwen/qwen3.6-35b-a3b" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectProviderModels(
      { ...baseConfig, providerType: "openai-compatible" },
      "http://studio.local:1234",
      "openai-compatible",
    );

    expect(result).toMatchObject({
      found: true,
      providerType: "openai-compatible",
      endpoint: "http://studio.local:1234",
      models: [{ name: "qwen/qwen3.6-35b-a3b", size: 0, modifiedAt: "" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://studio.local:1234/v1/models",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
    const requestOptions = fetchMock.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect(requestOptions?.headers).not.toHaveProperty("Authorization");
  });

  it("reports blocked public HTTP endpoints instead of probing them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectProviderModels(
      baseConfig,
      "http://203.0.113.10:1234",
      "openai-compatible",
    );

    expect(result).toMatchObject({
      found: false,
      blockedReason: "host_not_allowed",
      message:
        "AI endpoint is blocked: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS to include numeric LAN IP endpoints.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
