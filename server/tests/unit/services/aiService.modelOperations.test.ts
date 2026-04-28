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

  it("returns detectOllama failure when container returns non-ok", async () => {
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
      message: "AI container not available",
    });
  });

  it("detects typed provider endpoints through the AI container", async () => {
    mocks.fetch.mockResolvedValueOnce(
      okJson({
        found: true,
        providerType: "openai-compatible",
        endpoint: "http://10.114.123.214:1234",
        models: [{ name: "qwen/qwen3.6-35b-a3b", size: 0, modifiedAt: "" }],
      }),
    );

    const mod = await import("../../../src/services/aiService");
    const result = await mod.detectProviderEndpoint({
      endpoint: "http://10.114.123.214:1234",
      preferredProviderType: "openai-compatible",
    });

    expect(result).toMatchObject({
      found: true,
      providerType: "openai-compatible",
      endpoint: "http://10.114.123.214:1234",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://ai:3100/detect-provider",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          endpoint: "http://10.114.123.214:1234",
          preferredProviderType: "openai-compatible",
        }),
      }),
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
        endpoint: "http://10.114.123.214:1234",
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
        endpoint: "http://10.114.123.214:1234",
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
        endpoint: "http://10.114.123.214:1234",
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
        endpoint: "http://10.114.123.214:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "Provider detection failed",
    });
  });

  it("returns typed provider detection unavailable when the AI proxy request throws", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("down"));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.detectProviderEndpoint({
        endpoint: "http://10.114.123.214:1234",
        preferredProviderType: "openai-compatible",
      }),
    ).resolves.toEqual({
      found: false,
      message: "AI container not available",
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

  it("lists models through the AI container", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
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
      setting("aiEndpoint", "http://ollama:11434"),
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

  it("returns list-models invalid response when payload is malformed", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
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
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("connection refused"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: "Cannot connect to AI container",
    });
  });

  it("handles pull and delete model error responses", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, { error: "pull failed" }))
      .mockResolvedValueOnce(errJson(500, { error: "delete failed" }));

    const mod = await import("../../../src/services/aiService");
    const pull = await mod.pullModel("llama3.2");
    const del = await mod.deleteModel("llama3.2");

    expect(pull).toEqual({ success: false, error: "pull failed" });
    expect(del).toEqual({ success: false, error: "delete failed" });
  });

  it("returns pull-model fallback error when error payload omits message", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, {}));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Pull failed",
    });
  });

  it("returns pull-model fallback error when non-ok body is unreadable", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
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
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Pull failed",
    });
  });

  it("returns pull-model endpoint missing error", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiModel", "llama3.2"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "No AI endpoint configured",
    });
  });

  it("does not send model management requests for OpenAI-compatible providers", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiProviderProfiles", [
        {
          id: "lm-studio",
          name: "LM Studio",
          providerType: "openai-compatible",
          endpoint: "http://lmstudio.local:1234/v1",
          model: "local-model",
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
      ]),
      setting("aiActiveProviderProfileId", "lm-studio"),
    ] as any);

    const mod = await import("../../../src/services/aiService");

    const expectedError =
      "Model management is only supported for Ollama providers. Manage models in your OpenAI-compatible provider.";
    await expect(mod.pullModel("local-model")).resolves.toEqual({
      success: false,
      error: expectedError,
    });
    await expect(mod.deleteModel("local-model")).resolves.toEqual({
      success: false,
      error: expectedError,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("pulls model successfully when AI container returns success", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(
        okJson({ success: true, model: "llama3.2", status: "pulling" }),
      );

    const mod = await import("../../../src/services/aiService");
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: true,
      model: "llama3.2",
      status: "pulling",
    });
  });

  it("returns pull-model invalid response when payload is malformed", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ model: "llama3.2" }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Invalid response format",
    });
  });

  it("returns pull-model operation failure when request throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("timeout"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.pullModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Pull operation failed",
    });
  });

  it("returns delete-model endpoint missing error", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiModel", "llama3.2"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    await expect(mod.deleteModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "No AI endpoint configured",
    });
  });

  it("deletes model successfully when AI container returns success", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ model: "llama3.2" }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.deleteModel("llama3.2")).resolves.toEqual({
      success: true,
      model: "llama3.2",
    });
  });

  it("returns delete-model fallback error when error payload omits message", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, {}));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.deleteModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Delete failed",
    });
  });

  it("returns delete-model fallback error when non-ok body is unreadable", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
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
    await expect(mod.deleteModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Delete failed",
    });
  });

  it("returns delete-model operation failure when request throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("connection reset"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.deleteModel("llama3.2")).resolves.toEqual({
      success: false,
      error: "Delete operation failed",
    });
  });

  it("forceSyncConfig returns false when config sync request fails", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockRejectedValue(new Error("connection refused"));

    const mod = await import("../../../src/services/aiService");
    const synced = await mod.forceSyncConfig();

    expect(synced).toBe(false);
  });

  it("forceSyncConfig sends configured AI config secret header when present", async () => {
    const previousSecret = process.env.AI_CONFIG_SECRET;
    process.env.AI_CONFIG_SECRET = "test-secret";
    try {
      mocks.systemSettingFindMany.mockResolvedValue([
        setting("aiEnabled", true),
        setting("aiEndpoint", "http://ollama:11434"),
        setting("aiModel", "llama3.2"),
      ] as any);
      mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

      const mod = await import("../../../src/services/aiService");
      await expect(mod.forceSyncConfig()).resolves.toBe(true);
      expect(mocks.fetch).toHaveBeenCalledWith(
        "http://ai:3100/config",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-AI-Config-Secret": "test-secret",
            "X-AI-Service-Secret": "test-secret",
          }),
        }),
      );
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AI_CONFIG_SECRET;
      } else {
        process.env.AI_CONFIG_SECRET = previousSecret;
      }
    }
  });

  it("forceSyncConfig returns false when config sync returns non-ok response", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(errJson(500, { error: "sync failed" }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.forceSyncConfig()).resolves.toBe(false);
  });
});
