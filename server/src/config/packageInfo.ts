/**
 * Resolved once at module load: the running server's package.json version.
 *
 * The multi-path probe handles the divergent layouts between the production
 * Docker image (built `dist/` tree) and local dev (`tsx` against `src/`).
 * Consumers should import the constant; never call `readFileSync` in a
 * request path.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('PACKAGE_INFO');

function resolvePackageVersion(): string {
  try {
    const candidatePaths = [
      join(__dirname, '../../../../package.json'),
      join(__dirname, '../../../package.json'),
      join(__dirname, '../../package.json'),
    ];

    for (const pkgPath of candidatePaths) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
        if (pkg.version) {
          return pkg.version;
        }
      } catch (error) {
        log.debug('Package version path did not resolve', {
          path: pkgPath,
          error: String(error),
        });
      }
    }
  } catch (error) {
    log.debug('Unexpected error resolving package version', {
      error: String(error),
    });
  }

  log.warn('Could not read version from package.json');
  return '0.0.0';
}

export const PACKAGE_VERSION: string = resolvePackageVersion();
