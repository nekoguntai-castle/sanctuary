/**
 * Distributed Tracing Implementation
 *
 * Provides a pluggable tracing system that can work with or without OpenTelemetry.
 * When OpenTelemetry packages are installed, it uses them. Otherwise, it falls back
 * to a no-op implementation that can still be used for logging and metrics.
 *
 * ## Setup
 *
 * To enable full OpenTelemetry support, install:
 * ```
 * npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { getTracer, startSpan, withSpan } from './tracing';
 *
 * // Manual span management
 * const span = startSpan('my-operation');
 * try {
 *   // do work
 *   span.setAttribute('result', 'success');
 * } finally {
 *   span.end();
 * }
 *
 * // Automatic span management
 * const result = await withSpan('my-operation', async (span) => {
 *   span.setAttribute('input', 'value');
 *   return await doWork();
 * });
 * ```
 */

import { createLogger } from '../logger';
import { requestContext } from '../requestContext';
import { PACKAGE_VERSION } from '../../config/packageInfo';
import type {
  Span,
  SpanAttributes,
  SpanContext,
  SpanOptions,
  SpanStatus,
  Tracer,
  TracerProvider,
  TracingConfig,
} from './types';

const log = createLogger('UTIL:TRACING');

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_CONFIG: TracingConfig = {
  enabled: process.env.OTEL_TRACING_ENABLED === 'true',
  serviceName: process.env.OTEL_SERVICE_NAME || 'sanctuary-api',
  serviceVersion: PACKAGE_VERSION,
  environment: process.env.NODE_ENV || 'development',
  exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  exporterProtocol: (process.env.OTEL_EXPORTER_OTLP_PROTOCOL as 'http' | 'grpc') || 'http',
  samplingRatio: parseFloat(process.env.OTEL_SAMPLING_RATIO || '1.0'),
  consoleExporter: process.env.OTEL_CONSOLE_EXPORTER === 'true',
};

let tracingConfig = DEFAULT_CONFIG;

/**
 * Configure tracing
 */
export function configureTracing(config: Partial<TracingConfig>): void {
  tracingConfig = { ...tracingConfig, ...config };
  log.info('Tracing configured', {
    enabled: tracingConfig.enabled,
    serviceName: tracingConfig.serviceName,
    environment: tracingConfig.environment,
  });
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a random trace ID (32 hex characters)
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random span ID (16 hex characters)
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// No-Op Implementation (fallback when OpenTelemetry is not installed)
// =============================================================================

/**
 * Simple span implementation that logs to the application logger
 */
class SimpleSpan implements Span {
  name: string;
  context: SpanContext;
  private attributes: SpanAttributes = {};
  private status: SpanStatus = 'unset';
  private statusMessage?: string;
  private startTime: number;
  private events: Array<{ name: string; timestamp: number; attributes?: SpanAttributes }> = [];
  private exception?: Error;

  constructor(name: string, options?: SpanOptions) {
    this.name = name;
    this.startTime = Date.now();
    this.context = {
      traceId: options?.parent?.traceId || generateTraceId(),
      spanId: generateSpanId(),
      traceFlags: 1,
    };

    if (options?.attributes) {
      this.attributes = { ...options.attributes };
    }
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setAttributes(attributes: SpanAttributes): void {
    Object.assign(this.attributes, attributes);
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.status = status;
    this.statusMessage = message;
  }

  recordException(error: Error): void {
    this.exception = error;
    this.status = 'error';
    this.statusMessage = error.message;
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
    });
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.events.push({ name, timestamp: Date.now(), attributes });
  }

  end(): void {
    const duration = Date.now() - this.startTime;

    // Log span completion for observability
    const logData = {
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      requestId: requestContext.getRequestId(),
      duration,
      status: this.status,
      ...this.attributes,
    };

    if (this.status === 'error' || this.exception) {
      log.debug(`Span ended: ${this.name}`, {
        ...logData,
        error: this.exception?.message,
        statusMessage: this.statusMessage,
      });
    } else {
      log.debug(`Span ended: ${this.name}`, logData);
    }
  }
}

