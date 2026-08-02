import express, { ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  defaultJsonParser,
  defaultUrlencodedParser,
  incidentDiagnosticsJsonParser,
  usesRouteSpecificLargeJsonParser,
  usesRouteSpecificJsonParser,
} from '../../../src/middleware/bodyParsing';

function createTestApp() {
  const app = express();

  app.use(defaultJsonParser());
  app.use(defaultUrlencodedParser());

  app.post('/api/v1/admin/backup/validate', express.json({ limit: '200mb' }), (req, res) => {
    res.json({ size: req.body.backup.length });
  });

  app.post('/api/v1/ordinary', (req, res) => {
    res.json({ size: req.body.payload.length });
  });

  app.post(
    '/api/v1/admin/support-package/incident',
    incidentDiagnosticsJsonParser(),
    (req, res) => res.json({ size: req.body.txid.length }),
  );

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message });
  };
  app.use(errorHandler);

  return app;
}

describe('body parsing middleware', () => {
  it('identifies routes with a route-specific large JSON parser', () => {
    expect(usesRouteSpecificLargeJsonParser({
      method: 'POST',
      path: '/api/v1/admin/backup/validate',
    })).toBe(true);
    expect(usesRouteSpecificLargeJsonParser({
      method: 'POST',
      path: '/api/v1/admin/restore',
    })).toBe(true);
    expect(usesRouteSpecificLargeJsonParser({
      method: 'POST',
      path: '/api/v1/ordinary',
    })).toBe(false);
  });

  it('routes selector-bearing diagnostics only through their bounded JSON parser', () => {
    expect(usesRouteSpecificJsonParser({
      method: 'POST',
      path: '/api/v1/admin/support-package/incident',
    })).toBe(true);
    expect(usesRouteSpecificJsonParser({
      method: 'POST',
      path: '/api/v1/admin/support-package/incident-capture',
    })).toBe(true);
    expect(usesRouteSpecificJsonParser({
      method: 'DELETE',
      path: '/api/v1/admin/support-package/incident-capture',
    })).toBe(true);
    expect(usesRouteSpecificLargeJsonParser({
      method: 'POST',
      path: '/api/v1/admin/support-package/incident',
    })).toBe(false);
  });

  it('rejects selector-bearing diagnostics above the 4KB route limit', async () => {
    await request(createTestApp())
      .post('/api/v1/admin/support-package/incident')
      .send({ txid: 'x'.repeat(4 * 1024 + 1) })
      .expect(413);
  });

  it('lets backup validation payloads above the default 10MB limit reach the route parser', async () => {
    const app = createTestApp();
    const backup = 'x'.repeat(10 * 1024 * 1024 + 1);

    const response = await request(app)
      .post('/api/v1/admin/backup/validate')
      .send({ backup })
      .expect(200);

    expect(response.body.size).toBe(backup.length);
  });

  it('keeps the default 10MB limit for ordinary routes', async () => {
    const app = createTestApp();
    const payload = 'x'.repeat(10 * 1024 * 1024 + 1);

    await request(app)
      .post('/api/v1/ordinary')
      .send({ payload })
      .expect(413);
  });
});
