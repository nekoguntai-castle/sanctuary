import * as z from 'zod/v4';
import { getCachedBtcPrice, getCachedFeeEstimates } from './cache';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { parseSats } from './utils';
import { getBitcoinNetworkStatus } from '../../services/bitcoin/networkStatusService';
import { getErrorMessage } from '../../utils/errors';

const genericOutputSchema = z.object({}).passthrough();
const publicBudget = { maxRows: 1, maxBytes: 32_000 };

const bitcoinNetworkStatusInputSchema = {} as const;
const feeEstimatesInputSchema = {} as const;

const priceConversionInputSchema = {
  sats: z.union([z.string(), z.number()]).optional(),
  fiatAmount: z.number().positive().optional(),
  currency: z.string().min(3).max(8).default('USD'),
} as const;

type PriceConversionAmountInput =
  | { kind: 'sats'; sats: string | number }
  | { kind: 'fiat'; fiatAmount: number };

function requireSafeSatsNumber(sats: bigint): number {
  if (sats > BigInt(Number.MAX_SAFE_INTEGER) || sats < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new AssistantToolError(400, 'Satoshi amount is outside safe conversion range');
  }
  return Number(sats);
}

function requireExactlyOneConversionInput(input: { sats?: string | number; fiatAmount?: number }): PriceConversionAmountInput {
  if (input.sats !== undefined && input.fiatAmount !== undefined) {
    throw new AssistantToolError(400, 'Provide exactly one of sats or fiatAmount');
  }
  if (input.sats !== undefined) {
    return { kind: 'sats', sats: input.sats };
  }
  if (input.fiatAmount !== undefined) {
    return { kind: 'fiat', fiatAmount: input.fiatAmount };
  }
  throw new AssistantToolError(400, 'Provide exactly one of sats or fiatAmount');
}

function requireValidPrice(price: number): void {
  if (!Number.isFinite(price) || price <= 0) {
    throw new AssistantToolError(400, 'Cached BTC price is invalid');
  }
}

export const bitcoinNetworkStatusTool: AssistantReadToolDefinition<typeof bitcoinNetworkStatusInputSchema> = {
  name: 'get_bitcoin_network_status',
  title: 'Get Bitcoin Network Status',
  description: 'Current Bitcoin node connection details, network, and latest block height',
  inputSchema: bitcoinNetworkStatusInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: publicBudget,
  async execute(_input, context) {
    try {
      const status = await getBitcoinNetworkStatus();
      return createToolEnvelope({
        tool: bitcoinNetworkStatusTool,
        context,
        data: { status },
        summary: status.blockHeight === undefined
          ? 'Bitcoin network status returned without a block height.'
          : `Current Bitcoin block height is ${status.blockHeight}.`,
        facts: [
          { label: 'connected', value: status.connected },
          { label: 'network', value: status.network },
          { label: 'block_height', value: status.blockHeight ?? null },
          { label: 'server', value: status.server },
        ],
        provenanceSources: [{ type: 'computed', label: 'bitcoin_network_status' }],
      });
    } catch (error) {
      return createToolEnvelope({
        tool: bitcoinNetworkStatusTool,
        context,
        data: {
          status: {
            connected: false,
            error: getErrorMessage(error),
          },
        },
        summary: 'Bitcoin network status is unavailable.',
        facts: [
          { label: 'connected', value: false },
          { label: 'block_height', value: null },
        ],
        provenanceSources: [{ type: 'computed', label: 'bitcoin_network_status' }],
        warnings: ['bitcoin_network_status_unavailable'],
      });
    }
  },
};

// Fiat conversions round to the nearest satoshi; callers needing exact accounting use sats input.
function satsFromFiat(fiatAmount: number, price: number): string {
  const sats = (fiatAmount / price) * 100_000_000;
  if (!Number.isFinite(sats) || sats > Number.MAX_SAFE_INTEGER) {
    throw new AssistantToolError(400, 'Fiat amount is outside safe conversion range');
  }
  return Math.round(sats).toString();
}

export const feeEstimatesTool: AssistantReadToolDefinition<typeof feeEstimatesInputSchema> = {
  name: 'get_fee_estimates',
  title: 'Get Fee Estimates',
  description: 'Current cached fee estimates; never fetches from external services',
  inputSchema: feeEstimatesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: publicBudget,
  async execute(_input, context) {
    const fees = await getCachedFeeEstimates();
    return createToolEnvelope({
      tool: feeEstimatesTool,
      context,
      data: { fees },
      summary: 'Cached fee estimates returned.',
      facts: [
        { label: 'fees_available', value: fees.available },
        { label: 'fees_stale', value: fees.stale },
      ],
      provenanceSources: [{ type: 'sanctuary_cache', label: 'fee_estimates', asOf: fees.asOf }],
    });
  },
};

export const priceConversionTool: AssistantReadToolDefinition<typeof priceConversionInputSchema> = {
  name: 'convert_price',
  title: 'Convert BTC Price',
  description: 'Convert sats to fiat or fiat to sats using cached BTC price data',
  inputSchema: priceConversionInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: publicBudget,
  async execute(input, context) {
    const amountInput = requireExactlyOneConversionInput(input);
    const price = await getCachedBtcPrice(input.currency);
    const conversion = price.available && price.price !== null
      ? buildPriceConversion(amountInput, price.price, price.currency)
      : null;

    return createToolEnvelope({
      tool: priceConversionTool,
      context,
      data: { price, conversion },
      summary: conversion ? 'Price conversion calculated from cached data.' : `No cached ${price.currency} price is available.`,
      facts: [{ label: 'price_available', value: price.available }],
      provenanceSources: [{ type: 'sanctuary_cache', label: 'btc_price', asOf: price.asOf }],
    });
  },
};

function buildPriceConversion(
  input: PriceConversionAmountInput,
  price: number,
  currency: string
) {
  requireValidPrice(price);
  if (input.kind === 'sats') {
    const sats = parseSats(input.sats);
    return {
      direction: 'sats_to_fiat',
      sats: sats.toString(),
      fiatAmount: (requireSafeSatsNumber(sats) / 100_000_000) * price,
      currency,
    };
  }

  const fiatAmount = input.fiatAmount;
  return {
    direction: 'fiat_to_sats',
    fiatAmount,
    sats: satsFromFiat(fiatAmount, price),
    currency,
  };
}

export const networkReadTools = [bitcoinNetworkStatusTool, feeEstimatesTool, priceConversionTool];
