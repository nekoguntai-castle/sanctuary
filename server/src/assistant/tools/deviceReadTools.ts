import * as z from 'zod/v4';
import { listHardwareDeviceModels, type DeviceCatalogFilters } from '../../services/deviceCatalogService';
import { getUserAccessibleDevices, type DeviceWithAccess } from '../../services/deviceAccess';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const deviceCatalogBudget = { maxRows: 100, maxBytes: 64_000 };
const userDeviceBudget = { maxRows: 100, maxBytes: 96_000 };

const supportedDeviceModelsInputSchema = {
  manufacturer: z.string().trim().min(1).optional(),
  airGapped: z.boolean().optional(),
  connectivity: z.string().trim().min(1).optional(),
  includeDiscontinued: z.boolean().default(false),
} as const;

const listDevicesInputSchema = {} as const;

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

function toDeviceSummary(device: DeviceWithAccess) {
  return {
    id: device.id,
    label: device.label,
    type: device.type,
    model: device.model,
    isOwner: device.isOwner,
    userRole: device.userRole,
    walletCount: device.walletCount,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
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

export const listDevicesTool: AssistantReadToolDefinition<typeof listDevicesInputSchema> = {
  name: 'list_devices',
  title: 'List Devices',
  description: 'List caller-accessible signing devices without xpubs, fingerprints, derivation paths, or wallet associations',
  inputSchema: listDevicesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet_set',
    description: 'Requires an explicit wallet-scoped session; results are limited to devices accessible to the caller.',
  },
  budgets: userDeviceBudget,
  async execute(_input, context) {
    const devices = (await getUserAccessibleDevices(context.actor.userId)).map(toDeviceSummary);

    return createToolEnvelope({
      tool: listDevicesTool,
      context,
      data: {
        count: devices.length,
        devices,
      },
      summary: `Found ${devices.length} accessible devices.`,
      facts: [{ label: 'device_count', value: devices.length }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'devices' }],
      redactions: [
        'device_xpubs',
        'device_account_xpubs',
        'device_fingerprints',
        'device_derivation_paths',
        'device_owner_usernames',
        'device_group_fields',
        'device_wallet_associations',
        'device_account_details',
      ],
      audit: { rowCount: devices.length },
    });
  },
};

export const deviceReadTools = [supportedDeviceModelsTool, listDevicesTool];
