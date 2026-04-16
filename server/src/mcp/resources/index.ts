import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  addressRepository,
  auditLogRepository,
  draftRepository,
  intelligenceRepository,
  labelRepository,
  mcpReadRepository,
  policyRepository,
  utxoRepository,
  walletRepository,
} from '../../repositories';
import { getCachedBtcPrice, getCachedFeeEstimates } from '../cache';
import {
  toAddressDto,
  toAuditLogDto,
  toDraftStatusDto,
  toInsightDto,
  toLabelDto,
  toPolicyDto,
  toTransactionDetailDto,
  toTransactionDto,
  toUtxoDto,
  toWalletDto,
} from '../dto';
import { requireMcpAuditAccess, requireMcpWalletAccess } from '../auth';
import {
  getMcpContext,
  getTemplateValue,
  jsonResource,
  McpHttpError,
  parseLimit,
  parseOffset,
  type McpHandlerExtra,
  type McpRequestContext,
} from '../types';

function isWalletAllowedByScope(walletId: string, context: McpRequestContext): boolean {
  return !context.scope.walletIds || context.scope.walletIds.includes(walletId);
}

async function listAccessibleWallets(context: McpRequestContext) {
  const wallets = await walletRepository.findByUserId(context.userId);
  return wallets.filter(wallet => isWalletAllowedByScope(wallet.id, context));
}

async function listWalletTemplateResources(
  extra: McpHandlerExtra,
  pathSuffix: string,
  titleSuffix: string
) {
  const context = getMcpContext(extra);
  const wallets = await listAccessibleWallets(context);

  return {
    resources: wallets.map(wallet => ({
      uri: `sanctuary://wallets/${wallet.id}${pathSuffix}`,
      name: `${wallet.name} ${titleSuffix}`.trim(),
      mimeType: 'application/json',
    })),
  };
}

function getPaging(uri: URL) {
  return {
    limit: parseLimit(uri.searchParams.get('limit')),
    offset: parseOffset(uri.searchParams.get('offset')),
  };
}

