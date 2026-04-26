import * as z from 'zod/v4';
import { getCachedBtcPrice, getCachedFeeEstimates } from './cache';
import { createToolEnvelope, type AssistantReadToolDefinition } from './types';
import { uniqueStrings } from './utils';

const genericOutputSchema = z.object({}).passthrough();
const marketBudget = { maxRows: 10, maxBytes: 64_000 };

const marketStatusInputSchema = {
  currencies: z.array(z.string().trim().min(3).max(8)).min(1).max(8).default(['USD']),
  includeFees: z.boolean().default(true),
} as const;

function normalizeCurrencies(currencies: string[]): string[] {
  return uniqueStrings(currencies.map(currency => currency.trim().toUpperCase())).slice(0, 8);
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

export const marketReadTools = [marketStatusTool];
