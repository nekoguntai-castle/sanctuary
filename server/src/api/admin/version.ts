/**
 * Admin Version Router
 *
 * Endpoint for version checking and update availability.
 * NOTE: This endpoint does not require authentication - version info is not sensitive.
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { asyncHandler } from '../../errors/errorHandler';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('ADMIN_VERSION:ROUTE');

// Read version from package.json at startup
let currentVersion = '0.0.0';
try {
  // In Docker: dist/app/src/api/ -> need ../../../../package.json
  // In dev: dist/src/api/ -> need ../../../package.json
  const paths = [
    join(__dirname, '../../../../../package.json'),  // Docker production (admin/ subdirectory)
    join(__dirname, '../../../../package.json'),     // Development (admin/ subdirectory)
    join(__dirname, '../../../package.json'),        // Fallback
  ];

  for (const pkgPath of paths) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) {
        currentVersion = pkg.version;
        break;
      }
    } catch (error) {
      log.debug('Package version path did not resolve', { path: pkgPath, error: String(error) });
      // Try next path
    }
  }

  if (currentVersion === '0.0.0') {
    log.warn('Could not read version from package.json');
  }
} catch {
  log.warn('Could not read version from package.json');
}

// Cache for GitHub release check (avoid rate limiting)
let releaseCache: {
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  body: string;
  checkedAt: number;
} | null = null;
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * GET /api/v1/admin/version
 * Get current version and check for updates
 * Does not require authentication - version info is not sensitive
 */
router.get('/', asyncHandler(async (_req, res) => {
  const now = Date.now();

  // Check if we need to fetch from GitHub
  if (!releaseCache || (now - releaseCache.checkedAt) > RELEASE_CACHE_TTL) {
    try {
      const response = await fetch(
        'https://api.github.com/repos/nekoguntai/sanctuary/releases/latest',
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Sanctuary-App',
          },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (response.ok) {
        const release = await response.json() as {
          tag_name?: string;
          html_url?: string;
          name?: string;
          published_at?: string;
          body?: string;
        };
        releaseCache = {
          latestVersion: release.tag_name?.replace(/^v/, '') || '0.0.0',
          releaseUrl: release.html_url || '',
          releaseName: release.name || '',
          publishedAt: release.published_at || '',
          body: release.body || '',
          checkedAt: now,
        };
      }
    } catch (fetchError) {
      log.warn('Failed to fetch latest release from GitHub', { error: String(fetchError) });
    }
  }

  // Compare versions
  const compareVersions = (a: string, b: string): number => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  };

  const latestVersion = releaseCache?.latestVersion || currentVersion;
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

  res.json({
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: releaseCache?.releaseUrl || `https://github.com/nekoguntai/sanctuary/releases`,
    releaseName: releaseCache?.releaseName || '',
    publishedAt: releaseCache?.publishedAt || '',
    releaseNotes: releaseCache?.body || '',
  });
}));

export default router;
