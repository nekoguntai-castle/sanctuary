import express, { Request, RequestHandler } from 'express';

const DEFAULT_BODY_LIMIT = '10mb';
const INCIDENT_DIAGNOSTICS_BODY_LIMIT = '4kb';

const largeJsonBodyRoutes = new Set([
  'POST /api/v1/admin/backup/validate',
  'POST /api/v1/admin/restore',
]);

const privacySensitiveJsonBodyRoutes = new Set([
  'POST /api/v1/admin/support-package/incident',
  'POST /api/v1/admin/support-package/incident-capture',
  'DELETE /api/v1/admin/support-package/incident-capture',
]);

export function usesRouteSpecificLargeJsonParser(req: Pick<Request, 'method' | 'path'>): boolean {
  return largeJsonBodyRoutes.has(`${req.method.toUpperCase()} ${req.path}`);
}

export function usesRouteSpecificJsonParser(req: Pick<Request, 'method' | 'path'>): boolean {
  const route = `${req.method.toUpperCase()} ${req.path}`;
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
