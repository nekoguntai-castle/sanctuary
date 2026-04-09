import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() so these are available in hoisted vi.mock() factories
const {
  mockFindAllWithSelectUsers,
  mockFindAllWithSelectWallets,
  mockGetAllHealth,
  mockGetByCategory,
  collectorMap,
} = vi.hoisted(() => ({
  mockFindAllWithSelectUsers: vi.fn(),
  mockFindAllWithSelectWallets: vi.fn(),
  mockGetAllHealth: vi.fn(),
  mockGetByCategory: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

// Mock repositories
vi.mock('../../../../src/repositories', () => ({
  userRepository: {
    findAllWithSelect: (...args: unknown[]) => mockFindAllWithSelectUsers(...args),
  },
  walletRepository: {
    findAllWithSelect: (...args: unknown[]) => mockFindAllWithSelectWallets(...args),
  },
}));

// Mock circuit breaker registry
vi.mock('../../../../src/services/circuitBreaker', () => ({
  circuitBreakerRegistry: {
    getAllHealth: () => mockGetAllHealth(),
  },
}));

// Mock dead letter queue
vi.mock('../../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    getByCategory: (cat: string) => mockGetByCategory(cat),
  },
}));

// Mock collector registry to capture the telegram collector function
vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
  getCollectors: () => collectorMap,
}));

// Import to trigger registration
import '../../../../src/services/supportPackage/collectors/telegram';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt: new Date(),
  };
}

