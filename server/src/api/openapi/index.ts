/**
 * OpenAPI/Swagger Documentation
 *
 * Serves OpenAPI 3.0 specification and Swagger UI for API documentation.
 *
 * ## Endpoints
 *
 * - GET /api/v1/docs - Swagger UI
 * - GET /api/v1/docs/openapi.json - Raw OpenAPI spec
 *
 * ## Usage
 *
 * ```typescript
 * import { setupOpenAPI } from './api/openapi';
 * setupOpenAPI(app);
 * ```
 */

import { Router, Request, Response } from 'express';
import { openApiSpec } from './spec';
import { swaggerUIHtml } from './swaggerUI';

const router = Router();

/**
 * GET /api/v1/docs
 * Swagger UI
 */
router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerUIHtml);
});

/**
 * GET /api/v1/docs/openapi.json
 * Raw OpenAPI specification
 */
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

export default router;
export { openApiSpec };
