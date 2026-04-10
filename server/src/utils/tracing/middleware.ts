/**
 * HTTP Tracing Middleware
 *
 * Express middleware for automatic HTTP request tracing.
 * Creates spans for incoming requests with semantic conventions.
 *
 * ## Usage
 *
 * ```typescript
 * import { tracingMiddleware } from './tracing';
 *
 * app.use(tracingMiddleware());
 * ```
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { startSpan, parseTraceContext, getTracerProvider } from './tracer';
import type { Span, HttpSpanAttributes } from './types';
import { requestContext } from '../requestContext';

declare global {
  namespace Express {
    interface Request {
      __span?: Span;
    }
  }
}

/**
 * Options for tracing middleware
 */
export interface TracingMiddlewareOptions {
  /** Routes to ignore (regex patterns) */
  ignorePaths?: RegExp[];

  /** Custom attribute extractor */
  extractAttributes?: (req: Request) => Record<string, string | number | boolean>;

  /** Whether to include request headers as attributes */
  includeHeaders?: boolean;

  /** Headers to exclude from tracing */
  excludeHeaders?: string[];
}

/**
 * Default paths to ignore
 */
const DEFAULT_IGNORE_PATHS = [
  /^\/health$/,
  /^\/metrics$/,
  /^\/favicon\.ico$/,
];

/**
 * Sensitive headers to exclude
 */
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
];

/**
 * Create HTTP tracing middleware
 */
export function tracingMiddleware(options: TracingMiddlewareOptions = {}): RequestHandler {
  const ignorePaths = options.ignorePaths || DEFAULT_IGNORE_PATHS;
  const excludeHeaders = new Set([
    ...SENSITIVE_HEADERS,
    ...(options.excludeHeaders || []).map(h => h.toLowerCase()),
  ]);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip tracing if disabled
    if (!getTracerProvider().isEnabled()) {
      return next();
    }

    // Skip ignored paths
    if (ignorePaths.some(pattern => pattern.test(req.path))) {
      return next();
    }

    // Parse incoming trace context
    const parentContext = parseTraceContext(req.headers as Record<string, string>);

    // Create span attributes
    const attributes: HttpSpanAttributes = {
      'http.method': req.method,
      'http.url': req.originalUrl,
      'http.target': req.path,
      'http.host': req.hostname,
      'http.scheme': req.protocol,
      'http.user_agent': req.get('user-agent'),
      'http.route': req.route?.path,
    };

    // Add content length if available
    const contentLength = req.get('content-length');
    if (contentLength) {
      attributes['http.request_content_length'] = parseInt(contentLength, 10);
    }

    // Add custom attributes
    if (options.extractAttributes) {
      Object.assign(attributes, options.extractAttributes(req));
    }

    // Add safe headers if requested
    if (options.includeHeaders) {
      for (const [key, value] of Object.entries(req.headers)) {
        if (!excludeHeaders.has(key.toLowerCase()) && typeof value === 'string') {
          attributes[`http.request.header.${key}`] = value;
        }
      }
    }

    // Start the span
    const spanName = `${req.method} ${req.route?.path || req.path}`;
    const span = startSpan(spanName, {
      kind: 'server',
      attributes,
      parent: parentContext,
    });

    // Store span on request for access in handlers
    req.__span = span;

    // Set traceId in request context for log correlation
    if (span.context?.traceId) {
      requestContext.setTraceId(span.context.traceId);
    }

    // Capture response
    const originalEnd = res.end.bind(res);
    res.end = function(this: Response, ...args: unknown[]): Response {
      finishSpan(span, res);
      return originalEnd(...(args as Parameters<typeof originalEnd>));
    };

    // Handle errors
    res.on('error', (error: Error) => {
      span.recordException(error);
    });

    next();
  };
}

/**
 * Finish the HTTP span with response data
 */
function finishSpan(span: Span, res: Response): void {
  span.setAttribute('http.status_code', res.statusCode);

  const contentLength = res.get('content-length');
  if (contentLength) {
    span.setAttribute('http.response_content_length', parseInt(contentLength, 10));
  }

  // Set status based on HTTP status code
  if (res.statusCode >= 400 && res.statusCode < 500) {
    span.setStatus('error', `HTTP ${res.statusCode}`);
  } else if (res.statusCode >= 500) {
    span.setStatus('error', `HTTP ${res.statusCode}`);
  } else {
    span.setStatus('ok');
  }

  // Add user context if available
  const ctx = requestContext.get();
  if (ctx?.userId) {
    span.setAttribute('user.id', ctx.userId);
  }

  span.end();
}

/**
 * Get the current request span (for adding custom attributes)
 */
export function getCurrentSpan(req: Request): Span | undefined {
  return req.__span;
}

/**
 * Add attribute to current request span
 */
export function addSpanAttribute(req: Request, key: string, value: string | number | boolean): void {
  const span = getCurrentSpan(req);
  if (span) {
    span.setAttribute(key, value);
  }
}

/**
 * Add event to current request span
 */
export function addSpanEvent(req: Request, name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = getCurrentSpan(req);
  if (span) {
    span.addEvent(name, attributes);
  }
}