describe('telegram collector', () => {
  beforeEach(() => {
    mockFindAllWithSelectUsers.mockResolvedValue([]);
    mockGetAllHealth.mockReturnValue([]);
    mockGetByCategory.mockReturnValue([]);
    mockFindAllWithSelectWallets.mockResolvedValue([]);
  });

  const getTelegramCollector = () => {
    const collector = collectorMap.get('telegram');
    if (!collector) throw new Error('telegram collector not registered');
    return collector;
  };

  it('registers itself as telegram', () => {
    expect(collectorMap.has('telegram')).toBe(true);
  });

  it('returns empty state when no users exist', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([]);
    const result = await getTelegramCollector()(makeContext());

    expect(result.users).toEqual([]);
    expect(result.walletUserAssociations).toEqual([]);
    expect(result.dlqTelegramEntries).toBe(0);
    expect((result.diagnostics as any).commonIssues).toEqual([]);
  });

  it('anonymizes user and wallet IDs', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-real-id',
      preferences: {
        telegram: {
          enabled: true,
          botToken: 'bot123:abc',
          chatId: '12345',
          wallets: {
            'wallet-real-id': {
              enabled: true,
              notifyReceived: true,
              notifySent: false,
              notifyConsolidation: false,
              notifyDraft: true,
            },
          },
        },
      },
      wallets: [{ walletId: 'wallet-real-id' }],
      groupMemberships: [],
    }]);
    mockFindAllWithSelectWallets.mockResolvedValue([{ id: 'wallet-real-id', type: 'multi_sig' }]);

    const ctx = makeContext();
    const result = await getTelegramCollector()(ctx);

    const users = result.users as any[];
    expect(users).toHaveLength(1);

    // IDs should be anonymized
    expect(users[0].id).toMatch(/^user-[a-f0-9]{8}$/);
    expect(users[0].id).not.toContain('real-id');

    // Sensitive values should be boolean flags, not raw values
    expect(users[0].hasBotToken).toBe(true);
    expect(users[0].hasChatId).toBe(true);
    expect(users[0].globalEnabled).toBe(true);

    // Wallet settings should be anonymized
    expect(users[0].walletSettings[0].walletId).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(users[0].walletSettings[0].walletType).toBe('multi_sig');
    expect(users[0].walletSettings[0].enabled).toBe(true);
  });

  it('detects global enabled but missing botToken', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: { enabled: true, botToken: '', chatId: '123', wallets: {} },
      },
      wallets: [],
      groupMemberships: [],
    }]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('missing botToken'))).toBe(true);
  });

  it('detects global enabled but missing chatId', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: { enabled: true, botToken: 'bot:abc', chatId: '', wallets: {} },
      },
      wallets: [],
      groupMemberships: [],
    }]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('missing chatId'))).toBe(true);
  });

  it('detects wallet enabled but global disabled', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: false,
          botToken: 'bot:abc',
          chatId: '123',
          wallets: { 'w1': { enabled: true } },
        },
      },
      wallets: [{ walletId: 'w1' }],
      groupMemberships: [],
    }]);
    mockFindAllWithSelectWallets.mockResolvedValue([{ id: 'w1', type: 'single_sig' }]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('global telegram is disabled'))).toBe(true);
  });

  it('detects orphaned wallet setting (no access)', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: true,
          botToken: 'bot:abc',
          chatId: '123',
          wallets: { 'orphaned-wallet': { enabled: true } },
        },
      },
      wallets: [],
      groupMemberships: [],
    }]);
    mockFindAllWithSelectWallets.mockResolvedValue([]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('orphaned setting'))).toBe(true);
  });

  it('detects telegram circuit breaker open', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([]);
    mockGetAllHealth.mockReturnValue([
      { name: 'telegram-api', state: 'open', failures: 5 },
    ]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('circuit breaker is OPEN'))).toBe(true);
  });

  it('detects DLQ telegram entries', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([]);
    mockGetByCategory.mockReturnValue([
      { id: 'dlq-1', category: 'telegram' },
      { id: 'dlq-2', category: 'telegram' },
    ]);

    const result = await getTelegramCollector()(makeContext());
    expect(result.dlqTelegramEntries).toBe(2);
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('dead letter queue'))).toBe(true);
  });

  it('includes wallet-user associations', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([
      {
        id: 'user-1',
        preferences: null,
        wallets: [{ walletId: 'w1' }],
        groupMemberships: [],
      },
      {
        id: 'user-2',
        preferences: null,
        wallets: [{ walletId: 'w1' }],
        groupMemberships: [{ group: { wallets: [{ id: 'w2' }] } }],
      },
    ]);
    mockFindAllWithSelectWallets.mockResolvedValue([
      { id: 'w1', type: 'multi_sig' },
      { id: 'w2', type: 'single_sig' },
    ]);

    const result = await getTelegramCollector()(makeContext());
    const assocs = result.walletUserAssociations as any[];

    // w1 should have 2 users with direct access
    const w1 = assocs.find((a: any) => a.userCount === 2);
    expect(w1).toBeDefined();
    expect(w1.hasDirectAccess).toBe(true);
    // w1 has no group access — covers the counts.group.size > 0 === false branch
    expect(w1.hasGroupAccess).toBe(false);

    // w2 should have 1 user with group access only
    const w2 = assocs.find((a: any) => a.userCount === 1);
    expect(w2).toBeDefined();
    expect(w2.hasGroupAccess).toBe(true);
    // w2 has no direct access — covers the counts.direct.size > 0 === false branch
    expect(w2.hasDirectAccess).toBe(false);
  });

  it('defaults undefined wallet settings fields to false', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: true,
          botToken: 'bot:abc',
          chatId: '123',
          wallets: {
            'w1': {}, // all fields undefined
          },
        },
      },
      wallets: [{ walletId: 'w1' }],
      groupMemberships: [],
    }]);
    mockFindAllWithSelectWallets.mockResolvedValue([{ id: 'w1', type: 'single_sig' }]);

    const result = await getTelegramCollector()(makeContext());
    const ws = (result.users as any[])[0].walletSettings[0];
    expect(ws.enabled).toBe(false);
    expect(ws.notifyReceived).toBe(false);
    expect(ws.notifySent).toBe(false);
    expect(ws.notifyConsolidation).toBe(false);
    expect(ws.notifyDraft).toBe(false);
  });

  it('handles wallet accessible via both direct and group access', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([
      {
        id: 'user-1',
        preferences: null,
        wallets: [{ walletId: 'shared-w' }],
        groupMemberships: [{ group: { wallets: [{ id: 'shared-w' }] } }],
      },
    ]);
    mockFindAllWithSelectWallets.mockResolvedValue([{ id: 'shared-w', type: 'multi_sig' }]);

    const result = await getTelegramCollector()(makeContext());
    const assocs = result.walletUserAssociations as any[];
    expect(assocs).toHaveLength(1);
    expect(assocs[0].hasDirectAccess).toBe(true);
    expect(assocs[0].hasGroupAccess).toBe(true);
    expect(assocs[0].userCount).toBe(1);
  });

  it('returns "unknown" walletType when wallet is not in the database', async () => {
    mockFindAllWithSelectUsers.mockResolvedValue([{
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: true,
          botToken: 'bot:abc',
          chatId: '123',
          wallets: {
            'missing-wallet': {
              enabled: true,
              notifyReceived: true,
              notifySent: false,
              notifyConsolidation: false,
              notifyDraft: false,
            },
          },
        },
      },
      wallets: [{ walletId: 'missing-wallet' }],
      groupMemberships: [],
    }]);
    // Return empty wallet list — missing-wallet is not found
    mockFindAllWithSelectWallets.mockResolvedValue([]);

    const result = await getTelegramCollector()(makeContext());
    const users = result.users as any[];
    expect(users).toHaveLength(1);
    // walletTypeMap.get('missing-wallet') is undefined, so ?? 'unknown' should kick in
    expect(users[0].walletSettings[0].walletType).toBe('unknown');
  });
});
