import { hashPassword, verifyPassword } from '../src/utils/password';
import type { Prisma } from '../src/generated/prisma/client';
import { BROWSER_E2E_FIXTURES } from '../../tests/e2e/support/browserE2EFixtures';

const REQUIRED_DATABASE = 'sanctuary_test';
const SEED_OPT_IN = 'SANCTUARY_SEED_BROWSER_E2E';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

interface ExistingUser {
  id: string;
  password: string;
  twoFactorSecret: string | null;
}

interface SeededUser {
  id: string;
}

interface BrowserE2ETransaction {
  user: {
    upsert(args: Prisma.UserUpsertArgs): Promise<SeededUser>;
  };
  systemSetting: {
    deleteMany(args: Prisma.SystemSettingDeleteManyArgs): Promise<unknown>;
  };
  refreshToken: {
    deleteMany(args: Prisma.RefreshTokenDeleteManyArgs): Promise<unknown>;
  };
  revokedToken: {
    deleteMany(args: Prisma.RevokedTokenDeleteManyArgs): Promise<unknown>;
  };
  revokedRefreshSessionFamily: {
    deleteMany(args: Prisma.RevokedRefreshSessionFamilyDeleteManyArgs): Promise<unknown>;
  };
  wallet: {
    upsert(args: Prisma.WalletUpsertArgs): Promise<unknown>;
  };
  walletUser: {
    upsert(args: Prisma.WalletUserUpsertArgs): Promise<unknown>;
  };
}

export interface BrowserE2EPrismaClient {
  user: {
    findUnique(args: Prisma.UserFindUniqueArgs): Promise<ExistingUser | null>;
  };
  $transaction<T>(operation: (transaction: BrowserE2ETransaction) => Promise<T>): Promise<T>;
}

export interface SeederDependencies {
  hashPassword(value: string): Promise<string>;
  verifyPassword(value: string, hash: string): Promise<boolean>;
}

const DEFAULT_DEPENDENCIES: SeederDependencies = {
  hashPassword,
  verifyPassword,
};

function databaseName(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('unsupported protocol');
    }
    return decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  } catch {
    throw new Error('Browser E2E seeding requires a valid PostgreSQL DATABASE_URL');
  }
}

export function assertBrowserE2ESeedEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== 'test') {
    throw new Error('Browser E2E seeding requires NODE_ENV=test');
  }
  if (environment[SEED_OPT_IN] !== 'true') {
    throw new Error(`Browser E2E seeding requires ${SEED_OPT_IN}=true`);
  }
  const name = databaseName(environment.DATABASE_URL ?? '');
  if (name !== REQUIRED_DATABASE) {
    throw new Error(`Browser E2E seeding requires database ${REQUIRED_DATABASE}`);
  }
}

async function retainedPasswordHash(
  plaintext: string,
  existing: ExistingUser | null,
  dependencies: SeederDependencies,
): Promise<string> {
  if (
    existing &&
    await dependencies.verifyPassword(plaintext, existing.password)
  ) {
    return existing.password;
  }
  return dependencies.hashPassword(plaintext);
}

function retainedTwoFactorSecret(
  existing: ExistingUser | null,
): string {
  return existing?.twoFactorSecret === TOTP_SECRET
    ? existing.twoFactorSecret
    : TOTP_SECRET;
}

function userState(password: string, twoFactorSecret: string | null) {
  return {
    password,
    email: null,
    emailVerified: true,
    emailVerifiedAt: null,
    isAdmin: false,
    sessionVersion: 0,
    preferences: {
      selectedNetwork: 'mainnet',
      viewSettings: { wallets: { layout: 'grid' } },
    },
    twoFactorEnabled: twoFactorSecret !== null,
    twoFactorSecret,
    twoFactorBackupCodes: null,
  };
}

async function existingUser(
  prisma: BrowserE2EPrismaClient,
  username: string,
): Promise<ExistingUser | null> {
  return prisma.user.findUnique({
    where: { username },
    select: { id: true, password: true, twoFactorSecret: true },
  });
}

export async function seedBrowserE2EFixtures(
  prisma: BrowserE2EPrismaClient,
  dependencies: SeederDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const [currentUser, currentTwoFactorUser] = await Promise.all([
    existingUser(prisma, BROWSER_E2E_FIXTURES.user.username),
    existingUser(prisma, BROWSER_E2E_FIXTURES.twoFactorUser.username),
  ]);
  const [userPassword, twoFactorPassword] = await Promise.all([
    retainedPasswordHash(
      BROWSER_E2E_FIXTURES.user.password,
      currentUser,
      dependencies,
    ),
    retainedPasswordHash(
      BROWSER_E2E_FIXTURES.twoFactorUser.password,
      currentTwoFactorUser,
      dependencies,
    ),
  ]);
  const twoFactorSecret = retainedTwoFactorSecret(currentTwoFactorUser);

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { username: BROWSER_E2E_FIXTURES.user.username },
      create: {
        username: BROWSER_E2E_FIXTURES.user.username,
        ...userState(userPassword, null),
      },
      update: userState(userPassword, null),
    });
    const twoFactorUser = await transaction.user.upsert({
      where: { username: BROWSER_E2E_FIXTURES.twoFactorUser.username },
      create: {
        username: BROWSER_E2E_FIXTURES.twoFactorUser.username,
        ...userState(twoFactorPassword, twoFactorSecret),
      },
      update: userState(twoFactorPassword, twoFactorSecret),
    });
    const userIds = [user.id, twoFactorUser.id];

    await transaction.systemSetting.deleteMany({
      where: {
        key: { in: userIds.map((id) => `initialPassword_${id}`) },
      },
    });
    await Promise.all([
      transaction.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
      transaction.revokedToken.deleteMany({ where: { userId: { in: userIds } } }),
      transaction.revokedRefreshSessionFamily.deleteMany({
        where: { userId: { in: userIds } },
      }),
    ]);
    await transaction.wallet.upsert({
      where: { id: BROWSER_E2E_FIXTURES.wallet.id },
      create: {
        id: BROWSER_E2E_FIXTURES.wallet.id,
        name: BROWSER_E2E_FIXTURES.wallet.name,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
      },
      update: {
        name: BROWSER_E2E_FIXTURES.wallet.name,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
      },
    });
    await transaction.walletUser.upsert({
      where: {
        walletId_userId: {
          walletId: BROWSER_E2E_FIXTURES.wallet.id,
          userId: user.id,
        },
      },
      create: {
        walletId: BROWSER_E2E_FIXTURES.wallet.id,
        userId: user.id,
        role: 'owner',
      },
      update: { role: 'owner' },
    });
  });
}

async function main(): Promise<void> {
  assertBrowserE2ESeedEnvironment();
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import('../src/generated/prisma/client'),
    import('@prisma/adapter-pg'),
  ]);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    await seedBrowserE2EFixtures(
      prisma as unknown as BrowserE2EPrismaClient,
    );
    process.stdout.write('Browser E2E fixtures are ready\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
