import { describe, expect, it, vi } from "vitest";
import {
  getAiServiceMocks,
  okJson,
  setting,
  setupAiServiceTest,
} from "../aiServiceTestHarness";

// Regression: each process kept its own "last pushed" hash for the single,
// shared llm-egress-proxy. After an admin switched X -> Y -> X, a process that
// last pushed X skipped its push for up to 5 minutes and sent inference to a
// proxy another process had set to Y. Disabling AI was never pushed, so the
// proxy kept the last endpoint and credential in memory.

const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
    },
  };
});

const mocks = getAiServiceMocks();

function useRedis(available: boolean) {
  redis.store.clear();
  mocks.redisClient = available ? redis.client : null;
}

function configFor(model: string, enabled = true) {
  return [
    setting("aiEnabled", enabled),
    setting("aiEndpoint", "http://host.docker.internal:11434"),
    setting("aiModel", model),
  ] as any;
}

function configPosts() {
  return mocks.fetch.mock.calls.filter(([url, init]) =>
    String(url).endsWith("/config") && init?.method === "POST",
  );
}

describe("LLM egress proxy config sync shared state", () => {
  setupAiServiceTest();

  it("re-pushes when another process changed the shared proxy since this process's last push", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    await ensureLlmProxyConfigured(); // this process pushes X
    expect(configPosts()).toHaveLength(1);

    // Another process pushes Y to the shared proxy and records it.
    redis.store.set("ai:llm-egress-proxy:config-hash", "hash-of-y-from-another-process");

    await ensureLlmProxyConfigured(); // config is X again here
    expect(configPosts()).toHaveLength(2);
  });

  // Regression: the proxy keeps its provider config only in memory. Three of
  // its routes answer 200 or 400 when unconfigured, so a restart inside the
  // resync interval went unnoticed and AI stayed "not configured" for up to
  // five minutes. Every proxy response now carries a boot id.
  describe("proxy restart detection", () => {
    function withBootId(body: unknown, bootId: string) {
      return { ...okJson(body), headers: new Headers({ "x-sanctuary-proxy-boot-id": bootId }) };
    }

    it("re-pushes after a proxy response shows a new boot id", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { ensureLlmProxyConfigured, fetchLlmEgressProxy } = await import(
        "../../../../src/services/ai/config"
      );

      mocks.fetch.mockResolvedValue(withBootId({ success: true }, "boot-1"));
      await ensureLlmProxyConfigured();
      await fetchLlmEgressProxy("http://proxy/test");
      await ensureLlmProxyConfigured();
      expect(configPosts()).toHaveLength(1); // same boot: nothing to do

      // The proxy restarts and answers 200 "not configured" on a status route.
      mocks.fetch.mockResolvedValue(withBootId({ available: false }, "boot-2"));
      await fetchLlmEgressProxy("http://proxy/test");
      await ensureLlmProxyConfigured();

      expect(configPosts()).toHaveLength(2);
    });

    it("does not re-push a second time once the new boot has the config", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { ensureLlmProxyConfigured, fetchLlmEgressProxy } = await import(
        "../../../../src/services/ai/config"
      );

      mocks.fetch.mockResolvedValue(withBootId({ success: true }, "boot-1"));
      await ensureLlmProxyConfigured();
      mocks.fetch.mockResolvedValue(withBootId({ success: true }, "boot-2"));
      await fetchLlmEgressProxy("http://proxy/test");
      await ensureLlmProxyConfigured(); // pushes to boot-2
      await fetchLlmEgressProxy("http://proxy/test");
      await ensureLlmProxyConfigured();

      expect(configPosts()).toHaveLength(2);
    });

    it("ignores responses without a boot id", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { ensureLlmProxyConfigured, fetchLlmEgressProxy } = await import(
        "../../../../src/services/ai/config"
      );

      mocks.fetch.mockResolvedValue(withBootId({ success: true }, "boot-1"));
      await ensureLlmProxyConfigured();
      mocks.fetch.mockResolvedValue({ ...okJson({}), headers: new Headers() });
      await fetchLlmEgressProxy("http://proxy/test");
      await ensureLlmProxyConfigured();

      expect(configPosts()).toHaveLength(1);
    });
  });

  it("skips the push while the shared proxy already holds this config", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    await ensureLlmProxyConfigured();
    await ensureLlmProxyConfigured();

    expect(configPosts()).toHaveLength(1);
  });

  it("keeps per-process behaviour when Redis is unavailable", async () => {
    useRedis(false);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    await ensureLlmProxyConfigured();
    await ensureLlmProxyConfigured();

    expect(configPosts()).toHaveLength(1);
  });

  it("re-pushes while Redis is configured but disconnected", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    await ensureLlmProxyConfigured();
    mocks.redisConnected = false;
    await ensureLlmProxyConfigured();

    expect(configPosts()).toHaveLength(2);
    expect(redis.client.set).toHaveBeenCalledTimes(1); // not recorded while disconnected
  });

  it("re-pushes when the shared marker cannot be read", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    await ensureLlmProxyConfigured();
    redis.client.get.mockRejectedValueOnce(new Error("redis down"));
    await ensureLlmProxyConfigured();

    expect(configPosts()).toHaveLength(2);
  });

  it("still reports success when the shared marker cannot be recorded", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
    redis.client.set.mockRejectedValueOnce(new Error("redis down"));
    const { ensureLlmProxyConfigured } = await import("../../../../src/services/ai/config");

    await expect(ensureLlmProxyConfigured()).resolves.toMatchObject({ ready: true });
    // No marker was recorded, so the next check cannot skip and pushes again.
    await ensureLlmProxyConfigured();
    expect(configPosts()).toHaveLength(2);
  });

  it("forceSyncConfig pushes a disabled config without the credential", async () => {
    useRedis(true);
    mocks.fetch.mockResolvedValue(okJson({ success: true }));
    mocks.decrypt.mockReturnValue("stored-api-key");
    mocks.systemSettingFindMany.mockResolvedValue([
      setting("aiEnabled", false),
      setting("aiActiveProviderProfileId", "p1"),
      setting("aiProviderProfiles", [{
        id: "p1",
        name: "Hosted",
        providerType: "openai-compatible",
        endpoint: "https://provider.example.test/v1",
        model: "model-x",
        capabilities: { chat: true, toolCalls: true, strictJson: true },
      }]),
      setting("aiProviderCredentials", { p1: { type: "api-key", encryptedApiKey: "encrypted" } }),
    ] as any);
    const { forceSyncConfig, getAIConfig } = await import("../../../../src/services/ai/config");
    expect((await getAIConfig()).apiKey).toBe("stored-api-key"); // the credential exists

    await expect(forceSyncConfig()).resolves.toBe(true);

    const posts = configPosts();
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0][1].body));
    expect(body).toMatchObject({ enabled: false, apiKey: "" });
  });
});
