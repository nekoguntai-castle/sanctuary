import express, { Request, RequestHandler } from 'express';

const DEFAULT_BODY_LIMIT = '10mb';
const INCIDENT_DIAGNOSTICS_BODY_LIMIT = '4kb';
const JADE_PIN_RELAY_ENVELOPE_LIMIT = '20kb';

/**
 * Express 5 routes a trailing-slash request (e.g. `/restore/`) to the same handler as
 * `/restore` (strict routing is off), and routes case-insensitively (e.g. `/Restore`
 * to the same handler as `/restore`, since nothing in this app sets `case sensitive
 * routing`). Both the route tables below and the request lookup go through this
 * normalization — strip a single trailing slash and lower-case the path, except for
 * the bare `/`, which has no non-slash form — so a future table entry cannot be
 * written in a form the lookup would never produce.
 */
function normalizeRoutePath(path: string): string {
  const lowered = path.toLowerCase();
  if (lowered.length > 1 && lowered.endsWith('/')) {
    return lowered.slice(0, -1);
  }
  return lowered;
}

function toRouteKey(req: Pick<Request, 'method' | 'path'>): string {
  return `${req.method.toUpperCase()} ${normalizeRoutePath(req.path)}`;
}

function routeTable(entries: ReadonlyArray<`${string} ${string}`>): ReadonlySet<string> {
  return new Set(entries.map((entry) => {
    const [method, path] = entry.split(' ', 2);
    return toRouteKey({ method, path });
  }));
}

const largeJsonBodyRoutes = routeTable([
  'POST /api/v1/admin/backup/validate',
  'POST /api/v1/admin/restore',
]);

const privacySensitiveJsonBodyRoutes = routeTable([
  'POST /api/v1/admin/support-package/incident',
  'POST /api/v1/admin/support-package/incident-capture',
  'DELETE /api/v1/admin/support-package/incident-capture',
  'POST /api/v1/hardware/jade/pin',
]);

export function usesRouteSpecificLargeJsonParser(req: Pick<Request, 'method' | 'path'>): boolean {
  return largeJsonBodyRoutes.has(toRouteKey(req));
}

export function usesRouteSpecificJsonParser(req: Pick<Request, 'method' | 'path'>): boolean {
  const route = toRouteKey(req);
  return largeJsonBodyRoutes.has(route) || privacySensitiveJsonBodyRoutes.has(route);
}

function bypassRouteSpecificJsonRoutes(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (usesRouteSpecificJsonParser(req)) {
      next();
      return;
    }

    parser(req, res, next);
  };
}

export function defaultJsonParser(): RequestHandler {
  return bypassRouteSpecificJsonRoutes(express.json({ limit: DEFAULT_BODY_LIMIT }));
}

export function defaultUrlencodedParser(): RequestHandler {
  return bypassRouteSpecificJsonRoutes(
    express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }),
  );
}

/** Small, JSON-only parser for selector-bearing support diagnostics. */
export function incidentDiagnosticsJsonParser(): RequestHandler {
  return express.json({ limit: INCIDENT_DIAGNOSTICS_BODY_LIMIT, strict: true });
}

/** Bounded envelope parser; the relay separately enforces 16 KiB on opaque data bytes. */
export function jadePinRelayJsonParser(): RequestHandler {
  return express.json({ limit: JADE_PIN_RELAY_ENVELOPE_LIMIT, strict: true });
}
