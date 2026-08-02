/**
 * Fail-closed orchestration for the explicitly shareable support profile.
 * Collector output is never returned until schema, size, envelope, and final
 * byte-level privacy checks have all succeeded.
 */
import { createLogger } from '../../utils/logger';
import { withTimeout } from '../../utils/async';
import { PACKAGE_VERSION } from '../../config/packageInfo';
import { generateSalt, createAnonymizer } from './anonymizer';
import { getShareableCollectors } from './collectors';
import {
  buildSupportPackageSchema,
  MAX_COLLECTOR_BYTES,
  serializeShareablePackage,
  SupportPackagePrivacyError,
} from './privacy';
import type {
  CollectorContext,
  CollectorSection,
  GenerateOptions,
  SupportPackage,
  SupportPackageFailureCode,
} from './types';
import type { ShareableCollectorDefinition } from './collectors/registry';

const log = createLogger('SUPPORT_PKG:SVC');
const DEFAULT_COLLECTOR_TIMEOUT_MS = 15_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;
let generationFenced = false;
let generationActive = false;

function provenance(definition: ShareableCollectorDefinition, generatedAt: Date) {
  const sampledAt = generatedAt.toISOString();
  return {
    collectorProcess: 'api' as const,
    sourceProcess: definition.sourceProcess,
    sourceKind: definition.sourceKind,
    sampledAt,
    dataAsOf: sampledAt,
    observationWindow: 'point_in_time' as const,
    authoritativeFor: definition.authoritativeFor,
    notAuthoritativeFor: definition.notAuthoritativeFor,
  };
}

function failureSection(
  code: SupportPackageFailureCode,
  definition: ShareableCollectorDefinition,
  generatedAt: Date,
  startedAt: number
): CollectorSection {
  return {
    status: 'error',
    durationMs: Date.now() - startedAt,
    truncated: false,
    droppedCount: 0,
    provenance: provenance(definition, generatedAt),
    error: code,
  };
}

/**
 * Confirm only that source work settled. A rejection still proves quiescence,
 * unlike cleanup where rejection means disposal was not established.
 */
async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  try {
    await withTimeout(
      promise.then(() => undefined, () => undefined),
      timeoutMs,
      'collector_quiescence_timeout'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirm that cleanup fulfilled successfully; rejection means the collector
 * cannot prove that it released its owned resources.
 */
async function completesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  try {
    await withTimeout(promise, timeoutMs, 'collector_cleanup_timeout');
    return true;
  } catch {
    return false;
  }
}

async function quiesceTimedOutCollector(
  definition: ShareableCollectorDefinition,
  source: Promise<unknown>,
  signal: AbortSignal,
  cleanupTimeoutMs: number
): Promise<boolean> {
  // Cancellation is not considered complete until both collector cleanup and
  // the source promise settle; this prevents late work from entering a later run.
  const cleanup = Promise.resolve().then(() => definition.cleanup?.(signal));
  const [cleanupCompleted, sourceSettled] = await Promise.all([
    completesWithin(cleanup, cleanupTimeoutMs),
    settlesWithin(source, cleanupTimeoutMs),
  ]);
  return cleanupCompleted && sourceSettled;
}

function validateCollectorData(definition: ShareableCollectorDefinition, raw: unknown): unknown {
  try {
    const data = definition.schema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_COLLECTOR_BYTES) {
      throw new Error('collector_size_exceeded');
    }
    return data;
  } catch {
    // Collapse schema, getter, circular-value, and size failures to one public
    // code so rejected data and validation details cannot leak across the boundary.
    throw new SupportPackagePrivacyError('collector_privacy_contract_failed');
  }
}