export function registerMcpResources(server: McpServer): void {
  server.registerResource(
    'wallets',
    'sanctuary://wallets',
    {
      title: 'Wallets',
      description: 'Wallets accessible to the MCP API key user',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const context = getMcpContext(extra);
      const wallets = await listAccessibleWallets(context);
      return jsonResource(uri.href, {
        wallets: wallets.map(toWalletDto),
        count: wallets.length,
      });
    }
  );

  server.registerResource(
    'wallet',
    new ResourceTemplate('sanctuary://wallets/{walletId}', {
      list: extra => listWalletTemplateResources(extra, '', 'wallet'),
    }),
    {
      title: 'Wallet Detail',
      description: 'Wallet metadata and sync status',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);

      const wallet = await walletRepository.findByIdWithAccess(walletId, context.userId);
      if (!wallet) {
        throw new McpHttpError(404, 'Wallet not found');
      }

      return jsonResource(uri.href, { wallet: toWalletDto(wallet) });
    }
  );

  server.registerResource(
    'wallet-balance',
    new ResourceTemplate('sanctuary://wallets/{walletId}/balance', {
      list: extra => listWalletTemplateResources(extra, '/balance', 'balance'),
    }),
    {
      title: 'Wallet Balance',
      description: 'Confirmed and unconfirmed unspent sats',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);

      const [confirmed, unconfirmed, total] = await mcpReadRepository.getWalletBalance(walletId);

      return jsonResource(uri.href, {
        walletId,
        confirmedSats: confirmed._sum.amount ?? BigInt(0),
        confirmedUtxos: confirmed._count.id,
        unconfirmedSats: unconfirmed._sum.amount ?? BigInt(0),
        unconfirmedUtxos: unconfirmed._count.id,
        totalSats: total._sum.amount ?? BigInt(0),
        totalUtxos: total._count._all,
        asOf: new Date().toISOString(),
      });
    }
  );

  server.registerResource(
    'wallet-transactions',
    new ResourceTemplate('sanctuary://wallets/{walletId}/transactions', {
      list: extra => listWalletTemplateResources(extra, '/transactions', 'transactions'),
    }),
    {
      title: 'Wallet Transactions',
      description: 'Recent wallet transactions',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);
      const { limit, offset } = getPaging(uri);

      const transactions = await mcpReadRepository.findWalletTransactions(walletId, { limit, offset });

      return jsonResource(uri.href, {
        walletId,
        limit,
        offset,
        transactions: transactions.map(toTransactionDto),
      });
    }
  );

  server.registerResource(
    'wallet-transaction',
    new ResourceTemplate('sanctuary://wallets/{walletId}/transactions/{txid}', {
      list: undefined,
    }),
    {
      title: 'Wallet Transaction Detail',
      description: 'Single wallet transaction with redacted inputs and outputs',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      const txid = getTemplateValue(variables, 'txid');
      await requireMcpWalletAccess(walletId, context);

      const transaction = await mcpReadRepository.findWalletTransactionDetail(walletId, txid);
      if (!transaction) {
        throw new McpHttpError(404, 'Transaction not found for wallet');
      }

      return jsonResource(uri.href, {
        transaction: toTransactionDetailDto(transaction),
      });
    }
  );

  server.registerResource(
    'wallet-utxos',
    new ResourceTemplate('sanctuary://wallets/{walletId}/utxos', {
      list: extra => listWalletTemplateResources(extra, '/utxos', 'UTXOs'),
    }),
    {
      title: 'Wallet UTXOs',
      description: 'Unspent outputs with lock and frozen status',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);
      const { limit, offset } = getPaging(uri);

      const utxos = await utxoRepository.findUnspentWithDraftLocks(walletId, {
        take: limit,
        skip: offset,
      });

      return jsonResource(uri.href, {
        walletId,
        limit,
        offset,
        utxos: utxos.map(toUtxoDto),
      });
    }
  );

  server.registerResource(
    'wallet-addresses',
    new ResourceTemplate('sanctuary://wallets/{walletId}/addresses', {
      list: extra => listWalletTemplateResources(extra, '/addresses', 'addresses'),
    }),
    {
      title: 'Wallet Addresses',
      description: 'Wallet addresses with labels and used status',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);
      const { limit, offset } = getPaging(uri);
      const used = uri.searchParams.has('used') ? uri.searchParams.get('used') === 'true' : undefined;

      const addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
        used,
        take: limit,
        skip: offset,
      });

      return jsonResource(uri.href, {
        walletId,
        limit,
        offset,
        used,
        addresses: addresses.map(toAddressDto),
      });
    }
  );

  server.registerResource(
    'wallet-labels',
    new ResourceTemplate('sanctuary://wallets/{walletId}/labels', {
      list: extra => listWalletTemplateResources(extra, '/labels', 'labels'),
    }),
    {
      title: 'Wallet Labels',
      description: 'Wallet labels with usage counts',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);

      const labels = await labelRepository.findByWalletId(walletId);
      return jsonResource(uri.href, {
        walletId,
        labels: labels.map(toLabelDto),
      });
    }
  );

  server.registerResource(
    'wallet-policies',
    new ResourceTemplate('sanctuary://wallets/{walletId}/policies', {
      list: extra => listWalletTemplateResources(extra, '/policies', 'policies'),
    }),
    {
      title: 'Wallet Policies',
      description: 'Vault policy definitions for a wallet',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);

      const policies = await policyRepository.findAllPoliciesForWallet(walletId);
      return jsonResource(uri.href, {
        walletId,
        policies: policies.map(toPolicyDto),
      });
    }
  );

  server.registerResource(
    'wallet-drafts',
    new ResourceTemplate('sanctuary://wallets/{walletId}/drafts', {
      list: extra => listWalletTemplateResources(extra, '/drafts', 'drafts'),
    }),
    {
      title: 'Wallet Drafts',
      description: 'Draft transaction status only; PSBT material is redacted',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);

      const drafts = await draftRepository.findByWalletId(walletId);
      return jsonResource(uri.href, {
        walletId,
        drafts: drafts.map(toDraftStatusDto),
      });
    }
  );

  server.registerResource(
    'wallet-insights',
    new ResourceTemplate('sanctuary://wallets/{walletId}/insights', {
      list: extra => listWalletTemplateResources(extra, '/insights', 'insights'),
    }),
    {
      title: 'Wallet Insights',
      description: 'Stored Treasury Intelligence insights',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const context = getMcpContext(extra);
      const walletId = getTemplateValue(variables, 'walletId');
      await requireMcpWalletAccess(walletId, context);
      const { limit, offset } = getPaging(uri);

      const insights = await intelligenceRepository.findInsightsByWallet(walletId, undefined, limit, offset);
      return jsonResource(uri.href, {
        walletId,
        limit,
        offset,
        insights: insights.map(toInsightDto),
      });
    }
  );

  server.registerResource(
    'fees',
    'sanctuary://fees',
    {
      title: 'Fee Estimates',
      description: 'Most recent cached fee estimates; no network fetch is performed',
      mimeType: 'application/json',
    },
    async (uri) => jsonResource(uri.href, { fees: await getCachedFeeEstimates() })
  );

  server.registerResource(
    'price',
    new ResourceTemplate('sanctuary://price/{currency}', { list: undefined }),
    {
      title: 'BTC Price',
      description: 'Most recent cached BTC price for a currency; no network fetch is performed',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const currency = getTemplateValue(variables, 'currency') || 'USD';
      return jsonResource(uri.href, { price: await getCachedBtcPrice(currency) });
    }
  );

  server.registerResource(
    'audit-logs',
    'sanctuary://audit-logs',
    {
      title: 'Audit Logs',
      description: 'Recent audit logs; requires admin user and allowAuditLogs key scope',
      mimeType: 'application/json',
    },
    async (uri, extra) => {
      const context = getMcpContext(extra);
      requireMcpAuditAccess(context);
      const { limit, offset } = getPaging(uri);
      const result = await auditLogRepository.findMany({}, { limit, offset });

      return jsonResource(uri.href, {
        limit,
        offset,
        total: result.total,
        logs: result.logs.map(toAuditLogDto),
      });
    }
  );
}
