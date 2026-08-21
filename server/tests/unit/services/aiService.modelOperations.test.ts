import { describe, expect, it, vi } from "vitest";
import {
  errJson,
  getAiServiceMocks,
  okJson,
  setting,
  setupAiServiceTest,
} from "./aiServiceTestHarness";

const mocks = getAiServiceMocks();

describe("aiService model operations", () => {
  setupAiServiceTest();

  it("detects Ollama and validates response format", async () => {
    mocks.fetch.mockResolvedValueOnce(
      okJson({ found: true, endpoint: "http://localhost:11434" }),
    );

    const mod = await import("../../../src/services/aiService");
    const result = await mod.detectOllama();

    expect(result).toEqual({
      found: true,
      endpoint: "http://localhost:11434",
    });
  });

  it("returns detectOllama failure when LLM egress proxy returns non-ok", async () => {
    mocks.fetch.mockResolvedValueOnce(errJson(500, { error: "boom" }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: "Detection failed",
    });
  });

  it("returns detectOllama invalid format when payload is malformed", async () => {
    mocks.fetch.mockResolvedValueOnce(okJson("bad-payload"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: "Invalid response format",
    });
  });

  it("returns detectOllama unavailable when request throws", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("down"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: "LLM egress proxy not available",
    });
  });

  it("detects typed provider endpoints through the LLM egress proxy", async () => {
    mocks.fetch.mockResolvedValueOnce(
      okJson({
        found: true,
        providerType: "openai-compatible",
        endpoint: "http://studio.local:1234",
        models: [{ name: "qwen/qwen3.6-35b-a3b", size: 0, modifiedAt: "" }],
      }),
    );

    const mod = await import("../../../src/services/aiService");
    const result = await mod.detectProviderEndpoint({
      endpoint: "http://studio.local:1234",
      preferredProviderType: "openai-compatible",
    });

    expect(result).toMatchObject({
      found: true,
      providerType: "openai-compatible",
      endpoint: "http://studio.local:1234",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://llm-egress-proxy:3100/detect-provider",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          endpoint: "http://studio.local:1234",
          preferredProviderType: "openai-compatible",
        }),
      }),
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "apiKey",
    );
  });

  it("returns typed provider detection messages from non-ok responses", async () => {
    mocks.fetch.mockResolvedValueOnce(
      errJson(502, {
        found: false,
        message: "No supported model provider responded at this endpoint.",
      }),
    );

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://studio.local:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "No supported model provider responded at this endpoint.",
    });
  });

  it("returns typed provider detection invalid-format failures for malformed success payloads", async () => {
    mocks.fetch.mockResolvedValueOnce(okJson({ models: [] }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://studio.local:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "Invalid response format",
    });
  });

  it("returns typed provider detection fallback failures for malformed error payloads", async () => {
    mocks.fetch.mockResolvedValueOnce(errJson(502, { models: [] }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://studio.local:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "Provider detection failed",
    });
  });

  it("returns typed provider detection fallback failures for unreadable response bodies", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error("invalid json")),
    } as any);

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://studio.local:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "Provider detection failed",
    });
  });

  it("returns typed provider detection unavailable when the LLM egress proxy request throws", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("down"));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://studio.local:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "LLM egress proxy not available",
    });
  });

  it("returns list-models error when endpoint is missing", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiModel", "llama3.2"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    const result = await mod.listModels();

    expect(result.models).toEqual([]);
    expect(result.error).toContain("endpoint");
  });

  it("lists models through the LLM egress proxy", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(
        okJson({
          models: [
            { name: "llama3.2", size: 123, modifiedAt: "2026-01-01T00:00:00Z" },
          ],
        }),
      );

    const mod = await import("../../../src/services/aiService");
    const result = await mod.listModels();

    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("llama3.2");
  });

  it("returns list-models fallback error when response body is not readable", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as any);

    const mod = await import("../../../src/services/aiService");
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: "Failed to list models",
    });
  });

  it("returns list-models config sync rejection before querying stale proxy config", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://192.168.1.20:1234/v1"),
      setting("aiModel", "lmstudio-community/model"),
      setting("aiActiveProviderProfileId", "lm-studio"),
      setting("aiProviderProfiles", [
        {
          id: "lm-studio",
          name: "LM Studio",
          providerType: "openai-compatible",
          endpoint: "http://192.168.1.20:1234/v1",
          model: "lmstudio-community/model",
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
      ]),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(
      errJson(400, {
        error: "AI endpoint is not allowed",
        reason: "host_not_allowed",
      }),
    );

    const mod = await import("../../../src/services/aiService");
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error:
        "AI endpoint is not allowed: host_not_allowed. Use host.docker.internal for providers on the Docker host, or set LLM_EGRESS_PROXY_ALLOWED_CIDRS for numeric LAN IP endpoints.",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://llm-egress-proxy:3100/config",
      expect.any(Object),
    );
  });

  it("returns list-models invalid response when payload is malformed", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ nope: true }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: "Invalid response format",
    });
  });

  it("returns list-models connection error when request throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("connection refused"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: "Cannot connect to LLM egress proxy",
    });
  });

  it("formats config sync failures for generic reasons, status codes, and plain errors", async () => {
    const { describeConfigSyncFailure } =
      await import("../../../src/services/ai/config");

    expect(
      describeConfigSyncFailure({
        success: false,
        error: "AI endpoint is not allowed",
        reason: "unsupported_protocol",
      }),
    ).toBe("AI endpoint is not allowed: unsupported_protocol");
    expect(
      describeConfigSyncFailure({
        success: false,
        status: 401,
      }),
    ).toBe("Failed to sync AI configuration (HTTP 401)");
    expect(
      describeConfigSyncFailure({
        success: false,
        error: "Failed to connect to LLM egress proxy for config sync",
      }),
    ).toBe("Failed to connect to LLM egress proxy for config sync");
  });

  it("reports provider readiness only after loading and syncing complete config", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(okJson({ success: true }));

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(ensureLlmProxyConfigured()).resolves.toEqual({
      ready: true,
      config: expect.objectContaining({
        enabled: true,
        endpoint: "http://host.docker.internal:11434",
        model: "llama3.2",
      }),
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports an incomplete provider without attempting config sync", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
    ] as any);

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(ensureLlmProxyConfigured()).resolves.toEqual({
      ready: false,
      reason: "provider_not_configured",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("retains detailed config sync failure information in provider readiness", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://192.168.1.20:1234/v1"),
      setting("aiModel", "qwen3"),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(
      errJson(400, {
        error: "AI endpoint is not allowed",
        reason: "host_not_allowed",
      }),
    );

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(ensureLlmProxyConfigured()).resolves.toEqual({
      ready: false,
      reason: "provider_config_sync_failed",
      syncResult: {
        success: false,
        status: 400,
        error: "AI endpoint is not allowed",
        reason: "host_not_allowed",
      },
    });
  });

  it("preserves cancellation before provider readiness work begins", async () => {
    const controller = new AbortController();
    controller.abort();

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(
      ensureLlmProxyConfigured(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.systemSettingFindMany).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves cancellation between provider lookup and config sync", async () => {
    const controller = new AbortController();
    mocks.systemSettingFindMany.mockImplementationOnce(async () => {
      controller.abort();
      return [
        setting("aiEnabled", true),
        setting("aiEndpoint", "http://host.docker.internal:11434"),
        setting("aiModel", "llama3.2"),
      ] as any;
    });

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(
      ensureLlmProxyConfigured(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves cancellation while provider config sync is in flight", async () => {
    const controller = new AbortController();
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockImplementationOnce(async () => {
      controller.abort();
      return okJson({ success: true });
    });

    const { ensureLlmProxyConfigured } =
      await import("../../../src/services/ai/config");

    await expect(
      ensureLlmProxyConfigured(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns config sync connection failure details when the proxy request throws", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("connection refused"));

    const { syncConfigToLlmEgressProxyResult } =
      await import("../../../src/services/ai/config");
    await expect(
      syncConfigToLlmEgressProxyResult(
        {
          enabled: true,
          endpoint: "http://host.docker.internal:11434",
          model: "llama3.2",
          providerProfileId: "default-ollama",
          providerType: "ollama",
        },
        true,
      ),
    ).resolves.toEqual({
      success: false,
      error: "Failed to connect to LLM egress proxy for config sync",
    });
  });

  it("falls back when config sync rejection bodies are malformed", async () => {
    const { describeConfigSyncFailure, syncConfigToLlmEgressProxyResult } =
      await import("../../../src/services/ai/config");
    const provider = {
      enabled: true,
      endpoint: "http://host.docker.internal:11434",
      model: "llama3.2",
      providerProfileId: "default-ollama",
      providerType: "ollama" as const,
    };

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 418,
      json: vi.fn().mockResolvedValue("not-an-object"),
    } as any);
    await expect(
      syncConfigToLlmEgressProxyResult(provider, true),
    ).resolves.toEqual({
      success: false,
      status: 418,
      error: "Failed to sync AI configuration",
      reason: undefined,
    });

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ error: " ", reason: 7 }),
    } as any);
    const blankBodyResult = await syncConfigToLlmEgressProxyResult(
      provider,
      true,
    );

    expect(blankBodyResult).toEqual({
      success: false,
      status: 429,
      error: "Failed to sync AI configuration",
      reason: undefined,
    });
    expect(describeConfigSyncFailure(blankBodyResult)).toBe(
      "Failed to sync AI configuration (HTTP 429)",
    );

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error("invalid json")),
    } as any);
    await expect(
      syncConfigToLlmEgressProxyResult(provider, true),
    ).resolves.toEqual({
      success: false,
      status: 503,
      error: "Failed to sync AI configuration",
      reason: undefined,
    });
  });

  it("forceSyncConfig returns false when config sync request fails", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockRejectedValue(new Error("connection refused"));

    const mod = await import("../../../src/services/aiService");
    const synced = await mod.forceSyncConfig();

    expect(synced).toBe(false);
  });

  it("forceSyncConfig sends configured AI config secret header when present", async () => {
    const previousSecret = process.env.LLM_EGRESS_PROXY_SECRET;
    process.env.LLM_EGRESS_PROXY_SECRET = "test-secret";
    try {
      mocks.systemSettingFindMany.mockResolvedValue([
        setting("aiEnabled", true),
        setting("aiEndpoint", "http://host.docker.internal:11434"),
        setting("aiModel", "llama3.2"),
      ] as any);
      mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

      const mod = await import("../../../src/services/aiService");
      await expect(mod.forceSyncConfig()).resolves.toBe(true);
      expect(mocks.fetch).toHaveBeenCalledWith(
        "http://llm-egress-proxy:3100/config",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-LLM-Egress-Config-Secret": "test-secret",
            "X-LLM-Egress-Proxy-Secret": "test-secret",
          }),
        }),
      );
    } finally {
      if (previousSecret === undefined) {
        delete process.env.LLM_EGRESS_PROXY_SECRET;
      } else {
        process.env.LLM_EGRESS_PROXY_SECRET = previousSecret;
      }
    }
  });

  it("forceSyncConfig uses the central LLM egress proxy URL config", async () => {
    const previousUrl = process.env.LLM_EGRESS_PROXY_URL;
    process.env.LLM_EGRESS_PROXY_URL = "http://configured-llm-egress:3199";
    try {
      mocks.systemSettingFindMany.mockResolvedValue([
        setting("aiEnabled", true),
        setting("aiEndpoint", "http://host.docker.internal:11434"),
        setting("aiModel", "llama3.2"),
      ] as any);
      mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

      const mod = await import("../../../src/services/aiService");
      await expect(mod.forceSyncConfig()).resolves.toBe(true);
      expect(mocks.fetch).toHaveBeenCalledWith(
        "http://configured-llm-egress:3199/config",
        expect.any(Object),
      );
    } finally {
      if (previousUrl === undefined) {
        delete process.env.LLM_EGRESS_PROXY_URL;
      } else {
        process.env.LLM_EGRESS_PROXY_URL = previousUrl;
      }
    }
  });

  it("forceSyncConfig returns false when config sync returns non-ok response", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://host.docker.internal:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(errJson(500, { error: "sync failed" }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.forceSyncConfig()).resolves.toBe(false);
  });
});
