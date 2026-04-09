/**
 * User Repository
 *
 * Abstracts database operations for users.
 */

import prisma from '../models/prisma';
import type { User, Prisma } from '../generated/prisma/client';

/**
 * Find user by ID
 */
export async function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
  });
}

/**
 * Find user by username
 */
export async function findByUsername(username: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { username },
  });
}

/**
 * Find user by email
 */
export async function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email },
  });
}

/**
 * Find all users with summary fields (admin)
 */
export async function findAllSummary() {
  return prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find user by ID with profile fields (includes password for verification)
 */
export async function findByIdWithProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      isAdmin: true,
      preferences: true,
      createdAt: true,
      twoFactorEnabled: true,
      password: true,
    },
  });
}

/**
 * Check if user exists
 */
export async function exists(id: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { id },
  });
  return count > 0;
}

/**
 * Create a new user
 */
export async function create(data: Prisma.UserCreateInput): Promise<User> {
  return prisma.user.create({ data });
}

/**
 * Create a new user with select
 */
export async function createWithSelect<T extends Prisma.UserSelect>(
  data: Prisma.UserCreateInput,
  select: T
) {
  return prisma.user.create({ data, select });
}

/**
 * Update a user
 */
export async function update(
  id: string,
  data: Prisma.UserUpdateInput
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

/**
 * Update a user with select
 */
export async function updateWithSelect<T extends Prisma.UserSelect>(
  id: string,
  data: Prisma.UserUpdateInput,
  select: T
) {
  return prisma.user.update({
    where: { id },
    data,
    select,
  });
}

/**
 * Delete a user by ID
 */
export async function deleteById(id: string): Promise<void> {
  await prisma.user.delete({
    where: { id },
  });
}

/**
 * Update email verification status
 */
export async function updateEmailVerification(
  id: string,
  verified: boolean
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      emailVerified: verified,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}

/**
 * Update user email (triggers need for re-verification)
 */
export async function updateEmail(
  id: string,
  email: string
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      email,
      emailVerified: false,
      emailVerifiedAt: null,
    },
  });
}

/**
 * Update user password
 */
export async function updatePassword(
  id: string,
  hashedPassword: string
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: { password: hashedPassword },
  });
}

/**
 * Update user preferences (merges with existing)
 */
export async function updatePreferences(
  id: string,
  preferences: Prisma.InputJsonValue
) {
  return prisma.user.update({
    where: { id },
    data: { preferences },
    select: {
      id: true,
      username: true,
      email: true,
      isAdmin: true,
      preferences: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
  });
}

/**
 * Search users by username (case-insensitive, limited results)
 */
export async function searchByUsername(query: string, take = 10) {
  return prisma.user.findMany({
    where: {
      username: {
        contains: query,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      username: true,
    },
    take,
  });
}

/**
 * Update 2FA settings
 */
export async function update2FA(
  id: string,
  data: { twoFactorEnabled: boolean; twoFactorSecret?: string | null }
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

/**
 * Check if email is already in use
 */
export async function emailExists(email: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { email },
  });
  return count > 0;
}

// Export as namespace
export const userRepository = {
  findById,
  findByUsername,
  findByEmail,
  findAllSummary,
  findByIdWithProfile,
  exists,
  create,
  createWithSelect,
  update,
  updateWithSelect,
  deleteById,
  updateEmailVerification,
  updateEmail,
  updatePassword,
  updatePreferences,
  searchByUsername,
  update2FA,
  emailExists,
};

export default userRepository;
