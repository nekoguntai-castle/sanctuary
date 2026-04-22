/**
 * Integration Test Helpers
 *
 * Common helper functions for integration tests.
 */

import request from 'supertest';
import { Express } from 'express';
import { PrismaClient } from '../../../src/generated/prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * Generate unique test user credentials
 * Uses timestamp + random suffix to avoid conflicts in parallel tests
 */
function generateUniqueId(): string {
  return `${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function getTestUser() {
  const id = generateUniqueId();
  return {
    username: `testuser_${id}`,
    password: 'TestPassword123!',
    email: `test_${id}@example.com`,
  };
}

export function getTestAdmin() {
  const id = generateUniqueId();
  return {
    username: `admin_${id}`,
    password: 'AdminPassword123!',
    email: `admin_${id}@example.com`,
  };
}

// Legacy exports for backward compatibility (use getTestUser/getTestAdmin instead)
export const TEST_USER = {
  username: 'testuser',
  password: 'TestPassword123!',
  email: 'test@example.com',
};

export const TEST_ADMIN = {
  username: 'admin',
  password: 'AdminPassword123!',
  email: 'admin@example.com',
};

/**
 * Create a test user in the database
 */
export async function createTestUser(
  prisma: PrismaClient,
  user: { username: string; password: string; email?: string; isAdmin?: boolean }
): Promise<{ id: string; username: string }> {
  const hashedPassword = await bcrypt.hash(user.password, 10);

  const created = await prisma.user.create({
    data: {
      username: user.username,
      password: hashedPassword,
      email: user.email ?? `${user.username}@example.com`,
      emailVerified: true, // Auto-verify for tests so login works
      isAdmin: user.isAdmin ?? false,
      preferences: {},
    },
  });

  return { id: created.id, username: created.username };
}

/**
 * Extract access and refresh JWTs from the Set-Cookie header of an auth
 * response.
 *
 * ADR 0001 / 0002 Phase 6: browser auth is cookie-only. The access and
 * refresh JWTs are no longer carried in the response body; they are set
 * as HttpOnly cookies (`sanctuary_access`, `sanctuary_refresh`). Integration
 * tests still want the raw JWTs so they can pass them as `Authorization:
 * Bearer` on subsequent requests (which is the same surface the auth
 * middleware supports, and avoids dealing with CSRF in every test). This
 * helper returns both tokens; callers that only need the access token can
 * destructure.
 */
export function extractAuthTokens(
  response: import('supertest').Response
): { token: string; refreshToken: string } {
  const setCookie = response.headers['set-cookie'];
  const cookies: string[] = Array.isArray(setCookie)
    ? (setCookie as string[])
    : typeof setCookie === 'string'
      ? [setCookie as string]
      : [];
  const accessCookie = cookies.find(c => c.startsWith('sanctuary_access='));
  const refreshCookie = cookies.find(c => c.startsWith('sanctuary_refresh='));
  if (!accessCookie || !refreshCookie) {
    throw new Error(
      'Expected sanctuary_access and sanctuary_refresh Set-Cookie headers on auth response'
    );
  }
  return {
    token: accessCookie.split(';')[0].split('=').slice(1).join('='),
    refreshToken: refreshCookie.split(';')[0].split('=').slice(1).join('='),
  };
}

/**
 * Login and get auth tokens.
 *
 * Returns the access token extracted from the Set-Cookie header. For tests
 * that also need the refresh token, use `loginTestUserWithTokens` below.
 */
export async function loginTestUser(
  app: Express,
  credentials: { username: string; password: string }
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send(credentials)
    .expect(200);

  return extractAuthTokens(response).token;
}

/**
 * Login and return both access and refresh JWTs from the Set-Cookie header.
 */
export async function loginTestUserWithTokens(
  app: Express,
  credentials: { username: string; password: string }
): Promise<{ token: string; refreshToken: string }> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send(credentials)
    .expect(200);

  return extractAuthTokens(response);
}

/**
 * Create a test user and login
 * Uses unique user credentials to avoid conflicts in parallel tests
 */
export async function createAndLoginUser(
  app: Express,
  prisma: PrismaClient,
  user?: { username: string; password: string; isAdmin?: boolean }
): Promise<{ userId: string; token: string }> {
  const testUser = user ?? getTestUser();
  const { id } = await createTestUser(prisma, testUser);
  const token = await loginTestUser(app, testUser);
  return { userId: id, token };
}

/**
 * Create a test wallet
 */
export async function createTestWallet(
  app: Express,
  token: string,
  walletData?: Partial<{
    name: string;
    type: string;
    scriptType: string;
    network: string;
    descriptor: string;
  }>
): Promise<{ id: string; name: string }> {
  const defaultDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)";

  const response = await request(app)
    .post('/api/v1/wallets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: walletData?.name ?? 'Test Wallet',
      type: walletData?.type ?? 'single_sig',
      scriptType: walletData?.scriptType ?? 'native_segwit',
      network: walletData?.network ?? 'testnet',
      descriptor: walletData?.descriptor ?? defaultDescriptor,
    })
    .expect(201);

  return { id: response.body.id, name: response.body.name };
}

/**
 * Auth header helper
 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
