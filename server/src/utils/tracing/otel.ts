/**
 * OpenTelemetry SDK Initialization
 *
 * Initializes the OpenTelemetry SDK when OTEL_TRACING_ENABLED=true.
 * This file should be imported at the very start of the application,
 * before any other imports, to ensure all auto-instrumentation works.
 *
 * When enabled, this replaces the SimpleTracerProvider with the real
 * OpenTelemetry SDK, sending traces to the configured OTLP endpoint.
 */

import { createLogger } from '../logger';
import { getErrorMessage } from '../errors';

const log = createLogger('UTIL:OTEL');

// Check if tracing is enabled before importing heavy OTEL packages
const isTracingEnabled = process.env.OTEL_TRACING_ENABLED === 'true';

export async function initializeOpenTelemetry(): Promise<void> {
  if (!isTracingEnabled) {
    log.debug('OpenTelemetry tracing disabled (OTEL_TRACING_ENABLED != true)');
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    log.warn('OTEL_TRACING_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT not set');
    return;
  }

  try {
    // Dynamic imports to avoid loading OTEL packages when disabled
    // Use require() to avoid TypeScript type issues with dynamic imports
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const serviceName = process.env.OTEL_SERVICE_NAME || 'sanctuary-api';
    const serviceVersion = process.env.npm_package_version || '1.0.0';
    const environment = process.env.NODE_ENV || 'development';

    // Configure the OTLP exporter
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    });

    // Create the SDK with auto-instrumentation
    const sdk = new NodeSDK({
      resource: new Resource({
        'service.name': serviceName,
        'service.version': serviceVersion,
        'deployment.environment': environment,
      }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable some noisy instrumentations
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          // Configure HTTP instrumentation
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (request: { url?: string }) => {
              const url = request.url || '';
              return url === '/health' || url === '/metrics' || url === '/favicon.ico';
            },
          },
          // Enable Express instrumentation
          '@opentelemetry/instrumentation-express': { enabled: true },
          // Enable PostgreSQL instrumentation
          '@opentelemetry/instrumentation-pg': { enabled: true },
          // Enable Redis instrumentation
          '@opentelemetry/instrumentation-ioredis': { enabled: true },
        }),
      ],
    });

    // Start the SDK
    sdk.start();

    log.info('OpenTelemetry tracing initialized', {
      serviceName,
      endpoint,
      environment,
    });

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await sdk.shutdown();
        log.info('OpenTelemetry SDK shut down successfully');
      } catch (error) {
        log.error('Error shutting down OpenTelemetry SDK', { error: getErrorMessage(error) });
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    log.error('Failed to initialize OpenTelemetry', { error: getErrorMessage(error) });
    // Don't throw - allow the application to continue without tracing
  }
}
