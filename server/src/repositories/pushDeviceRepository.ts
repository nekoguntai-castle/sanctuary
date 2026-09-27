/**
 * Push Device Repository
 *
 * Abstracts database operations for push notification devices.
 */

import prisma from '../models/prisma';
import type { PushDevice } from '../generated/prisma/client';

/**
 * Platform types
 */
export type PushPlatform = 'ios' | 'android';

/**
 * Create push device input
 */
export interface CreatePushDeviceInput {
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceName?: string | null;
}

/**
 * Find push device by ID
 */
export async function findById(id: string): Promise<PushDevice | null> {
  return prisma.pushDevice.findUnique({
    where: { id },
  });
}

/**
 * Find push device by token
 */
export async function findByToken(token: string): Promise<PushDevice | null> {
  return prisma.pushDevice.findUnique({
    where: { token },
  });
}

/**
 * Find all push devices for a user
 */
export async function findByUserId(userId: string): Promise<PushDevice[]> {
  return prisma.pushDevice.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all push devices for a user by platform
 */
export async function findByUserIdAndPlatform(
  userId: string,
  platform: PushPlatform
): Promise<PushDevice[]> {
  return prisma.pushDevice.findMany({
    where: { userId, platform },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Count push devices for a user
 */
export async function countByUserId(userId: string): Promise<number> {
  return prisma.pushDevice.count({
    where: { userId },
  });
}

/**
 * Create or update a push device (upsert by token)
 */
export async function upsert(input: CreatePushDeviceInput): Promise<PushDevice> {
  return prisma.pushDevice.upsert({
    where: { token: input.token },
    update: {
      userId: input.userId,
      platform: input.platform,
      deviceName: input.deviceName,
      lastUsedAt: new Date(),
    },
    create: {
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceName: input.deviceName,
    },
  });
}

/**
 * Create a new push device
 */
export async function create(input: CreatePushDeviceInput): Promise<PushDevice> {
  return prisma.pushDevice.create({
    data: {
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceName: input.deviceName,
    },
  });
}

/**
 * Update last used timestamp
 */
export async function updateLastUsed(id: string): Promise<void> {
  await prisma.pushDevice.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  });
}

/**
 * Delete a push device by ID
 */
export async function deleteById(id: string): Promise<void> {
  await prisma.pushDevice.delete({
    where: { id },
  });
}

/**
 * Delete a push device by token
 */
export async function deleteByToken(token: string): Promise<void> {
  await prisma.pushDevice.delete({
    where: { token },
  });
}

/** Delete only the registration still owned by the authenticated user. */
export async function deleteByIdForUser(id: string, userId: string): Promise<number> {
  const result = await prisma.pushDevice.deleteMany({ where: { id, userId } });
  return result.count;
}

/** Token reassignment must not let an old owner's logout delete the new registration. */
export async function deleteByTokenForUser(token: string, userId: string): Promise<number> {
  const result = await prisma.pushDevice.deleteMany({ where: { token, userId } });
  return result.count;
}

/**
 * Delete all push devices for a user
 */
export async function deleteByUserId(userId: string): Promise<number> {
  const result = await prisma.pushDevice.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete stale push devices (not used recently)
 */
export async function deleteStale(olderThan: Date): Promise<number> {
  const result = await prisma.pushDevice.deleteMany({
    where: {
      lastUsedAt: { lt: olderThan },
    },
  });
  return result.count;
}

// Export as namespace
export const pushDeviceRepository = {
  findById,
  findByToken,
  findByUserId,
  findByUserIdAndPlatform,
  countByUserId,
  upsert,
  create,
  updateLastUsed,
  deleteById,
  deleteByToken,
  deleteByIdForUser,
  deleteByTokenForUser,
  deleteByUserId,
  deleteStale,
};

export default pushDeviceRepository;
