import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("LLM egress proxy rate-limit cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not keep the proxy process alive and can be stopped on shutdown", async () => {
    vi.resetModules();

    const intervalHandle = { unref: vi.fn() };
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(intervalHandle as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => undefined);

    const { stopRateLimitCleanup } = await import(
      "../../llm-egress-proxy/src/rateLimit"
    );

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
    expect(intervalHandle.unref).toHaveBeenCalledTimes(1);

    stopRateLimitCleanup();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
  });
});

describe("LLM egress proxy rate-limit keying", () => {
  const makeReq = (address: string, headers?: Record<string, unknown>) =>
    ({ socket: { remoteAddress: address }, ...(headers ? { headers } : {}) }) as never;
  const makeRes = () => {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  };
  const exhaust = async (
    rateLimit: (req: never, res: never, next: () => void) => unknown,
    req: never,
  ) => {
    for (let i = 0; i < 10; i++) rateLimit(req, makeRes() as never, vi.fn());
  };

  afterEach(() => {
    vi.resetModules();
  });

  it("partitions buckets by the backend-supplied principal header", async () => {
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const userA = makeReq("10.0.0.1", { "x-llm-egress-rate-key": "user:a" });
    await exhaust(rateLimit as never, userA);

    const blockedRes = makeRes();
    const blockedNext = vi.fn();
    rateLimit(userA, blockedRes as never, blockedNext);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedNext).not.toHaveBeenCalled();

    const userBNext = vi.fn();
    rateLimit(
      makeReq("10.0.0.1", { "x-llm-egress-rate-key": "user:b" }),
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
  ])("falls back to the socket key for a %s header", async (_name, headers) => {
    const { rateLimit, stopRateLimitCleanup } = await import("../../llm-egress-proxy/src/rateLimit");
    const req = makeReq("10.0.0.2", headers);
    await exhaust(rateLimit as never, req);

    const blockedRes = makeRes();
    rateLimit(req, blockedRes as never, vi.fn());
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    // A different (invalid) header on the same socket shares the socket bucket.
    const sameSocket = makeRes();
    rateLimit(makeReq("10.0.0.2"), sameSocket as never, vi.fn());
    expect(sameSocket.status).toHaveBeenCalledWith(429);
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
