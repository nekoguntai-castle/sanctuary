import { beforeEach, describe, expect, it } from 'vitest';

import {
  mockSessionRepository,
  resetRepositoryMocks,
  seedSessions,
} from '../../mocks/repositories';

describe('repository test mocks', () => {
  beforeEach(() => {
    resetRepositoryMocks();
  });

  it('seeds sessions with explicit values intact', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const lastUsedAt = new Date('2029-12-31T00:00:00.000Z');
    const createdAt = new Date('2029-12-30T00:00:00.000Z');

    seedSessions([
      {
        id: 'session-1',
        userId: 'user-1',
        tokenHash: 'hash-1',
        expiresAt,
        deviceId: 'device-1',
        deviceName: 'Phone',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
        lastUsedAt,
        createdAt,
      },
    ]);

    const sessions = await mockSessionRepository.findByUserId('user-1');

    expect(sessions).toEqual([
      {
        id: 'session-1',
        userId: 'user-1',
        tokenHash: 'hash-1',
        expiresAt,
        deviceId: 'device-1',
        deviceName: 'Phone',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
        lastUsedAt,
        createdAt,
      },
    ]);
  });

  it('seeds sessions with defaults and null nullable fields', async () => {
    seedSessions([{}]);

    const sessions = await mockSessionRepository.findByUserId('test-user-id');

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      id: expect.stringMatching(/^session-/),
      userId: 'test-user-id',
      tokenHash: expect.stringMatching(/^hash-/),
      expiresAt: expect.any(Date),
      deviceId: null,
      deviceName: null,
      userAgent: null,
      ipAddress: null,
      lastUsedAt: expect.any(Date),
      createdAt: expect.any(Date),
    });
  });
});
