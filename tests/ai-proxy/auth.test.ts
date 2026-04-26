import { describe, expect, it, vi } from "vitest";

import {
  AI_CONFIG_SECRET_HEADER,
  AI_SERVICE_SECRET_HEADER,
  hasValidAIServiceSecret,
  requireAIServiceSecret,
} from "../../ai-proxy/src/auth";

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("AI proxy service auth", () => {
  it("accepts the service secret header", () => {
    expect(
      hasValidAIServiceSecret(
        { headers: { [AI_SERVICE_SECRET_HEADER]: "secret" } },
        "secret",
      ),
    ).toBe(true);
  });

  it("accepts the config secret header for config sync callers", () => {
    expect(
      hasValidAIServiceSecret(
        { headers: { [AI_CONFIG_SECRET_HEADER]: "secret" } },
        "secret",
      ),
    ).toBe(true);
  });

  it("accepts the first header value when Express provides header arrays", () => {
    expect(
      hasValidAIServiceSecret(
        { headers: { [AI_SERVICE_SECRET_HEADER]: ["secret", "wrong"] } },
        "secret",
      ),
    ).toBe(true);
  });

  it("rejects missing, mismatched, and empty expected secrets", () => {
    expect(hasValidAIServiceSecret({ headers: {} }, "secret")).toBe(false);
    expect(
      hasValidAIServiceSecret(
        { headers: { [AI_SERVICE_SECRET_HEADER]: "wrong" } },
        "secret",
      ),
    ).toBe(false);
    expect(
      hasValidAIServiceSecret(
        { headers: { [AI_SERVICE_SECRET_HEADER]: "secret" } },
        "",
      ),
    ).toBe(false);
  });

  it("lets authenticated middleware requests continue", () => {
    const req = {
      headers: { [AI_SERVICE_SECRET_HEADER]: "secret" },
      method: "POST",
      path: "/chat",
    };
    const res = makeResponse();
    const next = vi.fn();

    requireAIServiceSecret("secret")(req as any, res as any, next);

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

    requireAIServiceSecret("secret")(req as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});
