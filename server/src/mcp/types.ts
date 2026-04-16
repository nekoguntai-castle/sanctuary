import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import config from '../config';

export interface McpApiKeyScope {
  walletIds?: string[];
  allowAuditLogs?: boolean;
}

export interface McpRequestContext {
  keyId: string;
  keyPrefix: string;
  userId: string;
  username: string;
  isAdmin: boolean;
  scope: McpApiKeyScope;
}

export interface McpAuthExtra {
  mcp: McpRequestContext;
}

export type McpAuthInfo = AuthInfo & {
  extra: McpAuthExtra;
};

export type McpHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export class McpHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = -32000
  ) {
    super(message);
    this.name = 'McpHttpError';
  }
}

export class McpUnauthorizedError extends McpHttpError {
  constructor(message = 'Unauthorized') {
    super(401, message, -32001);
    this.name = 'McpUnauthorizedError';
  }
}

export class McpForbiddenError extends McpHttpError {
  constructor(message = 'Forbidden') {
    super(403, message, -32003);
    this.name = 'McpForbiddenError';
  }
}

export function getMcpContext(extra: McpHandlerExtra): McpRequestContext {
  const context = extra.authInfo?.extra?.mcp;
  if (!context || typeof context !== 'object') {
    throw new McpUnauthorizedError('MCP authentication context missing');
  }
  return context as McpRequestContext;
}

export function toMcpAuthInfo(context: McpRequestContext): McpAuthInfo {
  return {
    token: context.keyPrefix,
    clientId: `mcp-key:${context.keyId}`,
    scopes: ['read'],
    extra: { mcp: context },
  };
}

export function toSerializable<T>(value: T): T {
  return JSON.parse(serializeForMcp(value)) as T;
}

export function serializeForMcp(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') {
      return item.toString();
    }
    if (item instanceof Date) {
      return item.toISOString();
    }
    return item;
  }, 2);
}

export function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: serializeForMcp(value),
      },
    ],
  };
}

export function toolResult(summary: string, structuredContent: Record<string, unknown>) {
  return {
    structuredContent: toSerializable(structuredContent),
    content: [
      {
        type: 'text' as const,
        text: summary,
      },
    ],
  };
}

export function getTemplateValue(
  variables: Record<string, string | string[]>,
  name: string
): string {
  const value = variables[name];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export function parseLimit(value: string | null | undefined, fallback = config.mcp.defaultPageSize): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, config.mcp.maxPageSize);
}

export function parseOffset(value: string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function enforceDateRange(startDate?: Date, endDate?: Date): void {
  if (!startDate || !endDate) {
    return;
  }
  const maxMs = config.mcp.maxDateRangeDays * 24 * 60 * 60 * 1000;
  if (endDate.getTime() - startDate.getTime() > maxMs) {
    throw new McpHttpError(400, `Date range exceeds ${config.mcp.maxDateRangeDays} days`);
  }
}

export function parseSats(value: string | number | bigint | undefined): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw new McpHttpError(400, 'Satoshi amount must be an integer string');
  }
  return BigInt(text);
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
