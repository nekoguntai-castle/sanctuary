/**
 * AI API Routes
 *
 * Endpoints for AI-powered features (transaction labeling, natural language queries).
 * All routes require authentication. AI must be enabled in admin settings.
 *
 * SECURITY: Backend forwards requests to isolated AI container.
 * The backend NEVER makes external AI calls directly.
 *
 * Rate limited to prevent abuse of AI endpoints.
 */

import { Router } from 'express';
import { rateLimitByUser } from '../../middleware/rateLimit';
import { createStatusRouter } from './status';
import { createFeaturesRouter } from './features';
import { createModelsRouter } from './models';
import { createContainerRouter } from './container';
import { createSystemResourcesRouter } from './systemResources';

const router = Router();

// Rate limiting: prevent abuse of AI endpoints
const aiRateLimiter = rateLimitByUser('ai:analyze');

// Mount sub-routers
router.use(createStatusRouter(aiRateLimiter));
router.use(createFeaturesRouter(aiRateLimiter));
router.use(createModelsRouter(aiRateLimiter));
router.use(createContainerRouter());
router.use(createSystemResourcesRouter());

export default router;
