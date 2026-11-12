import { describe, expect, it, vi } from "vitest";

import { PROXY_BOOT_ID, PROXY_BOOT_ID_HEADER, stampBootId } from "../../llm-egress-proxy/src/bootId";

// The proxy holds its provider config only in memory. The boot id lets the
// server notice a restart on any response, including the routes that answer
// 200 or 400 while unconfigured.
describe("LLM egress proxy boot id", () => {
  it("is a non-empty id fixed for the life of the process", () => {
    expect(PROXY_BOOT_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("stamps every response and continues the chain", () => {
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    stampBootId({} as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith(PROXY_BOOT_ID_HEADER, PROXY_BOOT_ID);
    expect(PROXY_BOOT_ID_HEADER).toBe("x-sanctuary-proxy-boot-id");
    expect(next).toHaveBeenCalledOnce();
  });
});
