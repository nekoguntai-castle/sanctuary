import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("LLM egress proxy rate-limit cleanup", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("stops accepting the store's timer work on shutdown", async () => {
    const { rateLimit, stopRateLimitCleanup } = await import(
      "../../llm-egress-proxy/src/rateLimit"
    );
    const next = vi.fn();
    await rateLimit(makeReq("10.0.0.9") as never, makeRes() as never, next);
    expect(next).toHaveBeenCalledTimes(1);

    expect(() => stopRateLimitCleanup()).not.toThrow();
  });
});

function makeReq(ip: string, headers?: Record<string, unknown>) {
  return {
    ip,
    method: "POST",
    path: "/analyze",
    ...(headers ? { headers } : {}),
    app: { get: vi.fn().mockReturnValue(false) },
  };
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

type Limiter = (req: never, res: never, next: () => void) => unknown;

async function exhaust(rateLimit: Limiter, req: unknown) {
  for (let i = 0; i < 10; i++) await rateLimit(req as never, makeRes() as never, vi.fn());
}

describe("LLM egress proxy rate-limit keying", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("partitions buckets by the backend-supplied principal header", async () => {
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const userA = makeReq("10.0.0.1", { "x-llm-egress-rate-key": "user:a" });
    await exhaust(rateLimit as never, userA);

    const blockedRes = makeRes();
    const blockedNext = vi.fn();
    await rateLimit(userA as never, blockedRes as never, blockedNext);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.json).toHaveBeenCalledWith({
      error:
        "Rate limit exceeded. AI requests are limited to 10 per minute. Please wait 60s before trying again.",
      retryAfter: 60,
    });
    expect(blockedNext).not.toHaveBeenCalled();

    const userBNext = vi.fn();
    await rateLimit(
      makeReq("10.0.0.1", { "x-llm-egress-rate-key": "user:b" }) as never,
      makeRes() as never,
      userBNext,
    );
    expect(userBNext).toHaveBeenCalledTimes(1);
    stopRateLimitCleanup();
  });

  it.each([
    ["malformed", { "x-llm-egress-rate-key": "user:bad key!" }],
    ["array-valued", { "x-llm-egress-rate-key": ["user:a", "user:b"] }],
    ["unknown prefix", { "x-llm-egress-rate-key": "other:a" }],
    ["missing headers object", undefined],
  ])("falls back to the address key for a %s header", async (_name, headers) => {
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const req = makeReq("10.0.0.2", headers);
    await exhaust(rateLimit as never, req);

    const blockedRes = makeRes();
    await rateLimit(req as never, blockedRes as never, vi.fn());
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    // A different (invalid) header from the same address shares its bucket.
    const sameAddress = makeRes();
    await rateLimit(makeReq("10.0.0.2", {}) as never, sameAddress as never, vi.fn());
    expect(sameAddress.status).toHaveBeenCalledWith(429);
    stopRateLimitCleanup();
  });

  it("uses one bucket when the request has no address", async () => {
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const req = { ...makeReq("unused", {}), ip: undefined };
    await exhaust(rateLimit as never, req);

    const blockedRes = makeRes();
    await rateLimit(req as never, blockedRes as never, vi.fn());
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    stopRateLimitCleanup();
  });

  it("gives a principal one budget across every rate-limited route", async () => {
    // The label and query routes used to have their own limiter and store, so
    // a caller got the advertised limit once per store.
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const { registerLabelQueryRoutes } = await import("../../llm-egress-proxy/src/labelQueryRoutes");
    const routes = new Map<string, unknown[]>();
    registerLabelQueryRoutes(
      { post: (path: string, ...handlers: unknown[]) => routes.set(path, handlers) } as never,
      { backendUrl: "http://backend:3001", getAiConfig: vi.fn(), log: {} } as never,
    );
    const keyed = () => makeReq("10.0.0.3", { "x-llm-egress-rate-key": "user:shared" });

    await exhaust(rateLimit as never, keyed());

    for (const path of ["/suggest-label", "/query"]) {
      const [labelLimiter] = routes.get(path) as Limiter[];
      const res = makeRes();
      const next = vi.fn();
      await labelLimiter(keyed() as never, res as never, next);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    }
    stopRateLimitCleanup();
  });

  it("authenticates with the shared secret before any rate-limited route is registered", () => {
    const source = readFileSync(join(__dirname, "../../llm-egress-proxy/src/index.ts"), "utf8");
    const secretAt = source.indexOf("app.use(requireLlmEgressProxySecret(");
    expect(secretAt).toBeGreaterThan(-1);
    for (const register of [
      "registerLabelQueryRoutes(app",
      "registerProviderRoutes(app",
      "registerInsightRoutes(app",
      "registerConsoleRoutes(app",
    ]) {
      expect(source.indexOf(register)).toBeGreaterThan(secretAt);
    }
  });
});