/**
 * Simple tracer implementation using SimpleSpan
 */
class SimpleTracer implements Tracer {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  startSpan(name: string, options?: SpanOptions): Span {
    return new SimpleSpan(`${this.name}.${name}`, options);
  }

  startActiveSpan<T>(
    name: string,
    optionsOrFn: SpanOptions | ((span: Span) => T),
    fn?: (span: Span) => T
  ): T {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;

    const span = this.startSpan(name, options);
    try {
      const result = actualFn(span);
      if (result instanceof Promise) {
        return result.finally(() => span.end()) as T;
      }
      span.end();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.end();
      throw error;
    }
  }
}

/**
 * Simple tracer provider using SimpleTracer
 */
class SimpleTracerProvider implements TracerProvider {
  private tracers = new Map<string, Tracer>();

  getTracer(name: string, _version?: string): Tracer {
    let tracer = this.tracers.get(name);
    if (!tracer) {
      tracer = new SimpleTracer(name);
      this.tracers.set(name, tracer);
    }
    return tracer;
  }

  isEnabled(): boolean {
    return tracingConfig.enabled;
  }

  async shutdown(): Promise<void> {
    this.tracers.clear();
    log.info('Tracing shutdown complete');
  }
}

// =============================================================================
// Global Provider
// =============================================================================

let tracerProvider: TracerProvider = new SimpleTracerProvider();

/**
 * Set a custom tracer provider (for OpenTelemetry integration)
 */
export function setTracerProvider(provider: TracerProvider): void {
  tracerProvider = provider;
  log.info('Custom tracer provider set');
}

/**
 * Get the current tracer provider
 */
export function getTracerProvider(): TracerProvider {
  return tracerProvider;
}

/**
 * Get a tracer for a component
 */
export function getTracer(name: string, version?: string): Tracer {
  return tracerProvider.getTracer(name, version);
}

// =============================================================================
// Convenience Functions
// =============================================================================

const defaultTracer = getTracer('sanctuary');

/**
 * Start a new span
 */
export function startSpan(name: string, options?: SpanOptions): Span {
  return defaultTracer.startSpan(name, options);
}

/**
 * Execute a function within a span
 */
export function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>
): T | Promise<T> {
  const span = startSpan(name);

  try {
    const result = fn(span);

    if (result instanceof Promise) {
      return result
        .then(value => {
          span.setStatus('ok');
          span.end();
          return value;
        })
        .catch(error => {
          span.recordException(error);
          span.end();
          throw error;
        });
    }

    span.setStatus('ok');
    span.end();
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.end();
    throw error;
  }
}

/**
 * Create a traced version of an async function
 */
export function traced<T extends (...args: any[]) => Promise<any>>(
  name: string,
  fn: T
): T {
  return (async (...args: Parameters<T>) => {
    return withSpan(name, () => fn(...args));
  }) as T;
}

// =============================================================================
// HTTP Tracing Utilities
// =============================================================================

/**
 * Get trace context headers for outgoing requests
 */
export function getTraceHeaders(): Record<string, string> {
  const ctx = requestContext.get();
  if (!ctx) return {};

  return {
    'x-request-id': ctx.requestId,
    'x-trace-id': ctx.requestId, // Use request ID as trace ID for correlation
  };
}

/**
 * Parse trace context from incoming headers
 */
export function parseTraceContext(headers: Record<string, string | string[] | undefined>): SpanContext | undefined {
  const traceId = headers['x-trace-id'] || headers['traceparent'];
  if (!traceId) return undefined;

  // Simple parsing - for W3C Trace Context format
  if (typeof traceId === 'string' && traceId.includes('-')) {
    const parts = traceId.split('-');
    if (parts.length >= 4) {
      return {
        traceId: parts[1],
        spanId: parts[2],
        traceFlags: parseInt(parts[3], 16),
      };
    }
  }

  return {
    traceId: typeof traceId === 'string' ? traceId : traceId[0],
    spanId: generateSpanId(),
    traceFlags: 1,
  };
}
