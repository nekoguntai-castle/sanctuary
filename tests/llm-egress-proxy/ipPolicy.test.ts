import { describe, expect, it } from "vitest";

import {
  cidrContainsIpv4,
  isIpAllowed,
  isLocalNetworkIp,
  isLoopbackIp,
  isMetadataIp,
  isPrivateIpv4,
  isPrivateIpv6,
  isPublicIp,
  normalizeIpAddress,
} from "../../llm-egress-proxy/src/ipPolicy";

describe("LLM egress proxy IP policy", () => {
  it("recognizes private IPv4 ranges used for LAN LLM endpoints", () => {
    expect(isPrivateIpv4("10.0.0.5")).toBe(true);
    expect(isPrivateIpv4("172.16.0.5")).toBe(true);
    expect(isPrivateIpv4("172.31.255.250")).toBe(true);
    expect(isPrivateIpv4("192.168.1.20")).toBe(true);
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("203.0.113.10")).toBe(false);
  });

  it("matches IPv4 CIDRs and fails closed for malformed ranges", () => {
    expect(cidrContainsIpv4("203.0.113.0/24", "203.0.113.10")).toBe(true);
    expect(cidrContainsIpv4("203.0.113.0/24", "203.0.114.10")).toBe(false);
    expect(cidrContainsIpv4("bad-cidr", "203.0.113.10")).toBe(false);
    expect(cidrContainsIpv4("203.0.113.0/33", "203.0.113.10")).toBe(false);
    expect(cidrContainsIpv4("203.0.113./24", "203.0.113.10")).toBe(false);
    expect(cidrContainsIpv4("203.0.113.0/24/1", "203.0.113.10")).toBe(false);
  });

  it("recognizes private IPv6 but requires explicit policy for numeric endpoints", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    expect(isPrivateIpv6("fc00::1")).toBe(true);
    expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false);
    expect(isIpAllowed("::1", [])).toBe(false);
    expect(isIpAllowed("2001:4860:4860::8888", [])).toBe(false);
  });

  it("allows configured IPv4 CIDRs without allowing unrelated addresses", () => {
    expect(isIpAllowed("203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(isIpAllowed("192.168.1.20", ["192.168.1.0/24"])).toBe(true);
    expect(isIpAllowed("198.51.100.10", ["203.0.113.0/24"])).toBe(false);
    expect(isIpAllowed("192.168.1.20", [])).toBe(false);
    expect(isIpAllowed("not-an-ip", ["203.0.113.0/24"])).toBe(false);
  });

  it("normalizes IPv4-mapped IPv6 addresses before applying IPv4 policy", () => {
    expect(normalizeIpAddress("::ffff:192.168.1.20")).toBe("192.168.1.20");
    expect(normalizeIpAddress("::FFFF:c0a8:0114")).toBe("192.168.1.20");
    expect(normalizeIpAddress("2001:4860:4860::8888")).toBe(
      "2001:4860:4860::8888",
    );
    expect(normalizeIpAddress("not-an-ip")).toBeNull();
    expect(isIpAllowed("::ffff:c0a8:114", ["192.168.1.0/24"])).toBe(true);
  });

  it("distinguishes loopback and intended local-network addresses", () => {
    expect(isLoopbackIp("127.0.0.2")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackIp("192.168.1.20")).toBe(false);

    expect(isLocalNetworkIp("10.0.0.5")).toBe(true);
    expect(isLocalNetworkIp("100.64.1.2")).toBe(true);
    expect(isLocalNetworkIp("169.254.10.20")).toBe(true);
    expect(isLocalNetworkIp("fd00::1")).toBe(true);
    expect(isLocalNetworkIp("fe80::1")).toBe(true);
    expect(isLocalNetworkIp("0.0.0.0")).toBe(false);
    expect(isLocalNetworkIp("224.0.0.1")).toBe(false);
    expect(isLocalNetworkIp("203.0.113.10")).toBe(false);
    for (const address of [
      "100.100.100.200",
      "168.63.129.16",
      "169.254.169.254",
      "169.254.170.2",
      "169.254.170.23",
      "::ffff:169.254.169.254",
      "fd00:ec2::23",
      "fd00:ec2::254",
    ]) {
      expect(isMetadataIp(address)).toBe(true);
      expect(isPublicIp(address)).toBe(false);
    }
    expect(isMetadataIp("169.254.10.20")).toBe(false);
    expect(isMetadataIp("fd00::1")).toBe(false);
  });

  it("rejects private, documentation, link-local, multicast, and reserved public addresses", () => {
    const rejectedIpv4 = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
    ];
    for (const address of rejectedIpv4) expect(isPublicIp(address)).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);

    const rejectedIpv6 = [
      "::",
      "::1",
      "::ffff:10.0.0.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
    ];
    for (const address of rejectedIpv6) expect(isPublicIp(address)).toBe(false);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
  });
});
