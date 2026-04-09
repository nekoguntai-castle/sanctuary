/**
 * Devices - Models Router
 *
 * Public device catalog endpoints (no auth required)
 */

import { Router } from 'express';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';
import { deviceRepository } from '../../repositories';

const router = Router();

/**
 * GET /api/v1/devices/models
 * Get all available hardware device models (public endpoint)
 */
router.get('/models', asyncHandler(async (req, res) => {
  const { manufacturer, airGapped, connectivity } = req.query;

  const models = await deviceRepository.findHardwareModels({
    manufacturer: manufacturer as string | undefined,
    airGapped: airGapped !== undefined ? airGapped === 'true' : undefined,
    connectivity: connectivity as string | undefined,
    discontinued: !req.query.showDiscontinued ? false : undefined,
  });

  res.json(models);
}));

/**
 * GET /api/v1/devices/models/:slug
 * Get a specific device model by slug (public endpoint)
 */
router.get('/models/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const model = await deviceRepository.findHardwareModel(slug);

  if (!model) {
    throw new NotFoundError('Device model not found');
  }

  res.json(model);
}));

/**
 * GET /api/v1/devices/models/manufacturers
 * Get list of all manufacturers (public endpoint)
 */
router.get('/manufacturers', asyncHandler(async (_req, res) => {
  const manufacturers = await deviceRepository.findManufacturers();

  res.json(manufacturers);
}));

export default router;
