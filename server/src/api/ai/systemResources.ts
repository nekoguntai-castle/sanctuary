/**
 * System Resources Check Routes
 *
 * GET /ai/system-resources - Check system resources before enabling AI
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as os from 'os';
import { execSync } from 'child_process';
import { createLogger } from '../../utils/logger';

const log = createLogger('AI-API');

// Minimum requirements for AI features
const MIN_RAM_MB = 4096; // 4GB RAM
const MIN_DISK_MB = 8192; // 8GB disk space

interface DiskInfo {
  total: number;
  available: number;
}

/**
 * Get disk space info for the root filesystem (or relevant mount)
 */
function getDiskInfo(): DiskInfo {
  try {
    // Try to get disk space using df command
    const output = execSync('df -m / 2>/dev/null || df -m . 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      // Parse df output: Filesystem, 1M-blocks, Used, Available, Use%, Mounted on
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        return {
          total: parseInt(parts[1], 10) || 0,
          available: parseInt(parts[3], 10) || 0,
        };
      }
    }
  } catch (error) {
    log.warn('Failed to get disk info', { error: String(error) });
  }

  return { total: 0, available: 0 };
}

/**
 * Check for NVIDIA GPU availability
 */
function getGpuInfo(): { available: boolean; name: string | null } {
  try {
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const gpuName = output.trim().split('\n')[0];
    if (gpuName) {
      return { available: true, name: gpuName };
    }
  } catch {
    // nvidia-smi not available or no GPU
  }

  return { available: false, name: null };
}

export function createSystemResourcesRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/ai/system-resources
   * Check system resources before enabling AI
   *
   * Returns RAM, disk space, and GPU availability with sufficiency indicators.
   * Used by the frontend to show a confirmation dialog before enabling AI.
   */
  router.get('/system-resources', authenticate, async (req: Request, res: Response) => {
    try {
      // Get RAM info
      const totalRamMB = Math.round(os.totalmem() / (1024 * 1024));
      const freeRamMB = Math.round(os.freemem() / (1024 * 1024));

      // Get disk info
      const diskInfo = getDiskInfo();

      // Get GPU info
      const gpuInfo = getGpuInfo();

      // Check sufficiency
      const ramSufficient = freeRamMB >= MIN_RAM_MB;
      const diskSufficient = diskInfo.available >= MIN_DISK_MB;

      res.json({
        ram: {
          total: totalRamMB,
          available: freeRamMB,
          required: MIN_RAM_MB,
          sufficient: ramSufficient,
        },
        disk: {
          total: diskInfo.total,
          available: diskInfo.available,
          required: MIN_DISK_MB,
          sufficient: diskSufficient,
        },
        gpu: gpuInfo,
        overall: {
          sufficient: ramSufficient && diskSufficient,
          warnings: [
            ...(!ramSufficient ? [`Low RAM: ${freeRamMB}MB available, ${MIN_RAM_MB}MB recommended`] : []),
            ...(!diskSufficient ? [`Low disk space: ${diskInfo.available}MB available, ${MIN_DISK_MB}MB recommended`] : []),
          ],
        },
      });
    } catch (error) {
      log.error('System resources check failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to check system resources',
      });
    }
  });

  return router;
}
