import { vi } from 'vitest';
/**
 * Shared mock setup for Auth API Route tests.
 *
 * This file is imported by auth.routes.registration.test.ts and auth.routes.2fa.test.ts
 * to avoid duplicating the mock declarations (vi.mock calls must be at the top level
 * of each test file, but the factory functions can be shared via re-exports).
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import express from 'express';
import cookieParser from 'cookie-parser';
import { doubleCsrfProtection } from '../../../src/middleware/csrf';
import { errorHandler } from '../../../src/errors/errorHandler';

// Re-export so consuming test files don't need to import from mocks/prisma directly
export { mockPrismaClient, resetPrismaMocks };

// ----- Mock factory values (shared across route test files) -----

export const mockIsVerificationRequired = vi.fn().mockResolvedValue(true);
export const mockIsSmtpConfigured = vi.fn().mockResolvedValue(false);
export const mockCreateVerificationToken = vi.fn().mockResolvedValue({ success: false });

export async function createCsrfTokenForAccessCookie(accessToken: string): Promise<string> {
  const { generateCsrfToken } = await import('../../../src/middleware/csrf');
  const req = { cookies: { sanctuary_access: accessToken } } as any;
  const res = { cookie: vi.fn() } as any;
  return generateCsrfToken(req, res);
}

// ----- createAuthTestApp -----

export const createAuthTestApp = async () => {
  const app = express();
  app.use(express.json());
  // cookie-parser mirrors the production wiring in server/src/index.ts so
  // Phase 2 cookie-source tests can exercise req.cookies without rolling a
  // separate parsing path in each test.
  app.use(cookieParser());
  app.use(doubleCsrfProtection);

  // Import router dynamically after mocks
  const authModule = await import('../../../src/api/auth');
  app.use('/api/v1/auth', authModule.default);
  app.use(errorHandler);

  return app;
};