async function collectSection(
  name: string,
  definition: ShareableCollectorDefinition,
  baseContext: Omit<CollectorContext, 'signal' | 'deadlineMs'>,
  timeoutMs: number,
  cleanupTimeoutMs: number
): Promise<CollectorSection> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const deadlineMs = startedAt + timeoutMs;
  let timer!: NodeJS.Timeout;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('collector_timeout'));
      }, timeoutMs);
    });
    const source = definition.collect({ ...baseContext, signal: controller.signal, deadlineMs });
    let raw: unknown;
    try {
      raw = await Promise.race([source, timeout]);
    } catch {
      if (controller.signal.aborted) {
        const quiesced = await quiesceTimedOutCollector(
          definition,
          source,
          controller.signal,
          cleanupTimeoutMs
        );
        if (!quiesced) {
          // This latch intentionally has no in-process reset. Once ownership of
          // timed-out work is uncertain, only a process restart restores the
          // isolation guarantee and permits another package generation.
          generationFenced = true;
          throw new SupportPackagePrivacyError('collector_quiescence_failed');
        }
        log.warn('Support package collector failed', { collector: name, code: 'timeout' });
        return failureSection('timeout', definition, baseContext.generatedAt, startedAt);
      }
      log.warn('Support package collector failed', { collector: name, code: 'internal_error' });
      return failureSection('internal_error', definition, baseContext.generatedAt, startedAt);
    }
    const data = validateCollectorData(definition, raw);
    return {
      status: 'ok',
      durationMs: Date.now() - startedAt,
      truncated: false,
      droppedCount: 0,
      provenance: provenance(definition, baseContext.generatedAt),
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function assemblePackage(options: GenerateOptions): Promise<{
  package: SupportPackage;
  bytes: Buffer;
}> {
  const startedAt = Date.now();
  const generatedAt = new Date();
  const definitions = getShareableCollectors();
  const selected = options.only
    ? new Map([...definitions].filter(([name]) => options.only!.includes(name)))
    : definitions;
  const baseContext = {
    generatedAt,
    anonymize: createAnonymizer(generateSalt()),
  };
  const settledResults = await Promise.allSettled([...selected].map(async ([name, definition]) => [
    name,
    await collectSection(
      name,
      definition,
      baseContext,
      options.collectorTimeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS,
      options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS
    ),
  ] as const));
  if (settledResults.some((result) => result.status === 'rejected')) {
    throw new SupportPackagePrivacyError('support_package_collector_contract_failed');
  }
  const results = settledResults.map((result) =>
    (result as PromiseFulfilledResult<readonly [string, CollectorSection]>).value
  );
  const collectors = Object.fromEntries(results);
  const succeeded = results.filter(([, result]) => result.status === 'ok').map(([name]) => name);
  const failed = results.filter(([, result]) => result.status === 'error').map(([name]) => name);
  const candidate: SupportPackage = {
    version: '2.0.0',
    profile: 'shareable_aggregate',
    generatedAt: generatedAt.toISOString(),
    serverVersion: PACKAGE_VERSION,
    collectors,
    meta: { totalDurationMs: Date.now() - startedAt, succeeded, failed },
  };
  const schemas = Object.fromEntries([...selected].map(([name, definition]) => [name, definition.schema]));
  let validated: SupportPackage;
  try {
    validated = buildSupportPackageSchema(schemas).parse(candidate) as SupportPackage;
  } catch {
    // Never expose schema paths or rejected values in a package-level error.
    throw new SupportPackagePrivacyError('support_package_envelope_contract_failed');
  }
  const bytes = serializeShareablePackage(validated);
  log.info('Support package generated', {
    collectorCount: results.length,
    succeeded: succeeded.length,
    failed: failed.length,
  });
  return { package: validated, bytes };
}

async function buildPackage(options: GenerateOptions): Promise<{
  package: SupportPackage;
  bytes: Buffer;
}> {
  if (generationFenced) {
    throw new SupportPackagePrivacyError('support_package_generation_fenced');
  }
  if (generationActive) {
    throw new SupportPackagePrivacyError('support_package_generation_in_progress');
  }
  // A single active generation prevents resource ownership from overlapping.
  generationActive = true;
  try {
    return await assemblePackage(options);
  } finally {
    generationActive = false;
  }
}

/** Generate the validated object form for internal callers. */
export async function generateSupportPackage(options: GenerateOptions = {}): Promise<SupportPackage> {
  return (await buildPackage(options)).package;
}

/** Generate the canonical bytes used by a future download response. */
export async function generateSerializedSupportPackage(options: GenerateOptions = {}): Promise<Buffer> {
  return (await buildPackage(options)).bytes;
}
