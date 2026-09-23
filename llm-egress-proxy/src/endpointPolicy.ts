import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

import {
  isIpAllowed,
  isLocalNetworkIp,
  isLoopbackIp,
  isMetadataIp,
  isPublicIp,
  normalizeIpAddress,
} from "./ipPolicy";

export interface EndpointPolicyOptions {
  allowedHosts: string[];
  allowedCidrs: string[];
  allowPublicHttps: boolean;
  /**
   * Endpoints an admin chose — the saved provider endpoint, or one typed into
   * detection — as `address|port` keys. Admitted only where the rules above
   * refuse them, and only for private LAN IP literals.
   */
  approvedEndpoints?: string[];
}

export type ResolvedAddressPolicyMode =
  | "loopback"
  | "local-network"
  | "explicit-host"
  | "explicit-cidr"
  | "approved-lan"
  | "public-https";

export interface ResolvedAddressPolicy {
  mode: ResolvedAddressPolicyMode;
  allowedCidrs?: string[];
}

export interface EndpointPolicyDecision {
  allowed: boolean;
  reason?: string;
  normalizedEndpoint?: string;
  resolvedAddressPolicy?: ResolvedAddressPolicy;
}

export interface ProviderResolvedAddress {
  address: string;
  family: 4 | 6;
}

function parseEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getEndpointPolicyOptionsFromEnv(): EndpointPolicyOptions {
  return {
    allowedHosts: parseEnvList(process.env.LLM_EGRESS_PROXY_ALLOWED_HOSTS),
    allowedCidrs: parseEnvList(process.env.LLM_EGRESS_PROXY_ALLOWED_CIDRS),
    allowPublicHttps:
      process.env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS === "true",
  };
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * The key an admin approval is recorded under: a normalized IP literal and its
 * effective port. Hostnames are never approvable — a name is re-resolved on
 * every hop, so approving one would let whoever controls its DNS steer the
 * proxy across the LAN (and single-label names are Docker services). Names
 * keep the existing routes: `*.local`, `host.docker.internal`, or the env
 * allowlists. The port is part of the key so a provider cannot redirect to
 * another service on the same machine.
 */
function approvalKey(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return null;
  }
  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (isIP(hostname) === 0) return null;
  const address = normalizeIpAddress(hostname);
  if (!address) return null;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${address}|${port}`;
}

// Proxy routes are reachable only by the backend (shared secret), which
// forwards a provider endpoint only from admin settings or admin detection.
// Approval follows that choice rather than a static allowlist, so changing the
// endpoint in the UI is enough — and the previous one stops being admitted.
let configuredApproval: string | null = null;
const requestApprovals = new AsyncLocalStorage<string[]>();

/** Record the provider endpoint the admin saved, replacing the previous one. */
export function setConfiguredProviderEndpoint(endpoint: string): void {
  configuredApproval = approvalKey(endpoint);
}

/**
 * Admit an admin-typed endpoint for the duration of `run` (and every redirect
 * hop it makes), e.g. to detect a provider before its endpoint is saved.
 */
export function withApprovedProviderEndpoint<T>(
  endpoint: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = approvalKey(endpoint);
  const inherited = requestApprovals.getStore() ?? [];
  return requestApprovals.run(key ? [...inherited, key] : inherited, run);
}

/** Env allowlists plus the endpoints an admin has approved. */
export function getEndpointPolicyOptions(
  extraApprovedEndpoints: readonly string[] = [],
): EndpointPolicyOptions {
  const approvedEndpoints = [
    configuredApproval,
    ...(requestApprovals.getStore() ?? []),
    ...extraApprovedEndpoints.map(approvalKey),
  ].filter((key): key is string => Boolean(key));
  return { ...getEndpointPolicyOptionsFromEnv(), approvedEndpoints };
}

/** A private LAN address that is neither the proxy's own loopback nor metadata. */
function isApprovedLanAddress(address: string): boolean {
  return (
    isLocalNetworkIp(address) && !isLoopbackIp(address) && !isMetadataIp(address)
  );
}

function approvedLanDecision(
  endpoint: string,
  options: EndpointPolicyOptions,
): EndpointPolicyDecision | null {
  const key = approvalKey(endpoint);
  if (!key || !options.approvedEndpoints?.includes(key)) return null;
  const [address] = key.split("|");
  if (!isApprovedLanAddress(address!)) return null;
  return allowDecision(new URL(endpoint.trim()), { mode: "approved-lan" });
}

function hostMatchesAllowedPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    return hostname.endsWith(pattern.slice(1));
  }
  return hostname === pattern;
}

function policyForAllowedHostname(
  hostname: string,
  allowedHosts: string[],
  allowedCidrs: string[],
): ResolvedAddressPolicy | null {
  if (hostname === "localhost") return { mode: "loopback" };
  if (hostname === "host.docker.internal" || hostname.endsWith(".local")) {
    return { mode: "local-network" };
  }
  if (
    allowedHosts.some((pattern) => hostMatchesAllowedPattern(hostname, pattern))
  ) {
    return { mode: "explicit-host", allowedCidrs: [...allowedCidrs] };
  }
  return null;
}

function allowDecision(
  url: URL,
  policy: ResolvedAddressPolicy,
): EndpointPolicyDecision {
  return {
    allowed: true,
    normalizedEndpoint: url.toString().replace(/\/$/, ""),
    resolvedAddressPolicy: policy,
  };
}

function evaluateIpEndpoint(
  url: URL,
  hostname: string,
  options: EndpointPolicyOptions,
): EndpointPolicyDecision {
  const normalized = normalizeIpAddress(hostname);
  if (!normalized) return { allowed: false, reason: "host_not_allowed" };
  if (isIpAllowed(normalized, options.allowedCidrs)) {
    return allowDecision(url, {
      mode: "explicit-cidr",
      allowedCidrs: [...options.allowedCidrs],
    });
  }
  if (
    url.protocol === "https:" &&
    options.allowPublicHttps &&
    isPublicIp(normalized)
  ) {
    return allowDecision(url, { mode: "public-https" });
  }
  return { allowed: false, reason: "host_not_allowed" };
}

/** Evaluate the URL-level boundary and select the policy for DNS answers. */
export function evaluateProviderEndpoint(
  endpoint: string,
  options = getEndpointPolicyOptions(),
): EndpointPolicyDecision {
  const decision = evaluateStaticPolicy(endpoint, options);
  if (decision.allowed || decision.reason !== "host_not_allowed") {
    return decision;
  }
  // Only widens what the static rules refuse, so a host they already admit
  // keeps its own (e.g. public-https) policy.
  return approvedLanDecision(endpoint, options) ?? decision;
}

function evaluateStaticPolicy(
  endpoint: string,
  options: EndpointPolicyOptions,
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
  if (isIP(hostname) !== 0) return evaluateIpEndpoint(url, hostname, options);

  const explicitPolicy = policyForAllowedHostname(
    hostname,
    options.allowedHosts,
    options.allowedCidrs,
  );
  if (explicitPolicy) return allowDecision(url, explicitPolicy);
  if (url.protocol === "https:" && options.allowPublicHttps) {
    return allowDecision(url, { mode: "public-https" });
  }
  return { allowed: false, reason: "host_not_allowed" };
}

function normalizeResolvedAddress(
  resolved: ProviderResolvedAddress,
): ProviderResolvedAddress | null {
  const address = normalizeIpAddress(resolved.address);
  if (!address) return null;
  const family = isIP(address);
  if (family !== 4 && family !== 6) return null;
  return { address, family };
}

function addressMatchesPolicy(
  address: string,
  policy: ResolvedAddressPolicy,
): boolean {
  switch (policy.mode) {
    case "loopback":
      return isLoopbackIp(address);
    case "local-network":
      return !isMetadataIp(address) && isLocalNetworkIp(address);
    case "explicit-host":
      return (
        isPublicIp(address) || isIpAllowed(address, policy.allowedCidrs ?? [])
      );
    case "explicit-cidr":
      return isIpAllowed(address, policy.allowedCidrs ?? []);
    case "approved-lan":
      return isApprovedLanAddress(address);
    case "public-https":
      return isPublicIp(address);
  }
}

function deduplicateAddresses(
  addresses: ProviderResolvedAddress[],
): ProviderResolvedAddress[] {
  const seen = new Set<string>();
  return addresses.filter(({ address, family }) => {
    const key = `${family}:${address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function requireAllowedProviderEndpoint(endpoint: string): void {
  const decision = evaluateProviderEndpoint(endpoint);
  if (!decision.allowed) {
    throw new Error(decision.reason ?? "endpoint_not_allowed");
  }
}

/**
 * Validate every resolver answer before transport pins one address. A mixed safe
 * and unsafe answer set is rejected in full to prevent DNS rebinding fallback.
 */
export function validateProviderResolvedAddresses(
  addresses: readonly ProviderResolvedAddress[],
  decision: EndpointPolicyDecision,
): ProviderResolvedAddress[] {
  if (!decision.allowed || !decision.resolvedAddressPolicy) {
    throw new Error(decision.reason ?? "endpoint_not_allowed");
  }
  if (addresses.length === 0) throw new Error("resolved_address_not_found");

  const normalized = addresses.map(normalizeResolvedAddress);
  if (normalized.some((address) => address === null)) {
    throw new Error("invalid_resolved_address");
  }
  const valid = normalized as ProviderResolvedAddress[];
  if (
    !valid.every((address) =>
      addressMatchesPolicy(address.address, decision.resolvedAddressPolicy!),
    )
  ) {
    throw new Error("resolved_address_not_allowed");
  }
  return deduplicateAddresses(valid);
}
