import * as z from 'zod/v4';
import { getCachedBtcPrice, getCachedFeeEstimates } from './cache';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { uniqueStrings } from './utils';
import { getPriceService } from '../../services/price';

const genericOutputSchema = z.object({}).passthrough();
const marketBudget = { maxRows: 10, maxBytes: 64_000 };

const marketStatusInputSchema = {
  currencies: z.array(z.string().trim().min(3).max(8)).min(1).max(8).default(['USD']),
  includeFees: z.boolean().default(true),
} as const;

const historicalPriceInputSchema = {
  date: z.string().min(1),
  currency: z.string().trim().min(3).max(8).default('USD'),
} as const;

function normalizeCurrencies(currencies: string[]): string[] {
  return uniqueStrings(currencies.map(currency => currency.trim().toUpperCase())).slice(0, 8);
}

function parseHistoricalPriceDate(value: string): Date {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new AssistantToolError(400, 'Invalid date format. Use YYYY-MM-DD or ISO format');
  }
  if (parsedDate > new Date()) {
    throw new AssistantToolError(400, 'Date cannot be in the future');
  }

  return parsedDate;
}

export const marketStatusTool: AssistantReadToolDefinition<typeof marketStatusInputSchema> = {
  name: 'get_market_status',
  title: 'Get Market Status',
  description: 'Return cached BTC price and fee status without fetching external services',
  inputSchema: marketStatusInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: marketBudget,
  async execute(input, context) {
    const currencies = normalizeCurrencies(input.currencies);
    const [fees, prices] = await Promise.all([
      input.includeFees ? getCachedFeeEstimates() : Promise.resolve(null),
      Promise.all(currencies.map(currency => getCachedBtcPrice(currency))),
    ]);
    const stalePrices = prices.filter(price => price.stale).length;

    return createToolEnvelope({
      tool: marketStatusTool,
      context,
      data: {
        fees,
        prices,
        currencies,
        asOf: new Date().toISOString(),
      },
      summary: `Returned market status for ${currencies.length} currencies.`,
      facts: [
        { label: 'currency_count', value: currencies.length },
        { label: 'stale_price_count', value: stalePrices },
        { label: 'fee_status_included', value: input.includeFees },
      ],
      provenanceSources: [
        { type: 'sanctuary_cache', label: 'btc_price' },
        ...(fees ? [{ type: 'sanctuary_cache' as const, label: 'fee_estimates', asOf: fees.asOf }] : []),
      ],
      audit: { rowCount: currencies.length + (fees ? 1 : 0) },
    });
  },
};

export const historicalPriceTool: AssistantReadToolDefinition<typeof historicalPriceInputSchema> = {
  name: 'get_historical_price',
  title: 'Get Historical BTC Price',
  description: 'Get the historical Bitcoin price for a required past date and currency',
  inputSchema: historicalPriceInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: marketBudget,
  async execute(input, context) {
    const parsedDate = parseHistoricalPriceDate(input.date);
    const currency = input.currency.trim().toUpperCase();
    const price = await getPriceService().getHistoricalPrice(currency, parsedDate);

    return createToolEnvelope({
      tool: historicalPriceTool,
      context,
      data: {
        date: parsedDate.toISOString(),
        currency,
        price,
        provider: 'coingecko',
      },
      summary: `Historical ${currency} BTC price returned for ${parsedDate.toISOString()}.`,
      facts: [
        { label: 'currency', value: currency },
        { label: 'price', value: price },
      ],
      provenanceSources: [{ type: 'computed', label: 'historical_btc_price' }],
      audit: { rowCount: 1 },
    });
  },
};

export const marketReadTools = [marketStatusTool, historicalPriceTool];
