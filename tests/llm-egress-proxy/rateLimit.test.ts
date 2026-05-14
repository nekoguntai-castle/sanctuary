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
