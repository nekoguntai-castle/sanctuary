import * as z from 'zod/v4';
import { adminReadTools } from './adminReadTools';
import { addressReadTools } from './addressReadTools';
import { analyticsReadTools } from './analyticsReadTools';
import { dashboardReadTools } from './dashboardReadTools';
import { draftReadTools } from './draftReadTools';
import { insightReadTools } from './insightReadTools';
import { labelReadTools } from './labelReadTools';
import { marketReadTools } from './marketReadTools';
import { networkReadTools } from './networkReadTools';
import { policyReadTools } from './policyReadTools';
import {
  addToolDuration,
  AssistantToolError,
  type AssistantReadToolDefinition,
  type AssistantToolContext,
  type AssistantToolEnvelope,
} from './types';
import { transactionReadTools } from './transactionReadTools';
import { utxoReadTools } from './utxoReadTools';
import { walletDetailReadTools } from './walletDetailReadTools';
import { walletReadTools } from './walletReadTools';

export class AssistantReadToolRegistry {
  private readonly tools = new Map<string, AssistantReadToolDefinition>();

  constructor(definitions: AssistantReadToolDefinition[] = []) {
    definitions.forEach(definition => this.register(definition));
  }

  register(definition: AssistantReadToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new AssistantToolError(500, `Duplicate assistant read tool: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  list(): AssistantReadToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get(name: string): AssistantReadToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  async execute(
    name: string,
    rawInput: unknown,
    context: AssistantToolContext
  ): Promise<AssistantToolEnvelope> {
    const tool = this.get(name);
    if (!tool) {
      throw new AssistantToolError(404, `Unknown assistant read tool: ${name}`);
    }

    const input = parseToolInput(tool, rawInput);
    const startedAt = Date.now();
    const envelope = await tool.execute(input, context);
    return addToolDuration(envelope, Date.now() - startedAt);
  }
}

function parseToolInput(definition: AssistantReadToolDefinition, rawInput: unknown) {
  const parsed = z.object(definition.inputSchema).safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new AssistantToolError(400, `Invalid tool input: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const assistantReadToolDefinitions = [
  ...dashboardReadTools,
  ...walletReadTools,
  ...walletDetailReadTools,
  ...transactionReadTools,
  ...utxoReadTools,
  ...addressReadTools,
  ...analyticsReadTools,
  ...labelReadTools,
  ...policyReadTools,
  ...draftReadTools,
  ...insightReadTools,
  ...marketReadTools,
  ...adminReadTools,
  ...networkReadTools,
];

export const assistantReadToolRegistry = new AssistantReadToolRegistry(assistantReadToolDefinitions);
