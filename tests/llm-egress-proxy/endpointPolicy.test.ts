import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateProviderEndpoint,
  getEndpointPolicyOptionsFromEnv,
  requireAllowedProviderEndpoint,
  validateProviderResolvedAddresses,
} from "../../llm-egress-proxy/src/endpointPolicy";

const defaultOptions = {
  allowedHosts: [],
  allowedCidrs: [],
  allowPublicHttps: false,
};

function resetEndpointPolicyEnv() {
  delete process.env.LLM_EGRESS_PROXY_ALLOWED_HOSTS;
  delete process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS;
  delete process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS;
}

describe("LLM egress proxy endpoint policy", () => {
  afterEach(() => {
    resetEndpointPolicyEnv();
  });

  it("allows host-local and mDNS provider endpoints by default", () => {
    expect(
      evaluateProviderEndpoint(
        "http://host.docker.internal:11434",
        defaultOptions,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://localhost:11434", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://studio.local:1234", defaultOptions)
        .allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://localhost:11434", defaultOptions),
    ).toMatchObject({ resolvedAddressPolicy: { mode: "loopback" } });
    expect(
      evaluateProviderEndpoint(
        "http://host.docker.internal:11434",
        defaultOptions,
      ),
    ).toMatchObject({ resolvedAddressPolicy: { mode: "local-network" } });
    expect(
      evaluateProviderEndpoint("http://studio.local:1234", defaultOptions),
    ).toMatchObject({ resolvedAddressPolicy: { mode: "local-network" } });
  });

  it("blocks container DNS names, numeric IPs, embedded credentials, and public endpoints by default", () => {
    expect(
      evaluateProviderEndpoint("http://ollama:11434", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
    expect(
      evaluateProviderEndpoint("http://192.168.1.20:11434", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
    expect(
      evaluateProviderEndpoint("http://192.168.1.20:1234/v1", defaultOptions),
    ).toMatchObject({
      allowed: false,
      reason: "host_not_allowed",
    });
    expect(
      evaluateProviderEndpoint(
        "http://user:pass@host.docker.internal:11434",
        defaultOptions,
      ),
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
      evaluateProviderEndpoint("https://api.example.com/v1", {
        ...defaultOptions,
        allowedHosts: ["api.example.com"],
      }),
    ).toMatchObject({ resolvedAddressPolicy: { mode: "explicit-host" } });
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
      }),
    ).toMatchObject({ resolvedAddressPolicy: { mode: "public-https" } });
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
      }),
    ).toMatchObject({
      resolvedAddressPolicy: {
        mode: "explicit-cidr",
        allowedCidrs: ["203.0.113.0/24"],
      },
    });
    expect(
      evaluateProviderEndpoint("http://203.0.113.10:11434", {
        ...defaultOptions,
        allowedCidrs: ["203.0.113.0/24"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://192.168.1.20:11434", {
        ...defaultOptions,
        allowedCidrs: ["192.168.1.0/24"],
      }).allowed,
    ).toBe(true);
    expect(
      evaluateProviderEndpoint("http://192.168.1.20:1234/v1", {
        ...defaultOptions,
        allowedCidrs: ["192.168.1.0/24"],
      }).allowed,
    ).toBe(true);
  });

  it("loads endpoint policy options from environment", () => {
    process.env.LLM_EGRESS_PROXY_ALLOWED_HOSTS =
      " api.example.com, *.models.example ";
    process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS = " 203.0.113.0/24 ";
    process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS = "true";

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
      requireAllowedProviderEndpoint("http://host.docker.internal:11434"),
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

  it("rejects private and special numeric endpoints in public HTTPS mode", () => {
    for (const endpoint of [
      "https://127.0.0.1/v1",
      "https://169.254.169.254/latest",
      "https://192.168.1.20/v1",
      "https://[::1]/v1",
      "https://[::ffff:a9fe:a9fe]/latest",
      "https://[2001:db8::1]/v1",
    ]) {
      expect(
        evaluateProviderEndpoint(endpoint, {
          ...defaultOptions,
          allowPublicHttps: true,
        }),
      ).toMatchObject({ allowed: false, reason: "host_not_allowed" });
    }

    expect(
      evaluateProviderEndpoint("https://8.8.8.8/v1", {
        ...defaultOptions,
        allowPublicHttps: true,
      }),
    ).toMatchObject({
      allowed: true,
      resolvedAddressPolicy: { mode: "public-https" },
    });
  });

  it("normalizes and validates every resolved answer for the selected mode", () => {
    const decision = evaluateProviderEndpoint("https://api.example.com/v1", {
      ...defaultOptions,
      allowPublicHttps: true,
    });
    expect(
      validateProviderResolvedAddresses(
        [
          { address: "8.8.8.8", family: 4 },
          { address: "2001:4860:4860::8888", family: 6 },
          { address: "8.8.8.8", family: 4 },
        ],
        decision,
      ),
    ).toEqual([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);

    expect(() =>
      validateProviderResolvedAddresses(
        [
          { address: "8.8.8.8", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ],
        decision,
      ),
    ).toThrow("resolved_address_not_allowed");
  });

  it("enforces loopback, local-network, explicit-host, and CIDR answer modes", () => {
    const localhost = evaluateProviderEndpoint(
      "http://localhost:11434",
      defaultOptions,
    );
    expect(
      validateProviderResolvedAddresses(
        [
          { address: "127.0.0.1", family: 4 },
          { address: "::1", family: 6 },
        ],
        localhost,
      ),
    ).toHaveLength(2);
    expect(() =>
      validateProviderResolvedAddresses(
        [{ address: "192.168.1.1", family: 4 }],
        localhost,
      ),
    ).toThrow("resolved_address_not_allowed");

    const mdns = evaluateProviderEndpoint(
      "http://studio.local:1234",
      defaultOptions,
    );
    expect(
      validateProviderResolvedAddresses(
        [
          { address: "192.168.1.20", family: 4 },
          { address: "fe80::20", family: 6 },
        ],
        mdns,
      ),
    ).toHaveLength(2);
    expect(() =>
      validateProviderResolvedAddresses(
        [{ address: "8.8.8.8", family: 4 }],
        mdns,
      ),
    ).toThrow("resolved_address_not_allowed");

    const explicitHost = evaluateProviderEndpoint(
      "http://model.example:11434",
      {
        ...defaultOptions,
        allowedHosts: ["model.example"],
        allowedCidrs: ["10.0.0.0/8"],
      },
    );
    expect(
      validateProviderResolvedAddresses(
        [{ address: "10.0.0.5", family: 4 }],
        explicitHost,
      ),
    ).toEqual([{ address: "10.0.0.5", family: 4 }]);

    const publicExplicitHost = evaluateProviderEndpoint(
      "https://model.example",
      {
        ...defaultOptions,
        allowedHosts: ["model.example"],
      },
    );
    expect(
      validateProviderResolvedAddresses(
        [{ address: "8.8.8.8", family: 4 }],
        publicExplicitHost,
      ),
    ).toHaveLength(1);
    expect(() =>
      validateProviderResolvedAddresses(
        [{ address: "10.0.0.5", family: 4 }],
        publicExplicitHost,
      ),
    ).toThrow("resolved_address_not_allowed");

    const cidr = evaluateProviderEndpoint("http://192.168.1.20:11434", {
      ...defaultOptions,
      allowedCidrs: ["192.168.1.0/24"],
    });
    expect(
      validateProviderResolvedAddresses(
        [{ address: "::ffff:c0a8:114", family: 6 }],
        cidr,
      ),
    ).toEqual([{ address: "192.168.1.20", family: 4 }]);
    expect(() =>
      validateProviderResolvedAddresses(
        [{ address: "192.168.2.20", family: 4 }],
        cidr,
      ),
    ).toThrow("resolved_address_not_allowed");
  });

  it("rejects metadata answers even for local-network hostnames", () => {
    const gateway = evaluateProviderEndpoint(
      "http://host.docker.internal:11434",
      defaultOptions,
    );
    for (const address of [
      "100.100.100.200",
      "168.63.129.16",
      "169.254.169.254",
      "169.254.170.2",
      "169.254.170.23",
      "fd00:ec2::23",
      "fd00:ec2::254",
    ]) {
      expect(() =>
        validateProviderResolvedAddresses(
          [{ address, family: address.includes(":") ? 6 : 4 } as const],
          gateway,
        ),
      ).toThrow("resolved_address_not_allowed");
    }
  });

  it("fails closed for missing, invalid, or blocked resolution context", () => {
    const allowed = evaluateProviderEndpoint(
      "http://localhost:11434",
      defaultOptions,
    );
    expect(() => validateProviderResolvedAddresses([], allowed)).toThrow(
      "resolved_address_not_found",
    );
    expect(() =>
      validateProviderResolvedAddresses(
        [{ address: "not-an-ip", family: 4 }],
        allowed,
      ),
    ).toThrow("invalid_resolved_address");
    expect(() =>
      validateProviderResolvedAddresses([{ address: "127.0.0.1", family: 4 }], {
        allowed: false,
        reason: "host_not_allowed",
      }),
    ).toThrow("host_not_allowed");
  });
});
