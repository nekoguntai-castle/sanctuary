import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateProviderEndpoint,
  getEndpointPolicyOptionsFromEnv,
  requireAllowedProviderEndpoint,
} from "../../ai-proxy/src/endpointPolicy";

const defaultOptions = {
  allowedHosts: [],
  allowedCidrs: [],
  allowPublicHttps: false,
};

function resetEndpointPolicyEnv() {
  delete process.env.AI_PROXY_ALLOWED_HOSTS;
  delete process.env.AI_PROXY_ALLOWED_CIDRS;
  delete process.env.AI_PROXY_ALLOW_PUBLIC_HTTPS;
}

describe("AI proxy endpoint policy", () => {
  afterEach(() => {
    resetEndpointPolicyEnv();
  });

  it("allows bundled, host, loopback, and private LAN model endpoints by default", () => {
    expect(
      evaluateProviderEndpoint("http://ollama:11434", defaultOptions).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint(
        "http://host.docker.internal:11434",
        defaultOptions,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://127.0.0.1:11434", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://192.168.1.20:11434", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://10.0.0.42:11434", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://172.20.0.2:11434", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://studio.local:11434", defaultOptions)
        .allowed,
    ).toBe(true);
  });

  it("blocks embedded credentials and public HTTP endpoints by default", () => {
    expect(
      evaluateProviderEndpoint("http://user:pass@ollama:11434", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "embedded_credentials_not_allowed",
    });
    expect(
      evaluateProviderEndpoint("http://203.0.113.10:11434", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
    expect(
      evaluateProviderEndpoint("https://api.example.com/v1", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
  });

  it("allows explicit public hosts, wildcard host patterns, public HTTPS, and CIDR ranges by policy", () => {
    expect(
      evaluateProviderEndpoint("https://api.example.com/v1", {
        ...defaultOptions,
        allowedHosts: ["api.example.com"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("https://models.example.net/v1", {
        ...defaultOptions,
        allowedHosts: ["*.example.net"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("https://api.other.test/v1", {
        ...defaultOptions,
        allowPublicHttps: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://203.0.113.10:11434", {
        ...defaultOptions,
        allowedCidrs: ["203.0.113.0/24"],
      }).allowed,
    ).toBe(true);
  });

  it("loads endpoint policy options from environment", () => {
    process.env.AI_PROXY_ALLOWED_HOSTS = " api.example.com, *.models.example ";
    process.env.AI_PROXY_ALLOWED_CIDRS = " 203.0.113.0/24 ";
    process.env.AI_PROXY_ALLOW_PUBLIC_HTTPS = "true";

    expect(getEndpointPolicyOptionsFromEnv()).toEqual({
      allowedHosts: ["api.example.com", "*.models.example"],
      allowedCidrs: ["203.0.113.0/24"],
      allowPublicHttps: true,
    });
  });

  it("throws when callers require a blocked provider endpoint", () => {
    expect(() =>
      requireAllowedProviderEndpoint("http://203.0.113.10:11434"),
    ).toThrow("host_not_allowed");
    expect(() =>
      requireAllowedProviderEndpoint("http://192.168.1.20:11434"),
    ).not.toThrow();
  });

  it("rejects invalid URLs and unsupported protocols", () => {
    expect(evaluateProviderEndpoint("not a url", defaultOptions)).toMatchObject(
      {
        allowed: false,
        reason: "invalid_url",
      },
    );
    expect(
      evaluateProviderEndpoint("ftp://ollama:11434", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "unsupported_protocol",
    });
  });
});
