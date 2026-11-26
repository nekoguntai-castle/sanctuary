import { afterEach, describe, expect, it } from "vitest";
import {
  loadProxyConfig,
  readEndpointPolicyEnv,
} from "../../llm-egress-proxy/src/config";

describe("LLM egress proxy config", () => {
  afterEach(() => {
    delete process.env.LLM_EGRESS_PROXY_ALLOWED_HOSTS;
    delete process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS;
    delete process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS;
  });

  it("uses sensible defaults when env vars are unset or empty/whitespace", () => {
    const cfg = loadProxyConfig({
      PORT: "   ",
      BACKEND_URL: "",
      LLM_EGRESS_PROXY_SECRET: "  ",
      LOG_LEVEL: "",
      AI_RATE_LIMIT_WINDOW_MS: "",
      AI_RATE_LIMIT_MAX_REQUESTS: "  ",
      AI_REQUEST_TIMEOUT_MS: "",
      AI_ANALYSIS_TIMEOUT_MS: "\t",
    });

    expect(cfg).toEqual({
      port: 3100,
      backendUrl: "http://backend:3001",
      configSecret: undefined,
      logLevel: "info",
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 10,
      aiRequestTimeoutMs: 30000,
      aiAnalysisTimeoutMs: 120000,
    });
  });

  it("parses valid positive integer and string overrides", () => {
    const cfg = loadProxyConfig({
      PORT: "3200",
      BACKEND_URL: " http://localhost:3001 ",
      LLM_EGRESS_PROXY_SECRET: "super-secret",
      LOG_LEVEL: "DEBUG",
      AI_RATE_LIMIT_WINDOW_MS: "120000",
      AI_RATE_LIMIT_MAX_REQUESTS: "25",
      AI_REQUEST_TIMEOUT_MS: "15000",
      AI_ANALYSIS_TIMEOUT_MS: "180000",
    });

    expect(cfg).toEqual({
      port: 3200,
      backendUrl: "http://localhost:3001",
      configSecret: "super-secret",
      logLevel: "debug",
      rateLimitWindowMs: 120000,
      rateLimitMaxRequests: 25,
      aiRequestTimeoutMs: 15000,
      aiAnalysisTimeoutMs: 180000,
    });
  });

  it("falls back to info for unrecognized LOG_LEVEL values", () => {
    const cfg = loadProxyConfig({ LOG_LEVEL: "verbose" });
    expect(cfg.logLevel).toBe("info");
  });

  it.each([
    ["PORT", "abc"],
    ["PORT", "0"],
    ["PORT", "70000"],
    ["AI_RATE_LIMIT_WINDOW_MS", "0"],
    ["AI_RATE_LIMIT_MAX_REQUESTS", "-5"],
    ["AI_REQUEST_TIMEOUT_MS", "12.5"],
    ["AI_ANALYSIS_TIMEOUT_MS", "30000ms"],
  ])("rejects invalid %s=%s", (key, value) => {
    expect(() => loadProxyConfig({ [key]: value })).toThrow(key);
  });

  it("reads runtime endpoint policy env overrides dynamically", () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_HOSTS = " api.example.com , *.models.local ";
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = " 10.0.0.0/8 ";
    process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS = "true";

    expect(readEndpointPolicyEnv()).toEqual({
      allowedHosts: ["api.example.com", "*.models.local"],
      allowedCidrs: ["10.0.0.0/8"],
      allowPublicHttps: true,
    });
  });
});
