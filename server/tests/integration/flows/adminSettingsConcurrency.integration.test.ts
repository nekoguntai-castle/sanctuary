import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../../src/models/prisma';
import { updateAdminSettings } from '../../../src/services/adminSettingsService';
import * as email from '../../../src/services/email';
import { canRunIntegrationTests, setupTestDatabase, teardownTestDatabase } from '../setup/testDatabase';

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;
const keys = ['confirmationThreshold', 'deepConfirmationThreshold', 'smtp.host', 'smtp.port'];
const originalTransaction = prisma.$transaction.bind(prisma);

/** Pause only the first two snapshot reads, before either transaction writes. */
function overlapFirstSnapshots() {
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; release(); }, 3000);
  vi.spyOn(prisma, '$transaction').mockImplementation((operation, options) => originalTransaction(async tx => {
    const scoped = new Proxy(tx, {
      get(target, property) {
        if (property !== 'systemSetting') return Reflect.get(target, property);
        return new Proxy(target.systemSetting, {
          get(delegate, method) {
            if (method !== 'findMany') return Reflect.get(delegate, method);
            return async (...args: Parameters<typeof delegate.findMany>) => {
              const rows = await delegate.findMany(...args);
              if (arrivals < 2) {
                arrivals += 1;
                if (arrivals === 2) { clearTimeout(timer); release(); }
                await gate;
              }
              return rows;
            };
          },
        });
      },
    });
    return operation(scoped);
  }, options));
  return () => {
    clearTimeout(timer);
    release();
    expect(timedOut).toBe(false);
    expect(arrivals).toBe(2);
  };
}

describeWithDb('Atomic admin settings concurrency', () => {
  beforeAll(async () => { await setupTestDatabase(); });
  afterAll(async () => { await teardownTestDatabase(); });
  beforeEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    await prisma.systemSetting.createMany({ data: [
      { key: 'confirmationThreshold', value: '1' },
      { key: 'deepConfirmationThreshold', value: '12' },
    ] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
  });
  async function thresholds() {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: ['confirmationThreshold', 'deepConfirmationThreshold'] } } });
    const values = Object.fromEntries(rows.map(row => [row.key, Number(row.value)]));
    return [values.confirmationThreshold, values.deepConfirmationThreshold];
  }
  it('commits one complete valid full pair after overlapping snapshots', async () => {
    const release = overlapFirstSnapshots();
    try {
      const outcomes = await Promise.allSettled([
        updateAdminSettings({ confirmationThreshold: 1, deepConfirmationThreshold: 3 }),
        updateAdminSettings({ confirmationThreshold: 6, deepConfirmationThreshold: 12 }),
      ]);
      expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
      expect([[1, 3], [6, 12]]).toContainEqual(await thresholds());
    } finally { release(); }
  });
  it('revalidates incompatible partial updates after a serialization conflict', async () => {
    const release = overlapFirstSnapshots();
    try {
      const outcomes = await Promise.allSettled([
        updateAdminSettings({ confirmationThreshold: 6 }),
        updateAdminSettings({ deepConfirmationThreshold: 3 }),
      ]);
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { statusCode: 400 } });
      const [confirmation, deep] = await thresholds();
      expect(deep).toBeGreaterThanOrEqual(confirmation);
    } finally { release(); }
  });
  it('rolls back an earlier row on a later database write failure without clearing SMTP cache', async () => {
    const clear = vi.spyOn(email, 'clearTransporterCache');
    let writes = 0;
    let firstWriteCompleted = false;
    vi.spyOn(prisma, '$transaction').mockImplementation((operation, options) => originalTransaction(async tx => {
      const scoped = new Proxy(tx, {
        get(target, property) {
          if (property !== 'systemSetting') return Reflect.get(target, property);
          return new Proxy(target.systemSetting, {
            get(delegate, method) {
              if (method !== 'upsert') return Reflect.get(delegate, method);
              return async (...args: Parameters<typeof delegate.upsert>) => {
                writes += 1;
                if (writes === 2) {
                  // A real unique-key failure after the preceding upsert executed.
                  return delegate.create({ data: { key: 'confirmationThreshold', value: '1' } });
                }
                const result = await delegate.upsert(...args);
                firstWriteCompleted = true;
                return result;
              };
            },
          });
        },
      });
      return operation(scoped);
    }, options));
    await expect(updateAdminSettings({ 'smtp.host': 'new-host', 'smtp.port': 2525 })).rejects.toMatchObject({ code: 'P2002' });
    expect(writes).toBe(2);
    expect(firstWriteCompleted).toBe(true);
    expect(await prisma.systemSetting.findUnique({ where: { key: 'smtp.host' } })).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });
});
