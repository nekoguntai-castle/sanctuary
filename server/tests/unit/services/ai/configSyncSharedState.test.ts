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
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
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

  describe("P1-8 boot-scoped shared marker & single retry on unconfigured proxy response", () => {
    function withBootId(status: number, body: unknown, bootId: string) {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ "x-sanctuary-proxy-boot-id": bootId }),
        json: vi.fn().mockResolvedValue(body),
        clone: () => ({ json: vi.fn().mockResolvedValue(body) }),
      } as any;
    }

    it.each([
      { status: 503, body: { reason: "provider_not_configured" }, boot: "boot-2" },
      { status: 200, body: { available: true }, boot: "boot-3" },
    ])("clears the marker when the sole replay returns $status on $boot", async ({ status, body, boot }) => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { fetchLlmEgressProxy } = await import("../../../../src/services/ai/config");
      mocks.fetch
        .mockResolvedValueOnce(withBootId(503, { reason: "provider_not_configured" }, "boot-1"))
        .mockResolvedValueOnce(withBootId(200, { success: true }, "boot-2"))
        .mockResolvedValueOnce(withBootId(status, body, boot));

      const response = await fetchLlmEgressProxy("http://proxy/console/plan");

      expect(response.status).toBe(status);
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      expect(redis.store.has("ai:llm-egress-proxy:config-hash")).toBe(false);
    });

    it("returns the original response when the config push fails", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { fetchLlmEgressProxy } = await import("../../../../src/services/ai/config");
      const unavailable = withBootId(503, { reason: "provider_not_configured" }, "boot-1");
      mocks.fetch.mockResolvedValueOnce(unavailable).mockRejectedValueOnce(new Error("proxy offline"));

      await expect(fetchLlmEgressProxy("http://proxy/console/plan")).resolves.toBe(unavailable);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it("returns a relative config endpoint response even when marker deletion fails", async () => {
      useRedis(true);
      const { fetchLlmEgressProxy } = await import("../../../../src/services/ai/config");
      const unavailable = withBootId(400, { error: "No AI endpoint configured" }, "boot-1");
      mocks.fetch.mockResolvedValueOnce(unavailable);
      redis.client.del.mockRejectedValueOnce(new Error("redis offline"));

      await expect(fetchLlmEgressProxy("/config")).resolves.toBe(unavailable);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(redis.client.del).toHaveBeenCalledWith("ai:llm-egress-proxy:config-hash");
    });

    it("stores bootId with hash in Redis and deletes the shared marker on boot-id change", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { ensureLlmProxyConfigured, fetchLlmEgressProxy } = await import(
        "../../../../src/services/ai/config"
      );

      mocks.fetch.mockResolvedValueOnce(withBootId(200, { success: true }, "boot-1"));
      await ensureLlmProxyConfigured();

      const storedMarker = redis.store.get("ai:llm-egress-proxy:config-hash");
      expect(storedMarker).toBeDefined();
      expect(storedMarker).toContain("boot-1");

      // Observing a new boot id invalidates the shared Redis marker for sibling replicas too.
      mocks.fetch.mockResolvedValueOnce(withBootId(200, { available: true }, "boot-2"));
      await fetchLlmEgressProxy("http://llm-egress-proxy:3100/health");

      expect(redis.client.del).toHaveBeenCalledWith("ai:llm-egress-proxy:config-hash");
      expect(redis.store.has("ai:llm-egress-proxy:config-hash")).toBe(false);
    });

    it("re-pushes config and replays once when outbound call receives an unconfigured 503 or 400 response", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { ensureLlmProxyConfigured, fetchLlmEgressProxy } = await import(
        "../../../../src/services/ai/config"
      );

      // Initial sync to boot-1
      mocks.fetch.mockResolvedValueOnce(withBootId(200, { success: true }, "boot-1"));
      await ensureLlmProxyConfigured();
      expect(configPosts()).toHaveLength(1);

      // Proxy restarts into boot-2 and answers 503 provider_not_configured on first call
      mocks.fetch
        .mockResolvedValueOnce(
          withBootId(503, { error: "AI is not enabled", reason: "provider_not_configured" }, "boot-2"),
        )
        .mockResolvedValueOnce(withBootId(200, { success: true }, "boot-2"))
        .mockResolvedValueOnce(withBootId(200, { answer: "replayed" }, "boot-2"));

      const response = await fetchLlmEgressProxy("http://llm-egress-proxy:3100/console/plan", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ answer: "replayed" });
      expect(configPosts()).toHaveLength(2);
      expect(redis.client.del).toHaveBeenCalledWith("ai:llm-egress-proxy:config-hash");
      expect(redis.store.get("ai:llm-egress-proxy:config-hash")).toContain("boot-2");
    });

    it("re-pushes and replays once on 400 'No AI endpoint configured' and respects skipConfigRetry", async () => {
      useRedis(true);
      mocks.systemSettingFindMany.mockResolvedValue(configFor("model-x"));
      const { fetchLlmEgressProxy } = await import("../../../../src/services/ai/config");

      mocks.fetch
        .mockResolvedValueOnce(withBootId(400, { error: "No AI endpoint configured" }, "boot-3"))
        .mockResolvedValueOnce(withBootId(200, { success: true }, "boot-3"))
        .mockResolvedValueOnce(withBootId(200, { models: ["model-x"] }, "boot-3"));

      const response = await fetchLlmEgressProxy("http://llm-egress-proxy:3100/list-models");
      expect(response.status).toBe(200);
      expect(configPosts()).toHaveLength(1);

      // When skipConfigRetry is true, do not re-push or replay.
      mocks.fetch.mockResolvedValueOnce(
        withBootId(400, { error: "No AI endpoint configured" }, "boot-4"),
      );
      const skipped = await (fetchLlmEgressProxy as any)(
        "http://llm-egress-proxy:3100/list-models",
        undefined,
        { skipConfigRetry: true },
      );
      expect(skipped.status).toBe(400);
      expect(configPosts()).toHaveLength(1);
    });
  });
});
