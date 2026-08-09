import { describe, expect, it } from 'vitest';
import type { RefreshToken } from '../../../src/generated/prisma/client';
import type { PrismaTxClient } from '../../../src/models/prisma';
import { consumeAndReplaceRefreshTokenWithClient } from '../../../src/repositories/sessionRefreshTokenRotation';
import {
  revokeLogoutCredentialsWithClient,
  revokeSessionByIdWithClient,
} from '../../../src/repositories/sessionRevocationTransactions';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function createMutex(): { acquire: () => Promise<() => void> } {
  let tail = Promise.resolve();
  return {
    acquire: async () => {
      const previous = tail;
      const release = deferred();
      tail = previous.then(() => release.promise);
      await previous;
      return release.resolve;
    },
  };
}

function makeSession(): RefreshToken {
  return {
    id: 'session-id',
    userId: 'user-id',
    tokenHash: 'old-hash',
    sessionFamilyId: 'family-id',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    accessTokenJti: 'old-access-jti',
    accessTokenExpiresAt: new Date('2030-01-01T00:00:00Z'),
    userAgent: null,
    ipAddress: null,
    deviceId: null,
    deviceName: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function createStore(hooks: {
  beforeRotateUpdate?: () => Promise<void>;
  beforeLogoutDelete?: () => Promise<void>;
}) {
  let session: RefreshToken | null = makeSession();
  let tombstoned = false;
  const mutex = createMutex();

  const run = async <T>(operation: (tx: PrismaTxClient) => Promise<T>): Promise<T> => {
    let release: (() => void) | undefined;
    const tx = {
      $executeRaw: async () => {
        release = await mutex.acquire();
        return 1;
      },
      refreshToken: {
        findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
          if (!session) return null;
          if (where.tokenHash && session.tokenHash !== where.tokenHash) return null;
          if (where.id && session.id !== where.id) return null;
          return { ...session };
        },
        findFirst: async () => session ? { id: session.id, expiresAt: session.expiresAt } : null,
        updateMany: async ({ data }: { data: Partial<RefreshToken> }) => {
          await hooks.beforeRotateUpdate?.();
          if (!session || session.tokenHash !== 'old-hash') return { count: 0 };
          session = { ...session, ...data };
          return { count: 1 };
        },
        deleteMany: async () => {
          await hooks.beforeLogoutDelete?.();
          if (!session) return { count: 0 };
          session = null;
          return { count: 1 };
        },
      },
      revokedToken: { upsert: async () => ({}) },
      revokedRefreshSessionFamily: {
        findUnique: async () => tombstoned ? { sessionFamilyId: 'family-id' } : null,
        upsert: async () => { tombstoned = true; return {}; },
      },
    } as unknown as PrismaTxClient;
    try {
      return await operation(tx);
    } finally {
      release?.();
    }
  };

  return {
    run,
    snapshot: () => ({ session, tombstoned }),
  };
}

const rotationInput = {
  oldToken: 'old-token',
  expectedUserId: 'user-id',
  newToken: 'new-token',
  expiresAt: new Date('2030-01-02T00:00:00Z'),
  accessTokenJti: 'new-access-jti',
  accessTokenExpiresAt: new Date('2030-01-01T01:00:00Z'),
  sessionFamilyId: 'family-id',
};

const logoutInput = {
  userId: 'user-id',
  accessTokenJti: 'logout-access-jti',
  accessTokenExpiresAt: new Date('2030-01-01T01:00:00Z'),
  refreshTokenHash: 'old-hash',
  refreshSessionFamilyId: 'family-id',
  refreshTokenExpiresAt: new Date('2030-01-01T00:00:00Z'),
};

describe('refresh session family concurrency', () => {
  it('lets logout follow and revoke a successor created by an in-flight rotation', async () => {
    const rotationEntered = deferred();
    const releaseRotation = deferred();
    const store = createStore({
      beforeRotateUpdate: async () => {
        rotationEntered.resolve();
        await releaseRotation.promise;
      },
    });

    const rotation = store.run(tx => consumeAndReplaceRefreshTokenWithClient(tx, rotationInput, {
      oldTokenHash: 'old-hash',
      newTokenHash: 'new-hash',
      now: new Date('2026-01-01T00:00:00Z'),
    }));
    await rotationEntered.promise;
    const logout = store.run(tx => revokeLogoutCredentialsWithClient(
      tx,
      logoutInput,
      new Date('2026-01-01T00:00:01Z')
    ));
    releaseRotation.resolve();

    await expect(rotation).resolves.toMatchObject({ status: 'rotated' });
    await expect(logout).resolves.toBe('revoked');
    expect(store.snapshot()).toEqual({ session: null, tombstoned: true });
  });

  it('makes a rotation wait for logout and reject the tombstoned family', async () => {
    const logoutEntered = deferred();
    const releaseLogout = deferred();
    const store = createStore({
      beforeLogoutDelete: async () => {
        logoutEntered.resolve();
        await releaseLogout.promise;
      },
    });

    const logout = store.run(tx => revokeLogoutCredentialsWithClient(
      tx,
      logoutInput,
      new Date('2026-01-01T00:00:00Z')
    ));
    await logoutEntered.promise;
    const rotation = store.run(tx => consumeAndReplaceRefreshTokenWithClient(tx, rotationInput, {
      oldTokenHash: 'old-hash',
      newTokenHash: 'new-hash',
      now: new Date('2026-01-01T00:00:01Z'),
    }));
    releaseLogout.resolve();

    await expect(logout).resolves.toBe('revoked');
    await expect(rotation).resolves.toEqual({ status: 'terminal' });
    expect(store.snapshot()).toEqual({ session: null, tombstoned: true });
  });

  it('classifies a lost conditional rotation according to whether a successor remains', async () => {
    async function rotateAfterConditionalLoss(successorExists: boolean) {
      const tx = {
        $executeRaw: async () => 1,
        refreshToken: {
          findUnique: async () => makeSession(),
          findFirst: async () => successorExists ? { id: 'successor-id' } : null,
          updateMany: async () => ({ count: 0 }),
        },
        revokedToken: { upsert: async () => ({}) },
        revokedRefreshSessionFamily: { findUnique: async () => null },
      } as unknown as PrismaTxClient;

      return consumeAndReplaceRefreshTokenWithClient(tx, rotationInput, {
        oldTokenHash: 'old-hash',
        newTokenHash: 'new-hash',
        now: new Date('2026-01-01T00:00:00Z'),
      });
    }

    await expect(rotateAfterConditionalLoss(true)).resolves.toEqual({ status: 'superseded' });
    await expect(rotateAfterConditionalLoss(false)).resolves.toEqual({ status: 'terminal' });
  });

  it('returns no lineage when a targeted session disappears after acquiring its family lock', async () => {
    let reads = 0;
    const tx = {
      $executeRaw: async () => 1,
      refreshToken: {
        findUnique: async () => {
          reads += 1;
          return reads === 1 ? makeSession() : null;
        },
      },
    } as unknown as PrismaTxClient;

    await expect(revokeSessionByIdWithClient(
      tx,
      'session-id',
      'user-id',
      new Date('2026-01-01T00:00:00Z')
    )).resolves.toBeNull();
  });

  it('surfaces a targeted-revocation deletion invariant failure after tombstoning the family', async () => {
    const session = makeSession();
    const tx = {
      $executeRaw: async () => 1,
      refreshToken: {
        findUnique: async () => session,
        deleteMany: async () => ({ count: 0 }),
      },
      revokedRefreshSessionFamily: { upsert: async () => ({}) },
      revokedToken: { upsert: async () => ({}) },
    } as unknown as PrismaTxClient;

    await expect(revokeSessionByIdWithClient(
      tx,
      session.id,
      session.userId,
      new Date('2026-01-01T00:00:00Z')
    )).rejects.toThrow('Refresh session family deletion invariant violated');
  });
});
