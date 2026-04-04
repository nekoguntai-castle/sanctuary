/**
 * Support Package Runner
 *
 * Orchestrates the generation of a support package by running all registered
 * collectors in parallel, catching per-collector failures, and assembling output.
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { generateSalt, createAnonymizer } from './anonymizer';
import { getCollectors } from './collectors';
import type { SupportPackage, CollectorContext, GenerateOptions } from './types';

const log = createLogger('SUPPORT_PKG:SVC');

/**
 * Generate a complete support package
 */
export async function generateSupportPackage(options: GenerateOptions = {}): Promise<SupportPackage> {
  const startTime = Date.now();
  const generatedAt = new Date();

  // Create per-package anonymization context
  const salt = generateSalt();
  const anonymize = createAnonymizer(salt);
  const context: CollectorContext = { anonymize, generatedAt };

  // Get collectors to run
  const allCollectors = getCollectors();
  const collectorsToRun = options.only
    ? new Map([...allCollectors].filter(([name]) => options.only!.includes(name)))
    : allCollectors;

  log.info('Generating support package', {
    collectors: [...collectorsToRun.keys()],
  });

  // Run all collectors in parallel with per-collector timeout
  const COLLECTOR_TIMEOUT_MS = 15_000;
  const entries = [...collectorsToRun.entries()];
  const results = await Promise.allSettled(
    entries.map(async ([name, collector]) => {
      const collectorStart = Date.now();
      try {
        const data = await Promise.race([
          collector(context),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Collector '${name}' timed out after ${COLLECTOR_TIMEOUT_MS}ms`)), COLLECTOR_TIMEOUT_MS)
          ),
        ]);
        return { name, data, durationMs: Date.now() - collectorStart };
      } catch (error) {
        log.warn(`Collector '${name}' failed`, { error: getErrorMessage(error) });
        return {
          name,
          data: null,
          durationMs: Date.now() - collectorStart,
          error: getErrorMessage(error),
        };
      }
    })
  );

  // Assemble output
  const collectors: SupportPackage['collectors'] = {};
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const result of results) {
    // Promise.allSettled with our try/catch means these are always fulfilled
    if (result.status === 'fulfilled') {
      const { name, data, error } = result.value;
      if (error || !data) {
        collectors[name] = { error: error || 'Unknown error' };
        failed.push(name);
      } else {
        collectors[name] = data;
        succeeded.push(name);
      }
    }
  }

  // Get server version
  let serverVersion = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    serverVersion = require('../../../package.json').version;
  } catch {
    log.debug('Could not read server version from package.json');
  }

  const pkg: SupportPackage = {
    version: '1.0.0',
    generatedAt: generatedAt.toISOString(),
    serverVersion,
    collectors,
    meta: {
      totalDurationMs: Date.now() - startTime,
      succeeded,
      failed,
    },
  };

  log.info('Support package generated', {
    totalMs: pkg.meta.totalDurationMs,
    succeeded: succeeded.length,
    failed: failed.length,
  });

  return pkg;
}
