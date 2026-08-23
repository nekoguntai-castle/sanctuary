import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkpointFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    addressSubscriptionCheckpoint: { findUnique: mocks.checkpointFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

import {
  completeSubscriptionEnrollment,
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpoint,
  requestSubscriptionEnrollment,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import type { SubscriptionCheckpointState } from '../../../src/repositories/types';

const NOW = new Date('2026-08-22T10:00:00.000Z');
const SCRIPT_HASH = 'a'.repeat(64);
const OBSERVED_STATUS = 'b'.repeat(64);

function checkpointState(
  overrides: Partial<SubscriptionCheckpointState> = {},
): SubscriptionCheckpointState {
  return {
    addressId: 'address-1',
    network: 'signet',
    scriptHash: null,
    statusKnown: false,
    observedStatus: null,
    lastObservedAt: null,
    requestedEnrollmentGeneration: 1,
    processedEnrollmentGeneration: 0,
    ...overrides,
  };
}

describe('subscriptionCheckpointRepository readers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves statusKnown separately from a nullable observed status', async () => {
    mocks.checkpointFindUnique.mockResolvedValue({
      addressId: 'address-1',
      statusKnown: true,
      observedStatus: null,
    });
    await expect(findSubscriptionCheckpoint('address-1')).resolves.toMatchObject({
      statusKnown: true,
      observedStatus: null,
    });
    expect(mocks.checkpointFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { addressId: 'address-1' },
      select: expect.objectContaining({ statusKnown: true, observedStatus: true }),
    }));
  });

  it('includes checkpoint rows missing from mixed-version address writes', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(findPendingSubscriptionEnrollments({
      network: 'signet',
      cursor: 'address-4',
      limit: 12,
    })).resolves.toEqual([]);

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(['address-4', 'signet', 12]));
    expect(query.strings.join('')).toContain('"checkpoints"."addressId" IS NULL');
    expect(query.strings.join('')).toContain(
      '"requestedEnrollmentGeneration" > "checkpoints"."processedEnrollmentGeneration"',
    );
  });

  it('uses bounded defaults for the first enrollment page', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await findPendingSubscriptionEnrollments({ network: 'mainnet' });

    expect(mocks.queryRaw.mock.calls[0][0].values)
      .toEqual(expect.arrayContaining(['', 'mainnet', 200]));
  });

  it.each([0, -3, 2.5])('rejects invalid enrollment limit %s', async (limit) => {
    await expect(findPendingSubscriptionEnrollments({
      network: 'mainnet',
      limit,
    })).rejects.toThrow('positive integer');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('requests one pending generation and coalesces a repeated request', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{
        ...checkpointState(),
        inserted: true,
        previousRequestedGeneration: null,
      }])
      .mockResolvedValueOnce([{
        ...checkpointState(),
        inserted: false,
        previousRequestedGeneration: 1,
      }]);

    await expect(requestSubscriptionEnrollment('address-1', 'signet')).resolves.toMatchObject({
      status: 'requested',
      state: { requestedEnrollmentGeneration: 1 },
    });
    await expect(requestSubscriptionEnrollment('address-1', 'signet')).resolves.toMatchObject({
      status: 'merged',
      state: { requestedEnrollmentGeneration: 1 },
    });

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.strings.join('')).toContain('GREATEST');
    expect(query.strings.join('')).toContain('(xmax = 0)');
    expect(query.strings.join('')).toContain('"wallets"."network" = ');
    expect(query.values).toContain(2_147_483_647);
  });

  it('fails closed when the enrollment generation is exhausted', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.checkpointFindUnique.mockResolvedValue(checkpointState({
      requestedEnrollmentGeneration: 2_147_483_647,
      processedEnrollmentGeneration: 2_147_483_647,
    }));

    await expect(requestSubscriptionEnrollment('address-1', 'signet'))
      .resolves.toEqual({ status: 'generation_exhausted' });
  });

  it('does not apply a request when the address or owning network is unavailable', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.checkpointFindUnique.mockResolvedValue(null);

    await expect(requestSubscriptionEnrollment('address-1', 'signet'))
      .resolves.toEqual({ status: 'not_applied' });
  });

  it.each([
    ['', 'signet', 'address ID'],
    ['address-1', 'testnet', 'network'],
  ] as const)('rejects invalid request identity %#', async (addressId, network, message) => {
    await expect(requestSubscriptionEnrollment(addressId, network as 'signet'))
      .rejects.toThrow(message);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('atomically completes the exact generation for the unchanged address', async () => {
    const completed = checkpointState({
      scriptHash: SCRIPT_HASH,
      statusKnown: true,
      observedStatus: OBSERVED_STATUS,
      lastObservedAt: NOW,
      processedEnrollmentGeneration: 1,
    });
    mocks.queryRaw.mockResolvedValue([completed]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'applied', state: completed });

    const query = mocks.queryRaw.mock.calls[0][0];
    const sql = query.strings.join('');
    expect(sql).toContain('INSERT INTO "address_subscription_checkpoints"');
    expect(sql).toContain('ON CONFLICT ("addressId") DO NOTHING');
    expect(sql).toContain('"addresses"."address" = ');
    expect(sql).toContain('"wallets"."network" = ');
    expect(sql).toContain('"requestedEnrollmentGeneration" = ');
    expect(sql).toContain('"processedEnrollmentGeneration" < ');
    expect(query.values).toEqual(expect.arrayContaining([
      'address-1',
      'tb1qexample',
      'signet',
      1,
      SCRIPT_HASH,
      OBSERVED_STATUS,
      NOW,
    ]));
  });

  it('reports stale or concurrent completion as not applied', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
  });

  it.each([
    [{ generation: 0 }, 'generation'],
    [{ scriptHash: 'A'.repeat(64) }, 'script hash'],
    [{ observedStatus: 'not-a-status' }, 'observed status'],
    [{ observedAt: new Date('invalid') }, 'valid date'],
    [{ address: ' ' }, 'address must be non-empty'],
  ])('rejects invalid completion evidence %#', async (override, message) => {
    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
      ...override,
    })).rejects.toThrow(message as string);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
