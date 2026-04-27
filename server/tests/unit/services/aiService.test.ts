import { describe, expect, it, vi } from "vitest";
import {
  errJson,
  getAiServiceMocks,
  mockConfiguredAiSettings,
  okJson,
  setting,
  setupAiServiceTest,
} from "./aiServiceTestHarness";

const mocks = getAiServiceMocks();

describe("aiService", () => {
  setupAiServiceTest();

  it("returns enabled=true only when all required settings are configured", async () => {
    mockConfiguredAiSettings();

    const mod = await import("../../../src/services/aiService");
    await expect(mod.isEnabled()).resolves.toBe(true);
  });

  it("ignores unknown AI settings keys while parsing config", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
      setting("aiUnknownKey", "ignored"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    await expect(mod.isEnabled()).resolves.toBe(true);
  });

  it("uses the active typed provider profile when one is configured", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiActiveProviderProfileId", "lan-ollama"),
      setting("aiProviderProfiles", [
        {
          id: "lan-ollama",
          name: "LAN Ollama",
          providerType: "ollama",
          endpoint: "http://lan-llm:11434",
          model: "llama3.2:3b",
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
      ]),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ available: true }));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toMatchObject({
      available: true,
      model: "llama3.2:3b",
      endpoint: "http://lan-llm:11434",
      containerAvailable: true,
    });
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      "http://ai:3100/config",
      expect.objectContaining({
        body: JSON.stringify({
          enabled: true,
          endpoint: "http://lan-llm:11434",
          model: "llama3.2:3b",
          providerProfileId: "lan-ollama",
          providerType: "ollama",
          apiKey: "",
        }),
      }),
    );
  });

  it("syncs the active provider credential to the AI proxy without exposing inactive credentials", async () => {
    mocks.decrypt.mockReturnValueOnce("active-api-key");
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiActiveProviderProfileId", "openai-compatible"),
      setting("aiProviderProfiles", [
        {
          id: "openai-compatible",
          name: "LAN Gateway",
          providerType: "openai-compatible",
          endpoint: "https://llm.example.local/v1",
          model: "qwen3",
          capabilities: { chat: true, toolCalls: true, strictJson: true },
        },
        {
          id: "unused",
          name: "Unused",
          providerType: "ollama",
          endpoint: "http://ollama:11434",
          model: "llama3.2",
          capabilities: { chat: true, toolCalls: false, strictJson: true },
        },
      ]),
      setting("aiProviderCredentials", {
        "openai-compatible": {
          type: "api-key",
          encryptedApiKey: "encrypted-active",
          configuredAt: "2026-04-26T00:00:00.000Z",
        },
        unused: {
          type: "api-key",
          encryptedApiKey: "encrypted-unused",
          configuredAt: "2026-04-26T00:00:00.000Z",
        },
      }),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.forceSyncConfig()).resolves.toBe(true);

    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-active");
    expect(mocks.decrypt).not.toHaveBeenCalledWith("encrypted-unused");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://ai:3100/config",
      expect.objectContaining({
        body: JSON.stringify({
          enabled: true,
          endpoint: "https://llm.example.local/v1",
          model: "qwen3",
          providerProfileId: "openai-compatible",
          providerType: "openai-compatible",
          apiKey: "active-api-key",
        }),
      }),
    );
  });

  it("omits disabled AI provider credentials during config sync", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiActiveProviderProfileId", "restored"),
      setting("aiProviderProfiles", [
        {
          id: "restored",
          name: "Restored Provider",
          providerType: "openai-compatible",
          endpoint: "https://llm.example.local/v1",
          model: "qwen3",
          capabilities: { chat: true, toolCalls: true, strictJson: true },
        },
      ]),
      setting("aiProviderCredentials", {
        restored: {
          type: "api-key",
          encryptedApiKey: "encrypted-restored",
          disabledReason: "restored",
          configuredAt: "2026-04-26T00:00:00.000Z",
        },
      }),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.forceSyncConfig()).resolves.toBe(true);

    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://ai:3100/config",
      expect.objectContaining({
        body: expect.stringContaining('"apiKey":""'),
      }),
    );
  });

  it("omits undecryptable active AI provider credentials during config sync", async () => {
    mocks.decrypt.mockImplementationOnce(() => {
      throw new Error("bad key");
    });
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiActiveProviderProfileId", "hosted"),
      setting("aiProviderProfiles", [
        {
          id: "hosted",
          name: "Hosted Provider",
          providerType: "openai-compatible",
          endpoint: "https://llm.example.local/v1",
          model: "qwen3",
          capabilities: { chat: true, toolCalls: true, strictJson: true },
        },
      ]),
      setting("aiProviderCredentials", {
        hosted: {
          type: "api-key",
          encryptedApiKey: "encrypted-hosted",
          configuredAt: "2026-04-26T00:00:00.000Z",
        },
      }),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.forceSyncConfig()).resolves.toBe(true);

    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-hosted");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://ai:3100/config",
      expect.objectContaining({
        body: expect.stringContaining('"apiKey":""'),
      }),
    );
  });

  it("resyncs when active provider credentials rotate with a new configuredAt", async () => {
    mocks.fetch.mockResolvedValue(okJson({ synced: true }));

    const { syncConfigToContainer } =
      await import("../../../src/services/ai/config");
    const config = {
      enabled: true,
      endpoint: "https://llm.example.local/v1",
      model: "qwen3",
      providerProfileId: "hosted",
      providerType: "openai-compatible",
      apiKey: "first-key",
      credentialConfiguredAt: "2026-04-26T00:00:00.000Z",
    };

    await expect(syncConfigToContainer(config)).resolves.toBe(true);
    await expect(syncConfigToContainer(config)).resolves.toBe(true);
    await expect(
      syncConfigToContainer({
        ...config,
        apiKey: "second-key",
        credentialConfiguredAt: "2026-04-26T01:00:00.000Z",
      }),
    ).resolves.toBe(true);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "http://ai:3100/config",
      expect.objectContaining({
        body: expect.stringContaining('"apiKey":"second-key"'),
      }),
    );
  });

  it("returns disabled when settings lookup fails", async () => {
    mocks.systemSettingFindMany.mockRejectedValue(new Error("db down"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.isEnabled()).resolves.toBe(false);
  });

  it("returns false when AI container health endpoint throws", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("unreachable"));

    const mod = await import("../../../src/services/aiService");
    await expect(mod.isContainerAvailable()).resolves.toBe(false);
  });

  it("returns disabled health when AI is turned off", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", false),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.error).toContain("disabled");
  });

  it("reports container unavailable when /health check fails", async () => {
    mockConfiguredAiSettings();
    mocks.fetch.mockResolvedValueOnce(errJson(503, { error: "down" }));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.containerAvailable).toBe(false);
    expect(health.error).toContain("container");
  });

  it("syncs config and reports healthy AI container", async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ available: true }));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toMatchObject({
      available: true,
      model: "llama3.2",
      endpoint: "http://ollama:11434",
      containerAvailable: true,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      "http://ai:3100/config",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-AI-Service-Secret": "",
          "X-AI-Config-Secret": "",
        }),
      }),
    );
  });

  it("reports unavailable when endpoint or model is missing", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      error: "AI endpoint or model not configured",
    });
  });

  it("reports unavailable when AI test endpoint fails", async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(502, { error: "test failed" }));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: "llama3.2",
      endpoint: "http://ollama:11434",
      containerAvailable: true,
      error: "AI container test failed",
    });
  });

  it("reports invalid response when AI test payload is malformed", async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson("not-an-object"));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: "llama3.2",
      endpoint: "http://ollama:11434",
      containerAvailable: true,
      error: "Invalid response from AI container",
    });
  });

  it("reports test connection failure when AI test request throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: "ok" }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("socket hang up"));

    const mod = await import("../../../src/services/aiService");
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: "llama3.2",
      endpoint: "http://ollama:11434",
      containerAvailable: true,
      error: "Failed to test AI connection",
    });
  });

  it("suggests transaction labels from AI container", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ suggestion: "Payroll income" }));

    const mod = await import("../../../src/services/aiService");
    const suggestion = await mod.suggestTransactionLabel("tx-1", "token-abc");

    expect(suggestion).toBe("Payroll income");
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "http://ai:3100/suggest-label",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-abc",
          "X-AI-Service-Secret": "",
        }),
      }),
    );
  });

  it("returns null label suggestion when AI is not configured", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.suggestTransactionLabel("tx-2", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null label suggestion when AI container returns non-ok", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(400, { error: "bad input" }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.suggestTransactionLabel("tx-3", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null label suggestion when non-ok error body is unreadable", async () => {
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
    await expect(
      mod.suggestTransactionLabel("tx-3b", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null label suggestion when response payload is invalid", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({}));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.suggestTransactionLabel("tx-4", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null when label suggestion is an empty string", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ suggestion: "" }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.suggestTransactionLabel("tx-empty", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null label suggestion when fetch throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("timeout"));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.suggestTransactionLabel("tx-5", "token-abc"),
    ).resolves.toBeNull();
  });

  it("returns null for invalid natural query response payloads", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ invalid: true }));

    const mod = await import("../../../src/services/aiService");
    const result = await mod.executeNaturalQuery(
      "show latest",
      "wallet-1",
      "token-xyz",
    );

    expect(result).toBeNull();
  });

  it("returns null for natural query when AI is not configured", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", false),
    ] as any);

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.executeNaturalQuery("show latest", "wallet-1", "token-xyz"),
    ).resolves.toBeNull();
  });

  it("returns null for natural query when AI container returns non-ok", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(422, { error: "invalid request" }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.executeNaturalQuery("show latest", "wallet-1", "token-xyz"),
    ).resolves.toBeNull();
  });

  it("returns null for natural query when non-ok error body is unreadable", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as any);

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.executeNaturalQuery("show latest", "wallet-1", "token-xyz"),
    ).resolves.toBeNull();
  });

  it("returns null when natural query response has query=null", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ query: null }));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.executeNaturalQuery("show latest", "wallet-1", "token-xyz"),
    ).resolves.toBeNull();
  });

  it("returns null for natural query when fetch throws", async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", true),
      setting("aiEndpoint", "http://ollama:11434"),
      setting("aiModel", "llama3.2"),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error("timeout"));

    const mod = await import("../../../src/services/aiService");
    await expect(
      mod.executeNaturalQuery("show latest", "wallet-1", "token-xyz"),
    ).resolves.toBeNull();
  });
});
