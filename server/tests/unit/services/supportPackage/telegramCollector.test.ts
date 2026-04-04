import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() so these are available in hoisted vi.mock() factories
const {
  mockFindManyUsers,
  mockFindManyWallets,
  mockGetAllHealth,
  mockGetByCategory,
  collectorMap,
} = vi.hoisted(() => ({
  mockFindManyUsers: vi.fn(),
  mockFindManyWallets: vi.fn(),
  mockGetAllHealth: vi.fn(),
  mockGetByCategory: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

// Mock prisma
vi.mock('../../../../src/repositories/db', () => ({
  db: {
    user: { findMany: (...args: unknown[]) => mockFindManyUsers(...args) },
    wallet: { findMany: (...args: unknown[]) => mockFindManyWallets(...args) },
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
    mockFindManyUsers.mockResolvedValue([]);
    mockGetAllHealth.mockReturnValue([]);
    mockGetByCategory.mockReturnValue([]);
    mockFindManyWallets.mockResolvedValue([]);
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
    mockFindManyUsers.mockResolvedValue([]);
    const result = await getTelegramCollector()(makeContext());

    expect(result.users).toEqual([]);
    expect(result.walletUserAssociations).toEqual([]);
    expect(result.dlqTelegramEntries).toBe(0);
    expect((result.diagnostics as any).commonIssues).toEqual([]);
  });

  it('anonymizes user and wallet IDs', async () => {
    mockFindManyUsers.mockResolvedValue([{
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
    mockFindManyWallets.mockResolvedValue([{ id: 'wallet-real-id', type: 'multi_sig' }]);

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
    mockFindManyUsers.mockResolvedValue([{
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
    mockFindManyUsers.mockResolvedValue([{
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
    mockFindManyUsers.mockResolvedValue([{
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
    mockFindManyWallets.mockResolvedValue([{ id: 'w1', type: 'single_sig' }]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('global telegram is disabled'))).toBe(true);
  });

  it('detects orphaned wallet setting (no access)', async () => {
    mockFindManyUsers.mockResolvedValue([{
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
    mockFindManyWallets.mockResolvedValue([]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('orphaned setting'))).toBe(true);
  });

  it('detects telegram circuit breaker open', async () => {
    mockFindManyUsers.mockResolvedValue([]);
    mockGetAllHealth.mockReturnValue([
      { name: 'telegram-api', state: 'open', failures: 5 },
    ]);

    const result = await getTelegramCollector()(makeContext());
    const issues = (result.diagnostics as any).commonIssues as string[];
    expect(issues.some((i: string) => i.includes('circuit breaker is OPEN'))).toBe(true);
  });

  it('detects DLQ telegram entries', async () => {
    mockFindManyUsers.mockResolvedValue([]);
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
    mockFindManyUsers.mockResolvedValue([
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
    mockFindManyWallets.mockResolvedValue([
      { id: 'w1', type: 'multi_sig' },
      { id: 'w2', type: 'single_sig' },
    ]);

    const result = await getTelegramCollector()(makeContext());
    const assocs = result.walletUserAssociations as any[];

    // w1 should have 2 users with direct access
    const w1 = assocs.find((a: any) => a.userCount === 2);
    expect(w1).toBeDefined();
    expect(w1.hasDirectAccess).toBe(true);

    // w2 should have 1 user with group access only
    const w2 = assocs.find((a: any) => a.userCount === 1);
    expect(w2).toBeDefined();
    expect(w2.hasGroupAccess).toBe(true);
  });
});
