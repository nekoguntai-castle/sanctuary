import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  AssistantToolError,
  assistantReadToolRegistry,
  toMcpStructuredContent,
  type AssistantReadToolDefinition,
  type AssistantToolContext,
} from '../../assistant/tools';
import { requireMcpAuditAccess, requireMcpWalletAccess } from '../auth';
import { getMcpContext, McpHttpError, toolResult, type McpHandlerExtra, type McpRequestContext } from '../types';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const genericOutputSchema = z.object({}).passthrough();

function createMcpToolContext(context: McpRequestContext): AssistantToolContext {
  return {
    source: 'mcp',
    actor: {
      userId: context.userId,
      username: context.username,
      isAdmin: context.isAdmin,
    },
    authorizeWalletAccess: walletId => requireMcpWalletAccess(walletId, context),
    authorizeAuditAccess: () => {
      requireMcpAuditAccess(context);
      return Promise.resolve();
    },
  };
}

function toMcpError(error: AssistantToolError): McpHttpError {
  return new McpHttpError(error.statusCode, error.message, error.code);
}

async function executeMcpReadTool(
  definition: AssistantReadToolDefinition,
  args: unknown,
  extra: McpHandlerExtra
) {
  const mcpContext = getMcpContext(extra);
  try {
    const envelope = await assistantReadToolRegistry.execute(
      definition.name,
      args,
      createMcpToolContext(mcpContext)
    );
    return toolResult(envelope.facts.summary, toMcpStructuredContent(envelope));
  } catch (error) {
    if (error instanceof AssistantToolError) {
      throw toMcpError(error);
    }
    throw error;
  }
}

function registerReadTool(server: McpServer, definition: AssistantReadToolDefinition): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      annotations: readOnlyAnnotations,
      inputSchema: definition.inputSchema,
      outputSchema: genericOutputSchema,
    },
    (args, extra) => executeMcpReadTool(definition, args, extra)
  );
}

export function registerMcpTools(server: McpServer): void {
  assistantReadToolRegistry.list().forEach(definition => registerReadTool(server, definition));
}
