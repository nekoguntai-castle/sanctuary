/**
 * Devices - Models Router
 *
 * Public device catalog endpoints (no auth required)
 */

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';
import { db as prisma } from '../../repositories/db';

const router = Router();

/**
 * GET /api/v1/devices/models
 * Get all available hardware device models (public endpoint)
 */
router.get('/models', asyncHandler(async (req, res) => {
  const { manufacturer, airGapped, connectivity } = req.query;

  const filters: Prisma.HardwareDeviceModelWhereInput = {};

  // Filter by manufacturer
  if (manufacturer) {
    filters.manufacturer = manufacturer as string;
  }

  // Filter by air-gapped capability
  if (airGapped !== undefined) {
    filters.airGapped = airGapped === 'true';
  }

  // Filter by connectivity type
  if (connectivity) {
    filters.connectivity = {
      has: connectivity as string,
    };
  }

  // Don't show discontinued by default
  if (!req.query.showDiscontinued) {
    filters.discontinued = false;
  }

  const models = await prisma.hardwareDeviceModel.findMany({
    where: filters,
    orderBy: [
      { manufacturer: 'asc' },
      { name: 'asc' },
    ],
  });

  res.json(models);
}));

/**
 * GET /api/v1/devices/models/:slug
 * Get a specific device model by slug (public endpoint)
 */
router.get('/models/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const model = await prisma.hardwareDeviceModel.findUnique({
    where: { slug },
  });

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
  const manufacturers = await prisma.hardwareDeviceModel.findMany({
    where: { discontinued: false },
    select: { manufacturer: true },
    distinct: ['manufacturer'],
    orderBy: { manufacturer: 'asc' },
  });

  res.json(manufacturers.map(m => m.manufacturer));
}));

export default router;
