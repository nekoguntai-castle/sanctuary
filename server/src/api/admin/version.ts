/**
 * Admin Version Router
 *
 * Endpoint for version checking and update availability.
 * NOTE: This endpoint does not require authentication - version info is not sensitive.
 */

import { Router } from 'express';
import { asyncHandler } from '../../errors/errorHandler';
import { PACKAGE_VERSION } from '../../config/packageInfo';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('ADMIN_VERSION:ROUTE');

const currentVersion = PACKAGE_VERSION;

// Codeberg (Forgejo API) is the source of truth for official releases.
// /releases/latest filters out drafts and prereleases automatically, so RC
// tags marked prerelease=true at creation time are correctly excluded.
const RELEASE_API_URL =
  'https://codeberg.org/api/v1/repos/nekoguntai-castle/sanctuary/releases/latest';
const RELEASES_PAGE_URL =
  'https://codeberg.org/nekoguntai-castle/sanctuary/releases';

let releaseCache: {
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  body: string;
  prerelease: boolean;
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

  // Check if we need to refresh the cache
  if (!releaseCache || (now - releaseCache.checkedAt) > RELEASE_CACHE_TTL) {
    try {
      const response = await fetch(RELEASE_API_URL, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Sanctuary-App',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const release = await response.json() as {
          tag_name?: string;
          html_url?: string;
          name?: string;
          published_at?: string;
          body?: string;
          prerelease?: boolean;
        };
        releaseCache = {
          latestVersion: release.tag_name?.replace(/^v/, '') || '0.0.0',
          releaseUrl: release.html_url || '',
          releaseName: release.name || '',
          publishedAt: release.published_at || '',
          body: release.body || '',
          prerelease: release.prerelease === true,
          checkedAt: now,
        };
      }
    } catch (fetchError) {
      log.warn('Failed to fetch latest release from Codeberg', { error: String(fetchError) });
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
    releaseUrl: releaseCache?.releaseUrl || RELEASES_PAGE_URL,
    releaseName: releaseCache?.releaseName || '',
    publishedAt: releaseCache?.publishedAt || '',
    releaseNotes: releaseCache?.body || '',
    prerelease: releaseCache?.prerelease ?? false,
  });
}));

export default router;
