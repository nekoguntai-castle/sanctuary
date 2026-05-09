import type { Request } from 'express';

/** Operational reason recorded when request-scoped cancellation is triggered. */
export type RequestAbortReason = 'timeout' | 'client_closed';

declare global {
  namespace Express {
    interface Request {
      requestAbortController?: AbortController;
      requestAbortSignal?: AbortSignal;
      requestAbortReason?: RequestAbortReason;
    }
  }
}

/**
 * Attach a single request-scoped controller that downstream services can share
 * for cancellation caused by middleware timeout or client disconnect.
 */
export function ensureRequestAbortController(req: Request): AbortController {
  if (!req.requestAbortController) {
    const controller = new AbortController();
    req.requestAbortController = controller;
    req.requestAbortSignal = controller.signal;
  }

  return req.requestAbortController;
}

/**
 * Abort the request-scoped signal once and retain the operational reason for
 * logging/tests. Middleware should call this when route work should stop.
 */
export function abortRequest(req: Request, reason: RequestAbortReason): void {
  const controller = ensureRequestAbortController(req);
  if (controller.signal.aborted) return;

  req.requestAbortReason = reason;
  controller.abort(new Error(reason));
}

/**
 * Return the signal attached by timeout middleware. Some tests and direct route
 * invocations do not run that middleware, so downstream callers must handle an
 * absent signal.
 */
export function getRequestAbortSignal(req: Request): AbortSignal | undefined {
  return req.requestAbortSignal;
}
