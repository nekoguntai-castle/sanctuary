/**
 * LLM Egress Proxy Configuration
 *
 * Centralized environment parsing and startup validation for the isolated
 * LLM egress proxy service.
 */

export type ProxyLogLevel = "debug" | "info" | "warn" | "error";

export interface ProxyConfig {
  port: number;
  backendUrl: string;
  configSecret: string | undefined;
  logLevel: ProxyLogLevel;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  aiRequestTimeoutMs: number;
  aiAnalysisTimeoutMs: number;
}

export interface EndpointPolicyEnvOptions {
  allowedHosts: string[];
  allowedCidrs: string[];
  allowPublicHttps: boolean;
}

const VALID_LOG_LEVELS: ReadonlySet<ProxyLogLevel> = new Set([
  "debug",
  "info",
  "warn",
  "error",
]);

function readTrimmedEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max?: number,
): number {
  const raw = readTrimmedEnv(env, name);
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `Invalid ${name}: expected a positive integer, received "${raw}"`,
    );
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    (max !== undefined && parsed > max)
  ) {
    const range = max !== undefined ? ` between 1 and ${max}` : "";
    throw new Error(
      `Invalid ${name}: expected a positive integer${range}, received "${raw}"`,
    );
  }
  return parsed;
}

function parseLogLevel(env: NodeJS.ProcessEnv): ProxyLogLevel {
  const raw = readTrimmedEnv(env, "LOG_LEVEL")?.toLowerCase();
  if (raw && VALID_LOG_LEVELS.has(raw as ProxyLogLevel)) {
    return raw as ProxyLogLevel;
  }
  return "info";
}

function parseEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Read endpoint policy env allowlists dynamically so runtime test overrides of
 * `process.env.LLM_EGRESS_PROXY_*` are respected.
 */
export function readEndpointPolicyEnv(
  env: NodeJS.ProcessEnv = process.env,
): EndpointPolicyEnvOptions {
  return {
    allowedHosts: parseEnvList(env.LLM_EGRESS_PROXY_ALLOWED_HOSTS),
    allowedCidrs: parseEnvList(env.LLM_EGRESS_PROXY_ALLOWED_CIDRS),
    allowPublicHttps: env.LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS === "true",
  };
}

export function loadProxyConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProxyConfig {
  return {
    port: parsePositiveIntEnv(env, "PORT", 3100, 65535),
    backendUrl: readTrimmedEnv(env, "BACKEND_URL") ?? "http://backend:3001",
    configSecret: readTrimmedEnv(env, "LLM_EGRESS_PROXY_SECRET"),
    logLevel: parseLogLevel(env),
    rateLimitWindowMs: parsePositiveIntEnv(
      env,
      "AI_RATE_LIMIT_WINDOW_MS",
      60000,
    ),
    rateLimitMaxRequests: parsePositiveIntEnv(
      env,
      "AI_RATE_LIMIT_MAX_REQUESTS",
      10,
    ),
    aiRequestTimeoutMs: parsePositiveIntEnv(
      env,
      "AI_REQUEST_TIMEOUT_MS",
      30000,
    ),
    aiAnalysisTimeoutMs: parsePositiveIntEnv(
      env,
      "AI_ANALYSIS_TIMEOUT_MS",
      120000,
    ),
  };
}

export const config: ProxyConfig = loadProxyConfig();
