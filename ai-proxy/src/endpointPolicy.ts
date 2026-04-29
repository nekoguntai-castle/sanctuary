import { isIP } from "node:net";

import { isIpAllowed } from "./ipPolicy";

export interface EndpointPolicyOptions {
  allowedHosts: string[];
  allowedCidrs: string[];
  allowPublicHttps: boolean;
}

export interface EndpointPolicyDecision {
  allowed: boolean;
  reason?: string;
  normalizedEndpoint?: string;
}

// Trusted defaults point at local/container model providers or Docker host,
// not arbitrary internet destinations.
const DEFAULT_ALLOWED_HOSTS = new Set([
  "localhost",
  "ollama",
  "host.docker.internal",
]);

function parseEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getEndpointPolicyOptionsFromEnv(): EndpointPolicyOptions {
  return {
    allowedHosts: parseEnvList(process.env.AI_PROXY_ALLOWED_HOSTS),
    allowedCidrs: parseEnvList(process.env.AI_PROXY_ALLOWED_CIDRS),
    allowPublicHttps: process.env.AI_PROXY_ALLOW_PUBLIC_HTTPS === "true",
  };
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

function hostMatchesAllowedPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix);
  }
  return hostname === pattern;
}

function isHostExplicitlyAllowed(
  hostname: string,
  allowedHosts: string[],
): boolean {
  if (DEFAULT_ALLOWED_HOSTS.has(hostname)) {
    return true;
  }

  // `.local` supports mDNS-discovered LAN LLMs without opening public egress.
  if (hostname.endsWith(".local")) {
    return true;
  }

  return allowedHosts.some((allowedHost) =>
    hostMatchesAllowedPattern(hostname, allowedHost),
  );
}

/**
 * SSRF boundary for provider endpoints. The proxy may call local, container,
 * private-LAN, and explicitly allowlisted model hosts; it rejects embedded URL
 * credentials, unsupported protocols, and unlisted public endpoints.
 */
export function evaluateProviderEndpoint(
  endpoint: string,
  options = getEndpointPolicyOptionsFromEnv(),
): EndpointPolicyDecision {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }

  if (url.username || url.password) {
    return { allowed: false, reason: "embedded_credentials_not_allowed" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: "unsupported_protocol" };
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  const hostIsIp = isIP(hostname) !== 0;
  const hostAllowed = hostIsIp
    ? isIpAllowed(hostname, options.allowedCidrs)
    : isHostExplicitlyAllowed(hostname, options.allowedHosts);

  if (hostAllowed) {
    return {
      allowed: true,
      normalizedEndpoint: url.toString().replace(/\/$/, ""),
    };
  }

  if (url.protocol === "https:" && options.allowPublicHttps) {
    return {
      allowed: true,
      normalizedEndpoint: url.toString().replace(/\/$/, ""),
    };
  }

  return { allowed: false, reason: "host_not_allowed" };
}

export function requireAllowedProviderEndpoint(endpoint: string): void {
  const decision = evaluateProviderEndpoint(endpoint);
  if (!decision.allowed) {
    throw new Error(decision.reason ?? "endpoint_not_allowed");
  }
}
