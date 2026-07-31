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

// GitHub Releases is the public source of truth for official releases.
// /releases/latest excludes drafts and prereleases, so release candidates are
// not presented as stable updates.
const RELEASE_API_URL =
  'https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest';
const RELEASES_PAGE_URL =
  'https://github.com/nekoguntai-castle/sanctuary/releases';

interface ReleaseCache {
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  body: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
  body?: unknown;
  prerelease?: unknown;
}

let releaseCache: ReleaseCache | null = null;
let lastReleaseCheckAt = 0;
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
// Defense in depth: never offer RC/nonstandard tags even if the upstream
// "latest" endpoint returns an unexpected payload.
const STABLE_RELEASE_TAG = /^v?\d+\.\d+\.\d+$/;

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseRelease(payload: unknown): ReleaseCache | null {
  if (!payload || typeof payload !== 'object') return null;

  const release = payload as GitHubRelease;
  if (
    typeof release.tag_name !== 'string'
    || !STABLE_RELEASE_TAG.test(release.tag_name)
    || release.prerelease === true
  ) {
    return null;
  }

  return {
    latestVersion: release.tag_name.replace(/^v/, ''),
    releaseUrl: optionalString(release.html_url),
    releaseName: optionalString(release.name),
    publishedAt: optionalString(release.published_at),
    body: optionalString(release.body),
  };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * GET /api/v1/admin/version
 * Get current version and check for updates
 * Does not require authentication - version info is not sensitive
 */
router.get('/', asyncHandler(async (_req, res) => {
  const now = Date.now();

  // Cache failed checks as well as successful ones so anonymous GitHub API
  // failures cannot trigger one upstream request per UI poll. A failed refresh
  // intentionally keeps serving the last valid release metadata until retry.
  if (lastReleaseCheckAt === 0 || (now - lastReleaseCheckAt) > RELEASE_CACHE_TTL) {
    lastReleaseCheckAt = now;
    try {
      const response = await fetch(RELEASE_API_URL, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Sanctuary-App',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`GitHub release API returned HTTP ${response.status}`);
      }

      const release = parseRelease(await response.json());
      if (!release) throw new Error('GitHub release API returned malformed payload');
      releaseCache = release;
    } catch (fetchError) {
      log.warn('Failed to fetch latest release from GitHub', { error: String(fetchError) });
    }
  }

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
    prerelease: false,
  });
}));

export default router;
