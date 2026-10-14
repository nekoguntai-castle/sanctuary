import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock("../../../../src/config", () => ({
  getConfig: mocks.getConfig,
}));

import {
  buildLlmEgressProxyAuthHeaders,
  buildLlmEgressProxyJsonHeaders,
  LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER,
  LLM_EGRESS_PROXY_RATE_KEY_HEADER,
  LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER,
} from "../../../../src/services/ai/llmEgressProxyClient";

describe("llm egress proxy client headers", () => {
  beforeEach(() => {
    mocks.getConfig.mockReturnValue({ ai: { llmEgressProxySecret: "s3cret" } });
  });

  it("emits only the service secret by default", () => {
    expect(buildLlmEgressProxyAuthHeaders()).toEqual({
      [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "s3cret",
    });
  });

  it("emits the config secret when requested", () => {
    expect(buildLlmEgressProxyAuthHeaders({ includeConfigSecret: true })).toEqual({
      [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "s3cret",
      [LLM_EGRESS_PROXY_CONFIG_SECRET_HEADER]: "s3cret",
    });
  });

  it("emits the rate-limit key from the auth-headers builder", () => {
    expect(buildLlmEgressProxyAuthHeaders({ rateLimitKey: "admin:system" })).toEqual({
      [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "s3cret",
      [LLM_EGRESS_PROXY_RATE_KEY_HEADER]: "admin:system",
    });
  });

  it("emits the rate-limit key from the JSON builder, which delegates", () => {
    expect(
      buildLlmEgressProxyJsonHeaders({
        authorization: "Bearer t",
        rateLimitKey: "user:2f6c1c1e-8a52-4a43-9a43-6f1b6a2f3c11",
      }),
    ).toEqual({
      "Content-Type": "application/json",
      [LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER]: "s3cret",
      [LLM_EGRESS_PROXY_RATE_KEY_HEADER]: "user:2f6c1c1e-8a52-4a43-9a43-6f1b6a2f3c11",
      Authorization: "Bearer t",
    });
  });

  it.each([
    "user:bad key",
    "user:",
    "root:abc",
    "user:" + "a".repeat(65),
    "user:a\r\nX-Injected: 1",
    "",
  ])("does not emit an invalid rate-limit key (%j)", (rateLimitKey) => {
    expect(buildLlmEgressProxyAuthHeaders({ rateLimitKey })).not.toHaveProperty(
      LLM_EGRESS_PROXY_RATE_KEY_HEADER,
    );
    expect(buildLlmEgressProxyJsonHeaders({ rateLimitKey })).not.toHaveProperty(
      LLM_EGRESS_PROXY_RATE_KEY_HEADER,
    );
  });
});
