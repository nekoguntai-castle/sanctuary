import type { WebhookEndpoint } from '../../../generated/prisma/client';
import { getPriceService } from '../../price';
import { getProfileConfig, type JsonRecord } from '../config';
import { hashWebhookBody } from '../json';
import {
  MAPPED_JSON_WEBHOOK_PROFILE,
  WebhookRetryableError,
  type BuiltWebhookRequest,
  type WalletWebhookEvent,
  type WebhookPayloadProfileHandler,
} from '../types';

type ValuationMode = 'disabled' | 'optional' | 'required';
type MappingContext = Record<string, unknown>;

const OMIT = Symbol('omit');

export const mappedJsonWebhookPayloadProfile: WebhookPayloadProfileHandler = {
  id: MAPPED_JSON_WEBHOOK_PROFILE,

  async build(endpoint: WebhookEndpoint, event: WalletWebhookEvent): Promise<BuiltWebhookRequest> {
    const config = getProfileConfig(endpoint);
    const bodyMapping = toJsonRecord(config.body);
    if (Object.keys(bodyMapping).length === 0) {
      throw new Error('Mapped JSON webhook profile requires a body mapping');
    }

    const context = await buildMappingContext(event, config);
    const body = resolveObjectMapping(bodyMapping, context, config.includeNulls === true);
    return {
      body,
      bodyHash: hashWebhookBody(body),
    };
  },
};

async function buildMappingContext(
  event: WalletWebhookEvent,
  config: JsonRecord,
): Promise<MappingContext> {
  const context: MappingContext = { ...event };
  const valuation = await buildValuation(event, config);
  if (valuation) context.valuation = valuation;
  return context;
}

function resolveObjectMapping(
  mapping: JsonRecord,
  context: MappingContext,
  includeNulls: boolean,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    const resolved = resolveMappingValue(value, context, includeNulls);
    if (resolved !== OMIT) output[key] = resolved;
  }
  return output;
}

const resolveMappingValue = (
  value: unknown,
  context: MappingContext,
  includeNulls: boolean,
): unknown | typeof OMIT => {
  if (Array.isArray(value)) return resolveArrayMapping(value, context, includeNulls);
  if (!isJsonRecord(value)) return value;
  return resolveRecordMapping(value, context, includeNulls);
};

const resolveArrayMapping = (
  values: unknown[],
  context: MappingContext,
  includeNulls: boolean,
): unknown[] => {
  const output: unknown[] = [];
  for (const value of values) {
    const resolved = resolveMappingValue(value, context, includeNulls);
    if (resolved !== OMIT) output.push(resolved);
  }
  return output;
};

const resolveRecordMapping = (
  value: JsonRecord,
  context: MappingContext,
  includeNulls: boolean,
): unknown | typeof OMIT => {
  return isMappingSpec(value)
    ? resolveMappingSpec(value, context, includeNulls)
    : resolveObjectMapping(value, context, includeNulls);
};

const resolveMappingSpec = (
  spec: JsonRecord,
  context: MappingContext,
  includeNulls: boolean,
): unknown | typeof OMIT => {
  if (Object.prototype.hasOwnProperty.call(spec, 'value')) return spec.value;

  const path = getString(spec.path);
  const fallbackPath = getString(spec.fallbackPath);
  let resolved = path ? getPathValue(context, path) : undefined;
  if ((resolved === undefined || resolved === null) && fallbackPath) {
    resolved = getPathValue(context, fallbackPath);
  }

  if (resolved !== undefined && resolved !== null) return resolved;
  if (spec.required === true) throw new Error(`Webhook mapped value is required: ${path ?? 'value'}`);
  return includeNulls ? null : OMIT;
};

async function buildValuation(
  event: WalletWebhookEvent,
  config: JsonRecord,
): Promise<Record<string, unknown> | null> {
  const valuationConfig = toJsonRecord(config.valuation);
  const mode = getValuationMode(valuationConfig.mode);
  if (mode === 'disabled') return null;

  try {
    return await resolveValuation(event, valuationConfig);
  } catch {
    if (mode === 'required') {
      throw new WebhookRetryableError('Configured webhook valuation is required but unavailable');
    }
    return null;
  }
}

async function resolveValuation(
  event: WalletWebhookEvent,
  config: JsonRecord,
): Promise<Record<string, unknown>> {
  const currency = getString(config.currency) ?? 'USD';
  const amountPath = getString(config.amountPath) ?? 'transaction.amountSats';
  const timePath = getString(config.timePath) ?? 'transaction.blockTime';
  const timestamp = getPathValue(event as unknown as MappingContext, timePath) ?? event.occurredAt;
  const amountSats = getRequiredString(getPathValue(event as unknown as MappingContext, amountPath));
  const rate = await getPriceService().getHistoricalPrice(currency, new Date(String(timestamp)));
  const minorUnitScale = getPositiveInteger(config.minorUnitScale, 100);

  return {
    currency,
    rate: formatRate(rate),
    valueMinorUnits: calculateMinorUnits(amountSats, rate, minorUnitScale),
    minorUnitScale,
  };
}

function calculateMinorUnits(amountSats: string, rate: number, scale: number): string {
  const unitAmount = Number(BigInt(amountSats)) / 100_000_000;
  return Math.round(unitAmount * rate * scale).toString();
}

function getPathValue(source: MappingContext, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!isJsonRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isMappingSpec(value: JsonRecord): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'path') ||
    Object.prototype.hasOwnProperty.call(value, 'value');
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

function getValuationMode(value: unknown): ValuationMode {
  if (value === 'optional' || value === 'required') return value;
  return 'disabled';
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getRequiredString(value: unknown): string {
  const stringValue = getString(value);
  if (!stringValue) throw new Error('Webhook valuation amount is unavailable');
  return stringValue;
}

function getPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function formatRate(rate: number): string {
  return rate.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}
