import { describe, expect, it, vi } from 'vitest';
import {
  assertBrowserE2ESeedEnvironment,
  seedBrowserE2EFixtures,
  type BrowserE2EPrismaClient,
  type SeederDependencies,
} from '../../../scripts/seed-browser-e2e';
import { BROWSER_E2E_FIXTURES } from '../../../../tests/e2e/support/browserE2EFixtures';

const validEnvironment = {
  NODE_ENV: 'test',
  SANCTUARY_SEED_BROWSER_E2E: 'true',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/sanctuary_test?schema=public',
};

function createHarness() {
  const transaction = {
    user: { upsert: vi.fn() },
    systemSetting: { deleteMany: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    revokedToken: { deleteMany: vi.fn() },
    revokedRefreshSessionFamily: { deleteMany: vi.fn() },
    wallet: { upsert: vi.fn() },
    walletUser: { upsert: vi.fn() },
  };
  transaction.user.upsert
    .mockResolvedValueOnce({ id: 'user-id' })
    .mockResolvedValueOnce({ id: 'two-factor-user-id' })
    .mockResolvedValueOnce({ id: 'user-id' })
    .mockResolvedValueOnce({ id: 'two-factor-user-id' });

  const prisma = {
    user: {
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'user-id',
          password: 'hash:testpassword',
          twoFactorSecret: null,
        })
        .mockResolvedValueOnce({
          id: 'two-factor-user-id',
          password: 'hash:password',
          twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        }),
    },
    $transaction: vi.fn(async (operation) => operation(transaction)),
  } as unknown as BrowserE2EPrismaClient;
  const dependencies: SeederDependencies = {
    hashPassword: vi.fn(async (value) => `hash:${value}`),
    verifyPassword: vi.fn(async (value, hash) => hash === `hash:${value}`),
  };

  return { dependencies, prisma, transaction };
}

describe('browser E2E fixture seeder', () => {
  it('fails closed outside the explicitly opted-in test database', () => {
    expect(() => assertBrowserE2ESeedEnvironment(validEnvironment)).not.toThrow();
    expect(() => assertBrowserE2ESeedEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
    })).toThrow('NODE_ENV=test');
    expect(() => assertBrowserE2ESeedEnvironment({
      ...validEnvironment,
      SANCTUARY_SEED_BROWSER_E2E: 'false',
    })).toThrow('SANCTUARY_SEED_BROWSER_E2E=true');
    expect(() => assertBrowserE2ESeedEnvironment({
      ...validEnvironment,
      DATABASE_URL: 'postgresql://test:test@localhost:5432/sanctuary',
    })).toThrow('database sanctuary_test');
    expect(() => assertBrowserE2ESeedEnvironment({
      ...validEnvironment,
      DATABASE_URL: 'mysql://test:test@localhost/sanctuary_test',
    })).toThrow('valid PostgreSQL DATABASE_URL');
  });

  it('reconciles stable users and wallet without rotating valid credentials', async () => {
    const { dependencies, prisma, transaction } = createHarness();

    await seedBrowserE2EFixtures(prisma, dependencies);
    await seedBrowserE2EFixtures(prisma, dependencies);

    expect(dependencies.hashPassword).toHaveBeenCalledTimes(2);
    expect(transaction.user.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { username: BROWSER_E2E_FIXTURES.user.username },
      create: expect.objectContaining({
        username: BROWSER_E2E_FIXTURES.user.username,
        password: 'hash:testpassword',
        twoFactorEnabled: false,
        twoFactorSecret: null,
      }),
    }));
    expect(transaction.user.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: expect.objectContaining({
        username: BROWSER_E2E_FIXTURES.twoFactorUser.username,
        password: 'hash:password',
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      }),
    }));
    expect(transaction.wallet.upsert).toHaveBeenCalledWith({
      where: { id: BROWSER_E2E_FIXTURES.wallet.id },
      create: expect.objectContaining({
        id: BROWSER_E2E_FIXTURES.wallet.id,
        name: BROWSER_E2E_FIXTURES.wallet.name,
        network: 'mainnet',
      }),
      update: expect.objectContaining({ name: BROWSER_E2E_FIXTURES.wallet.name }),
    });
    expect(transaction.walletUser.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        walletId: BROWSER_E2E_FIXTURES.wallet.id,
        userId: 'user-id',
        role: 'owner',
      },
    }));
    expect(transaction.systemSetting.deleteMany).toHaveBeenCalledWith({
      where: {
        key: { in: ['initialPassword_user-id', 'initialPassword_two-factor-user-id'] },
      },
    });
  });
});
