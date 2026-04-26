import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { createLogger } from "./logger";

const log = createLogger("AI:AUTH");

export const AI_SERVICE_SECRET_HEADER = "x-ai-service-secret";
export const AI_CONFIG_SECRET_HEADER = "x-ai-config-secret";

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
export function hasValidAIServiceSecret(
  req: HeaderReader,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) {
    return false;
  }

  const serviceSecret = getHeaderValue(req, AI_SERVICE_SECRET_HEADER);
  const configSecret = getHeaderValue(req, AI_CONFIG_SECRET_HEADER);

  return (
    timingSafeSecretEquals(serviceSecret, expectedSecret) ||
    timingSafeSecretEquals(configSecret, expectedSecret)
  );
}

/**
 * Authenticates backend-owned calls into the AI proxy. `/health` is mounted
 * before this middleware; every later route must present the shared service
 * secret.
 */
export function requireAIServiceSecret(expectedSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasValidAIServiceSecret(req, expectedSecret)) {
      return next();
    }

    log.warn("Unauthorized AI proxy request", {
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({ error: "Unauthorized" });
  };
}
