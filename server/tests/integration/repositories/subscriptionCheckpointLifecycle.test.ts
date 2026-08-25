import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  completeSubscriptionEnrollment,
  findSubscriptionCheckpointOwners,
  requestSubscriptionEnrollment,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const NOW = new Date('2026-08-22T10:00:00.000Z');
const LATER = new Date('2026-08-22T10:05:00.000Z');
const SCRIPT_HASH = 'a'.repeat(64);
const OBSERVED_STATUS = 'b'.repeat(64);
const FAILURE_TRIGGER = 'test_fail_subscription_checkpoint_update_trigger';
const FAILURE_FUNCTION = 'test_fail_subscription_checkpoint_update';

describeWithDatabase('subscription checkpoint lifecycle', () => {
  const userIds: string[] = [];
  const walletIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  async function dropCheckpointFailure(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON "address_subscription_checkpoints"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION}()`);
  }

  afterEach(async () => {
    await dropCheckpointFailure();
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture(network: 'signet' | 'mainnet' = 'signet') {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id);
    return { wallet, address };
  }

  it('coalesces repeated requests into the trigger-created pending slot', async () => {
    const { address } = await createFixture();

    await expect(requestSubscriptionEnrollment(address.id, 'signet')).resolves.toMatchObject({
      status: 'merged',
      state: {
        addressId: address.id,
        network: 'signet',
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      },
    });
    await expect(requestSubscriptionEnrollment(address.id, 'signet')).resolves.toMatchObject({
      status: 'merged',
      state: {
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      },
    });
  });

  it('coalesces concurrent requests after trigger-backed admission', async () => {
    const { address } = await createFixture();

    const requests = await Promise.all(Array.from({ length: 6 }, () => (
      requestSubscriptionEnrollment(address.id, 'signet')
    )));
    expect(requests.filter(result => result.status === 'requested')).toHaveLength(0);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(6);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: expect.objectContaining({
          requestedEnrollmentGeneration: 1,
          processedEnrollmentGeneration: 0,
        }),
      }),
    ]));
  });

  it('validates the supplied network against the owning wallet', async () => {
    const { address } = await createFixture('mainnet');

    await expect(requestSubscriptionEnrollment(address.id, 'signet'))
      .resolves.toEqual({ status: 'not_applied' });
    await expect(prisma.addressSubscriptionCheckpoint.findUnique({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      network: 'mainnet',
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
    });
  });

  it('advances one generation after completion under concurrent requests', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });

    const requests = await Promise.all(Array.from({ length: 6 }, () => (
      requestSubscriptionEnrollment(address.id, 'signet')
    )));
    expect(requests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(5);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: expect.objectContaining({
          requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 1,
        }),
      }),
    ]));
  });

  it('atomically records exact completion evidence with authoritative null status', async () => {
    const { wallet, address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      syncIntent: null,
      state: {
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: NOW,
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 1,
      },
    });
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toMatchObject({ requestedIncrementalSyncGeneration: 0 });
  });

  it('requests exact durable intent for first history and later status changes only', async () => {
    const { wallet, address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');

    const firstHistory = await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    });
    expect(firstHistory).toMatchObject({
      status: 'applied',
      syncIntent: {
        walletId: wallet.id,
        generation: 1,
        state: {
          id: wallet.id,
          requestedIncrementalSyncGeneration: 1,
          syncStateVersion: 1,
        },
      },
    });

    await requestSubscriptionEnrollment(address.id, 'signet');
    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toMatchObject({ status: 'applied', syncIntent: null });

    await requestSubscriptionEnrollment(address.id, 'signet');
    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 3,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: LATER,
    })).resolves.toMatchObject({
      status: 'applied',
      syncIntent: {
        walletId: wallet.id,
        generation: 1,
        state: { requestedIncrementalSyncGeneration: 1 },
      },
    });
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toMatchObject({ requestedIncrementalSyncGeneration: 1 });
  });

  it('keeps checkpoint evidence pending when required wallet intent is exhausted', async () => {
    const { wallet, address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });
    await requestSubscriptionEnrollment(address.id, 'signet');
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedIncrementalSyncGeneration: 2_147_483_647,
        claimedIncrementalSyncGeneration: 2_147_483_647,
        processedIncrementalSyncGeneration: 2_147_483_647,
      },
    });

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toEqual({ status: 'generation_exhausted' });
    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      observedStatus: null,
      processedEnrollmentGeneration: 1,
      requestedEnrollmentGeneration: 2,
    });
  });

  it('rolls back durable intent when checkpoint persistence fails', async () => {
    const { wallet, address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await dropCheckpointFailure();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${FAILURE_FUNCTION}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."addressId" = '${address.id}' THEN
          RAISE EXCEPTION 'forced subscription checkpoint failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${FAILURE_TRIGGER}
      BEFORE UPDATE ON "address_subscription_checkpoints"
      FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION}()
    `);

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    })).rejects.toThrow('forced subscription checkpoint failure');
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toMatchObject({
        requestedIncrementalSyncGeneration: 0,
        syncStateVersion: 0,
      });
    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      statusKnown: false,
      observedStatus: null,
      processedEnrollmentGeneration: 0,
    });
  });

  it('returns every enrolled owner of the exact network and script hash', async () => {
    const first = await createFixture();
    const second = await createFixture();
    const sharedAddress = first.address.address;
    await prisma.address.update({
      where: { id: second.address.id },
      data: { address: sharedAddress },
    });
    for (const address of [first.address, { ...second.address, address: sharedAddress }]) {
      await requestSubscriptionEnrollment(address.id, 'signet');
      await completeSubscriptionEnrollment({
        addressId: address.id,
        address: sharedAddress,
        network: 'signet',
        generation: 1,
        scriptHash: SCRIPT_HASH,
        observedStatus: null,
        observedAt: NOW,
      });
    }

    await expect(findSubscriptionCheckpointOwners('signet', SCRIPT_HASH))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ addressId: first.address.id, walletId: first.wallet.id }),
        expect.objectContaining({ addressId: second.address.id, walletId: second.wallet.id }),
      ]));
    expect(await findSubscriptionCheckpointOwners('signet', SCRIPT_HASH)).toHaveLength(2);
  });

  it('completes the trigger-created first generation', async () => {
    const { address } = await createFixture();

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
    await expect(prisma.addressSubscriptionCheckpoint.findUnique({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      network: 'signet',
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 0,
      statusKnown: false,
    });

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      state: {
        addressId: address.id,
        statusKnown: true,
        observedStatus: null,
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 1,
      },
    });
  });

  it('allows exactly one concurrent completion of a pending generation', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    const input = {
      addressId: address.id,
      address: address.address,
      network: 'signet' as const,
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    };

    const completions = await Promise.all(Array.from({ length: 5 }, () => (
      completeSubscriptionEnrollment(input)
    )));
    expect(completions.filter(result => result.status === 'applied')).toHaveLength(1);
    expect(completions.filter(result => result.status === 'not_applied')).toHaveLength(4);
  });

  it('rolls back losing intent when mixed first observations race on a missing row', async () => {
    for (let iteration = 0; iteration < 8; iteration++) {
      const { wallet, address } = await createFixture();
      const base = {
        addressId: address.id,
        address: address.address,
        network: 'signet' as const,
        generation: 1,
        scriptHash: SCRIPT_HASH,
        observedAt: NOW,
      };
      const completions = await Promise.all([
        completeSubscriptionEnrollment({ ...base, observedStatus: null }),
        completeSubscriptionEnrollment({ ...base, observedStatus: OBSERVED_STATUS }),
      ]);
      const applied = completions.filter(result => result.status === 'applied');
      expect(applied).toHaveLength(1);

      const checkpoint = await prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
        where: { addressId: address.id },
      });
      const durableWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const winningStatus = applied[0].status === 'applied'
        ? applied[0].state.observedStatus
        : undefined;
      expect(checkpoint.observedStatus).toBe(winningStatus);
      expect(durableWallet.requestedIncrementalSyncGeneration)
        .toBe(winningStatus === null ? 0 : 1);
    }
  });

  it('atomically coalesces concurrent address changes into one wallet generation', async () => {
    const { wallet, address: first } = await createFixture();
    const second = await createTestAddress(factoryClient, wallet.id);
    await Promise.all([
      requestSubscriptionEnrollment(first.id, 'signet'),
      requestSubscriptionEnrollment(second.id, 'signet'),
    ]);

    const completions = await Promise.all([first, second].map(address => (
      completeSubscriptionEnrollment({
        addressId: address.id,
        address: address.address,
        network: 'signet',
        generation: 1,
        scriptHash: address.id === first.id ? SCRIPT_HASH : 'c'.repeat(64),
        observedStatus: OBSERVED_STATUS,
        observedAt: NOW,
      })
    )));

    expect(completions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'applied',
        syncIntent: expect.objectContaining({ walletId: wallet.id, generation: 1 }),
      }),
    ]));
    expect(completions.every(result => (
      result.status === 'applied' && result.syncIntent?.generation === 1
    ))).toBe(true);
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toMatchObject({ requestedIncrementalSyncGeneration: 1 });
  });

  it('does not apply stale generations or evidence derived from a replaced address', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });
    await requestSubscriptionEnrollment(address.id, 'signet');

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toEqual({ status: 'not_applied' });

    await prisma.address.update({
      where: { id: address.id },
      data: { address: `${address.address}-replacement` },
    });
    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toEqual({ status: 'not_applied' });

    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      processedEnrollmentGeneration: 1,
      observedStatus: null,
      lastObservedAt: NOW,
    });
  });

  it('fails closed at the maximum enrollment generation', async () => {
    const { address } = await createFixture();
    await prisma.addressSubscriptionCheckpoint.update({
      where: { addressId: address.id },
      data: {
        scriptHash: SCRIPT_HASH,
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: NOW,
        requestedEnrollmentGeneration: 2_147_483_647,
        processedEnrollmentGeneration: 2_147_483_647,
        coverageGapStartedAt: null,
      },
    });

    await expect(requestSubscriptionEnrollment(address.id, 'signet'))
      .resolves.toEqual({ status: 'generation_exhausted' });
    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      requestedEnrollmentGeneration: 2_147_483_647,
      processedEnrollmentGeneration: 2_147_483_647,
    });
  });
});
