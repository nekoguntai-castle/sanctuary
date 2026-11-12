import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Identifies this run of the proxy. The provider config lives only in memory,
 * so a restart loses it. The server compares this id across responses and
 * pushes the config again when it changes, whatever the route answered.
 */
export const PROXY_BOOT_ID: string = randomUUID();

export const PROXY_BOOT_ID_HEADER = "x-sanctuary-proxy-boot-id";

export function stampBootId(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(PROXY_BOOT_ID_HEADER, PROXY_BOOT_ID);
  next();
}
