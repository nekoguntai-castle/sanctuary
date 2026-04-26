import { describe, expect, it } from "vitest";

import {
  cidrContainsIpv4,
  isIpAllowed,
  isPrivateIpv4,
  isPrivateIpv6,
} from "../../ai-proxy/src/ipPolicy";

describe("AI proxy IP policy", () => {
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
  });

  it("allows private IPv6 and rejects public IPv6 by default", () => {
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("fd00::1")).toBe(true);
    expect(isPrivateIpv6("fc00::1")).toBe(true);
    expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false);
    expect(isIpAllowed("::1", [])).toBe(true);
    expect(isIpAllowed("2001:4860:4860::8888", [])).toBe(false);
  });

  it("allows configured public IPv4 CIDRs without allowing unrelated addresses", () => {
    expect(isIpAllowed("203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(isIpAllowed("198.51.100.10", ["203.0.113.0/24"])).toBe(false);
    expect(isIpAllowed("not-an-ip", ["203.0.113.0/24"])).toBe(false);
  });
});
