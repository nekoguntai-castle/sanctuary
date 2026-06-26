import * as z from 'zod/v4';
import { listHardwareDeviceModels, type DeviceCatalogFilters } from '../../services/deviceCatalogService';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const deviceCatalogBudget = { maxRows: 100, maxBytes: 64_000 };

const supportedDeviceModelsInputSchema = {
  manufacturer: z.string().trim().min(1).optional(),
  airGapped: z.boolean().optional(),
  connectivity: z.string().trim().min(1).optional(),
  includeDiscontinued: z.boolean().default(false),
} as const;

function buildDeviceModelFilters(input: {
  manufacturer?: string;
  airGapped?: boolean;
  connectivity?: string;
  includeDiscontinued: boolean;
}): DeviceCatalogFilters {
  const filters: DeviceCatalogFilters = {};

  if (input.manufacturer) {
    filters.manufacturer = input.manufacturer;
  }
  if (input.airGapped !== undefined) {
    filters.airGapped = input.airGapped;
  }
  if (input.connectivity) {
    filters.connectivity = input.connectivity;
  }
  if (!input.includeDiscontinued) {
    filters.discontinued = false;
  }

  return filters;
}

export const supportedDeviceModelsTool: AssistantReadToolDefinition<typeof supportedDeviceModelsInputSchema> = {
  name: 'list_supported_device_models',
  title: 'List Supported Device Models',
  description: 'List supported hardware wallet models with optional catalog filters',
  inputSchema: supportedDeviceModelsInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: deviceCatalogBudget,
  async execute(input, context) {
    const filters = buildDeviceModelFilters(input);
    const models = await listHardwareDeviceModels(filters);

    return createToolEnvelope({
      tool: supportedDeviceModelsTool,
      context,
      data: {
        count: models.length,
        includeDiscontinued: input.includeDiscontinued,
        models,
      },
      summary: `Returned ${models.length} supported device models.`,
      facts: [
        { label: 'device_model_count', value: models.length },
        { label: 'include_discontinued', value: input.includeDiscontinued },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'hardware_device_models' }],
      audit: { rowCount: models.length },
    });
  },
};

export const deviceReadTools = [supportedDeviceModelsTool];
