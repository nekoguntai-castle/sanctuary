import * as z from 'zod/v4';
import { assistantReadRepository } from '../../repositories';
import { toAddressDetailDto } from './dto';
import { buildAddressSummary } from './summary';
import { AssistantToolError, createToolEnvelope, type AssistantReadToolDefinition } from './types';

const genericOutputSchema = z.object({}).passthrough();
const addressBudget = { maxRows: 100, maxBytes: 96_000 };

const addressSummaryInputSchema = {
  walletId: z.string().uuid(),
} as const;

const addressDetailInputSchema = {
  walletId: z.string().uuid(),
  addressId: z.string().uuid().optional(),
  address: z.string().min(1).optional(),
} as const;

function requireExactlyOneAddressLookup(input: { addressId?: string; address?: string }) {
  const hasAddressId = input.addressId !== undefined;
  const hasAddress = input.address !== undefined;
  if (hasAddressId === hasAddress) {
    throw new AssistantToolError(400, 'Provide exactly one of addressId or address');
  }
}

export const addressSummaryTool: AssistantReadToolDefinition<typeof addressSummaryInputSchema> = {
  name: 'get_address_summary',
  title: 'Get Address Summary',
  description: 'Read address counts and used/unused balance summary for a wallet',
  inputSchema: addressSummaryInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'wallet',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet.',
  },
  budgets: addressBudget,
  async execute(input, context) {
    await context.authorizeWalletAccess(input.walletId);
    const summary = buildAddressSummary(await assistantReadRepository.getAddressSummary(input.walletId));

    return createToolEnvelope({
      tool: addressSummaryTool,
      context,
      data: { walletId: input.walletId, summary },
      summary: `Wallet has ${summary.totalAddresses} addresses; ${summary.usedCount} are used.`,
      facts: [
        { label: 'address_count', value: summary.totalAddresses },
        { label: 'used_address_count', value: summary.usedCount },
        { label: 'address_balance_sats', value: summary.totalBalanceSats, unit: 'sats' },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'addresses' }],
      audit: { walletCount: 1 },
    });
  },
};

export const addressDetailTool: AssistantReadToolDefinition<typeof addressDetailInputSchema> = {
  name: 'get_address_detail',
  title: 'Get Address Detail',
  description: 'Read one wallet address by ID or address string with labels, balance, and transaction count',
  inputSchema: addressDetailInputSchema,
  outputSchema: genericOutputSchema,
  sensitivity: 'high',
  requiredScope: {
    kind: 'wallet',
    walletIdInput: 'walletId',
    description: 'Requires read access to the requested wallet and may expose a raw address.',
  },
  budgets: addressBudget,
  async execute(input, context) {
    requireExactlyOneAddressLookup(input);
    await context.authorizeWalletAccess(input.walletId);
    const found = await assistantReadRepository.findAddressDetail(input.walletId, {
      addressId: input.addressId,
      address: input.address,
    });
    if (!found) {
      throw new AssistantToolError(404, 'Address not found');
    }
    const address = toAddressDetailDto(found);

    return createToolEnvelope({
      tool: addressDetailTool,
      context,
      data: { walletId: input.walletId, address },
      summary: `Address ${address.address} has ${address.balance.unspentSats} sats unspent.`,
      facts: [
        { label: 'address_unspent_sats', value: address.balance.unspentSats, unit: 'sats' },
        { label: 'address_transaction_count', value: address.transactionCount },
      ],
      provenanceSources: [{ type: 'sanctuary_repository', label: 'addresses' }],
      audit: { walletCount: 1, rowCount: 1 },
    });
  },
};

export const addressReadTools = [addressSummaryTool, addressDetailTool];
