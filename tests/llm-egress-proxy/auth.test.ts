import { describe, expect, it, vi } from "vitest";

import {
  LLM_EGRESS_PROXY_SECRET_HEADER,
  LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER,
  hasValidLlmEgressProxySecret,
  requireLlmEgressProxySecret,
} from "../../llm-egress-proxy/src/auth";

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("LLM egress proxy service auth", () => {
  it("accepts the service secret header", () => {
    expect(
      hasValidLlmEgressProxySecret(
        { headers: { [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "secret" } },
        "secret",
      ),
    ).toBe(true);
  });

  it("accepts the config secret header for config sync callers", () => {
    expect(
      hasValidLlmEgressProxySecret(
        { headers: { [LLM_EGRESS_PROXY_SECRET_HEADER]: "secret" } },
        "secret",
      ),
    ).toBe(true);
  });

  it("accepts the first header value when Express provides header arrays", () => {
    expect(
      hasValidLlmEgressProxySecret(
        {
          headers: {
            [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: ["secret", "wrong"],
          },
        },
        "secret",
      ),
    ).toBe(true);
  });

  it("rejects missing, mismatched, and empty expected secrets", () => {
    expect(hasValidLlmEgressProxySecret({ headers: {} }, "secret")).toBe(false);
    expect(
      hasValidLlmEgressProxySecret(
        { headers: { [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "wrong" } },
        "secret",
      ),
    ).toBe(false);
    expect(
      hasValidLlmEgressProxySecret(
        { headers: { [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "secret" } },
        "",
      ),
    ).toBe(false);
  });

  it("lets authenticated middleware requests continue", () => {
    const req = {
      headers: { [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "secret" },
      method: "POST",
      path: "/chat",
    };
    const res = makeResponse();
    const next = vi.fn();

    requireLlmEgressProxySecret("secret")(req as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated middleware requests", () => {
    const req = {
      headers: {},
      method: "POST",
      path: "/chat",
    };
    const res = makeResponse();
    const next = vi.fn();

    requireLlmEgressProxySecret("secret")(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});
