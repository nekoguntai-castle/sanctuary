import * as z from 'zod/v4';
import { userRepository } from '../../repositories';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const userPreferencesBudget = { maxRows: 1, maxBytes: 16_000 };
const DEFAULT_FIAT_CURRENCY = 'USD';

const userPreferencesInputSchema = {} as const;

function getFiatCurrency(preferences: unknown): string {
  if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
    const fiatCurrency = (preferences as { fiatCurrency?: unknown }).fiatCurrency;
    if (typeof fiatCurrency === 'string' && fiatCurrency.trim()) {
      return fiatCurrency.trim().toUpperCase();
    }
  }
  return DEFAULT_FIAT_CURRENCY;
}

export const userPreferencesTool: AssistantReadToolDefinition<typeof userPreferencesInputSchema> = {
  name: 'get_user_preferences',
  title: 'Get User Preferences',
  description: 'Read the caller display preferences needed for assistant formatting',
  inputSchema: userPreferencesInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'public',
  requiredScope: {
    kind: 'authenticated',
    description: 'Requires an authenticated Sanctuary session or MCP client profile.',
  },
  budgets: userPreferencesBudget,
  async execute(_input, context) {
    const user = await userRepository.findByIdWithSelect(context.actor.userId, { preferences: true });
    if (!user) {
      throw new AssistantToolError(404, 'User not found');
    }
    const fiatCurrency = getFiatCurrency(user.preferences);

    return createToolEnvelope({
      tool: userPreferencesTool,
      context,
      data: {
        userId: context.actor.userId,
        fiatCurrency,
      },
      summary: `User fiat currency preference is ${fiatCurrency}.`,
      facts: [{ label: 'fiat_currency', value: fiatCurrency }],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'user_preferences' }],
      redactions: ['user_profile_private_fields'],
      audit: { rowCount: 1 },
    });
  },
};

export const userReadTools = [userPreferencesTool];
