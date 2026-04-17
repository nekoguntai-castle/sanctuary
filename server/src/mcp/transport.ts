import { IncomingMessage, ServerResponse } from 'node:http';
import type { Request, Response } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import config from '../config';
import { rateLimitService } from '../services/rateLimiting';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../services/auditService';
import { metricsHandler } from '../middleware/metrics';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { authenticateMcpRequest } from './auth';
import { getMcpHealth } from './health';
import { createSanctuaryMcpServer } from './index';
import { mcpAuthFailuresTotal, mcpRateLimitHitsTotal, recordMcpRequest } from './metrics';
import { McpHttpError, toMcpAuthInfo, type McpRequestContext } from './types';

const log = createLogger('MCP:TRANSPORT');
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);

type McpExpressRequest = Request & IncomingMessage & {
  auth?: ReturnType<typeof toMcpAuthInfo>;
};

function sendJsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: null,
  });
}

function validateProtocolHeader(req: Request): void {
  const version = req.header('mcp-protocol-version');
  if (!version) {
    throw new McpHttpError(400, 'MCP-Protocol-Version header is required');
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
    throw new McpHttpError(400, `Unsupported MCP protocol version: ${version}`);
  }
}

function classifyMcpOperation(body: unknown): string {
  if (Array.isArray(body)) {
    return 'batch';
  }
  if (!body || typeof body !== 'object') {
    return 'unknown';
  }

  const message = body as { method?: unknown; params?: Record<string, unknown> };
  if (typeof message.method !== 'string') {
    return 'unknown';
  }

  if (message.method === 'tools/call' && typeof message.params?.name === 'string') {
    return `tool:${message.params.name}`;
  }
  if (message.method === 'resources/read' && typeof message.params?.uri === 'string') {
    try {
      return `resource:${new URL(message.params.uri).protocol}`;
    } catch {
      return 'resource:invalid';
    }
  }
  if (message.method === 'prompts/get' && typeof message.params?.name === 'string') {
    return `prompt:${message.params.name}`;
  }
  return message.method;
}

async function auditMcpOperation(
  req: Request,
  context: McpRequestContext | null,
  operation: string,
  success: boolean,
  errorMsg?: string
): Promise<void> {
  const { ipAddress, userAgent } = getClientInfo(req);
  await auditService.log({
    userId: context?.userId,
    username: context?.username ?? 'anonymous',
    action: success ? AuditAction.MCP_OPERATION : AuditAction.MCP_OPERATION_FAILED,
    category: AuditCategory.MCP,
    ipAddress,
    userAgent,
    success,
    errorMsg,
    details: {
      operation,
      keyId: context?.keyId,
      keyPrefix: context?.keyPrefix,
    },
  });
}

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const operation = classifyMcpOperation(req.body);
  const started = process.hrtime.bigint();
  let context: McpRequestContext | null = null;
  let status = 200;

  try {
    validateProtocolHeader(req);

    context = await authenticateMcpRequest(req);
    const rateLimit = await rateLimitService.consume('mcp:default', context.keyId);
    res.setHeader('X-RateLimit-Limit', rateLimit.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimit.resetAt / 1000).toString());

    if (!rateLimit.allowed) {
      status = 429;
      mcpRateLimitHitsTotal.inc();
      if (rateLimit.retryAfter) {
        res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      }
      await auditMcpOperation(req, context, operation, false, 'rate_limit_exceeded');
      sendJsonRpcError(res, status, -32029, 'Rate limit exceeded');
      return;
    }

    (req as McpExpressRequest).auth = toMcpAuthInfo(context);

    const server = createSanctuaryMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req as McpExpressRequest, res as unknown as ServerResponse, req.body);
      status = res.statusCode;
      await auditMcpOperation(req, context, operation, status < 400);
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    const message = getErrorMessage(error);
    log.warn('MCP request failed', { operation, error: message });

    if (error instanceof McpHttpError) {
      status = error.statusCode;
      if (status === 401) {
        mcpAuthFailuresTotal.inc({ reason: 'unauthorized' });
      }
      await auditMcpOperation(req, context, operation, false, message);
      /* v8 ignore next -- JSON-RPC error path normally owns the response */
      if (!res.headersSent) {
        sendJsonRpcError(res, status, error.code, message);
      }
      return;
    }

    status = 500;
    await auditMcpOperation(req, context, operation, false, message);
    if (!res.headersSent) {
      sendJsonRpcError(res, status, -32603, 'Internal server error');
    }
  } finally {
    const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000_000;
    recordMcpRequest(operation, status, elapsed);
  }
}

export function createMcpHttpApp() {
  const app = createMcpExpressApp({
    host: config.mcp.host,
    allowedHosts: config.mcp.allowedHosts,
  });

  app.set('trust proxy', 1);

  app.get('/health', async (_req, res) => {
    const health = await getMcpHealth();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  app.get('/metrics', metricsHandler);

  app.post('/mcp', (req, res) => {
    handleMcpPost(req, res).catch(error => {
      log.error('Unhandled MCP request error', { error: getErrorMessage(error) });
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error');
      }
    });
  });

  app.get('/mcp', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    sendJsonRpcError(res, 405, -32000, 'Method not allowed.');
  });

  app.delete('/mcp', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    sendJsonRpcError(res, 405, -32000, 'Method not allowed.');
  });

  return app;
}
