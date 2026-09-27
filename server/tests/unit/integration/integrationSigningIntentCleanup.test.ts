import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupTestData as cleanupFlowData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../../integration/setup/testDatabase';
import {
  cleanupTestData as cleanupRepositoryData,
  disconnectTestDatabase,
  getTestPrisma,
} from '../../integration/repositories/setup/database';

const mocks = vi.hoisted(() => {
  const intentIds = new Set<string>();
  const intentDelete = vi.fn(async () => { intentIds.clear(); });
  const intentCreate = vi.fn(async ({ data }: { data: { id: string } }) => {
    if (intentIds.has(data.id)) throw new Error('transaction_signing_intents_pkey');
    intentIds.add(data.id);
    return data;
  });
  const delegate = { deleteMany: vi.fn(async () => undefined), upsert: vi.fn() };
  const client = new Proxy({
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    transactionSigningIntent: { deleteMany: intentDelete, create: intentCreate },
  }, {
    get(target, property) {
      return Reflect.get(target, property) ?? delegate;
    },
  });
  return { client, intentIds, intentDelete, intentCreate };
});

vi.mock('../../../src/generated/prisma/client', () => ({
  PrismaClient: vi.fn(function () { return mocks.client; }),
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn() }));

const helpers = [
  { name: 'flow', setup: setupTestDatabase, cleanup: cleanupFlowData, teardown: teardownTestDatabase },
  { name: 'repository', setup: getTestPrisma, cleanup: cleanupRepositoryData, teardown: disconnectTestDatabase },
];

describe.each(helpers)('$name integration signing-intent cleanup', helper => {
  beforeEach(async () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgresql://test:test@localhost:5432/sanctuary_test');
    mocks.intentIds.clear();
    mocks.intentDelete.mockReset();
    mocks.intentDelete.mockImplementation(async () => { mocks.intentIds.clear(); });
    await helper.setup();
  });

  afterEach(async () => {
    await helper.teardown();
    vi.unstubAllEnvs();
  });

  it('removes stale signing intents so the same fixture ID can be reused', async () => {
    const fixture = { data: { id: 'integration-intent' } };
    await mocks.intentCreate(fixture);
    await expect(mocks.intentCreate(fixture)).rejects.toThrow('transaction_signing_intents_pkey');

    await helper.cleanup();

    expect(mocks.intentIds.size).toBe(0);
    await expect(mocks.intentCreate(fixture)).resolves.toEqual(fixture.data);
    await helper.cleanup();
    await helper.cleanup();
    expect(mocks.intentIds.size).toBe(0);
  });

  it('propagates signing-intent deletion failure instead of reporting clean state', async () => {
    await mocks.intentCreate({ data: { id: 'integration-intent' } });
    const failure = new Error('signing-intent deletion failed');
    mocks.intentDelete.mockRejectedValueOnce(failure);

    await expect(helper.cleanup()).rejects.toBe(failure);
    expect(mocks.intentIds.has('integration-intent')).toBe(true);
  });
});
