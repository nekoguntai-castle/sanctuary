import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { requireMcpWalletAccess } from '../auth';
import { getMcpContext } from '../types';

function userPrompt(text: string) {
  return {
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text,
        },
      },
    ],
  };
}

export function registerMcpPrompts(server: McpServer): void {
  server.registerPrompt(
    'transaction_analysis',
    {
      title: 'Transaction Analysis',
      description: 'Analyze a wallet transaction for fee efficiency, labels, and privacy signals',
      argsSchema: {
        walletId: z.string().uuid(),
        txid: z.string().min(1),
      },
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      return userPrompt(
        [
          `Analyze transaction ${args.txid} for wallet ${args.walletId}.`,
          `Use sanctuary://wallets/${args.walletId}/transactions/${args.txid} as the source data.`,
          'Focus on transaction type, fee efficiency, labels, counterparties, and privacy observations.',
          'Keep this read-only and advisory. Do not provide signing or spending instructions.',
        ].join('\n')
      );
    }
  );

  server.registerPrompt(
    'utxo_management',
    {
      title: 'UTXO Management',
      description: 'Review UTXO health and consolidation opportunities',
      argsSchema: {
        walletId: z.string().uuid(),
      },
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      return userPrompt(
        [
          `Review UTXO health for wallet ${args.walletId}.`,
          `Use sanctuary://wallets/${args.walletId}/utxos and sanctuary://fees as source data.`,
          'Identify dust, large UTXOs, frozen or draft-locked UTXOs, and consolidation timing considerations.',
          'Keep recommendations advisory and read-only.',
        ].join('\n')
      );
    }
  );

  server.registerPrompt(
    'spending_analysis',
    {
      title: 'Spending Analysis',
      description: 'Analyze spending patterns and label trends',
      argsSchema: {
        walletId: z.string().uuid(),
        period: z.string().default('30d'),
      },
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      return userPrompt(
        [
          `Analyze spending patterns for wallet ${args.walletId} over ${args.period}.`,
          `Use sanctuary://wallets/${args.walletId}/transactions and sanctuary://wallets/${args.walletId}/labels as source data.`,
          'Summarize transaction velocity, labeled categories, outliers, and stale data caveats.',
          'Do not present tax, legal, or financial advice.',
        ].join('\n')
      );
    }
  );

  server.registerPrompt(
    'fee_optimization',
    {
      title: 'Fee Optimization',
      description: 'Review current cached fee conditions for transaction timing',
      argsSchema: {
        walletId: z.string().uuid().optional(),
      },
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      if (args.walletId) {
        await requireMcpWalletAccess(args.walletId, context);
      }

      return userPrompt(
        [
          'Analyze fee timing using sanctuary://fees.',
          args.walletId ? `Use wallet context from sanctuary://wallets/${args.walletId}/utxos.` : 'If wallet context is needed, ask for a wallet id.',
          'Always cite the fee estimate timestamp and stale flag.',
          'Keep advice read-only. Do not construct or broadcast transactions.',
        ].join('\n')
      );
    }
  );

  server.registerPrompt(
    'wallet_health',
    {
      title: 'Wallet Health',
      description: 'Overall wallet health check across sync, UTXOs, transactions, policies, and insights',
      argsSchema: {
        walletId: z.string().uuid(),
      },
    },
    async (args, extra) => {
      const context = getMcpContext(extra);
      await requireMcpWalletAccess(args.walletId, context);
      return userPrompt(
        [
          `Evaluate overall health for wallet ${args.walletId}.`,
          `Use sanctuary://wallets/${args.walletId}, /balance, /utxos, /transactions, /policies, and /insights resources.`,
          'Cover sync freshness, UTXO distribution, address reuse indicators, policy posture, and active insights.',
          'Keep the output advisory, read-only, and explicit about stale or missing source data.',
        ].join('\n')
      );
    }
  );
}
