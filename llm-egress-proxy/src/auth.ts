import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { createLogger } from "./logger";

const log = createLogger("LLM_EGRESS_PROXY:AUTH");

export const LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER =
  "x-llm-egress-proxy-secret";
export const LLM_EGRESS_PROXY_SECRET_HEADER = "x-llm-egress-config-secret";

type HeaderValue = string | string[] | undefined;

export interface HeaderReader {
  headers: Record<string, HeaderValue>;
}

function getHeaderValue(req: HeaderReader, headerName: string): string {
  const value = req.headers[headerName];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function secretDigest(value: string): Buffer {
  // Normalize secret length before timingSafeEqual so mismatched inputs neither
  // throw nor reveal length through comparison timing.
  return createHash("sha256").update(value).digest();
}

function timingSafeSecretEquals(
  providedSecret: string,
  expectedSecret: string,
) {
  if (!providedSecret || !expectedSecret) {
    return false;
  }

  return timingSafeEqual(
    secretDigest(providedSecret),
    secretDigest(expectedSecret),
  );
}

/**
 * Accept either the generic service-auth header or the legacy config-sync
 * header. Empty expected secrets fail closed so a missing env var never turns
 * into an unauthenticated proxy.
 */
export function hasValidLlmEgressProxySecret(
  req: HeaderReader,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) {
    return false;
  }

  const serviceSecret = getHeaderValue(
    req,
    LLM_EGRESS_PROXY_SERVICE_SECRET_HEADER,
  );
  const llmEgressProxySecret = getHeaderValue(
    req,
    LLM_EGRESS_PROXY_SECRET_HEADER,
  );

  return (
    timingSafeSecretEquals(serviceSecret, expectedSecret) ||
    timingSafeSecretEquals(llmEgressProxySecret, expectedSecret)
  );
}

/**
 * Authenticates backend-owned calls into the LLM egress proxy. `/health` is mounted
 * before this middleware; every later route must present the shared service
 * secret.
 */
export function requireLlmEgressProxySecret(expectedSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasValidLlmEgressProxySecret(req, expectedSecret)) {
      return next();
    }

    log.warn("Unauthorized LLM egress proxy request", {
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({ error: "Unauthorized" });
  };
}
