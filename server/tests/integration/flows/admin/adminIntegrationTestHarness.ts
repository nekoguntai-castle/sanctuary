import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '../../../../src/generated/prisma/client';
import { extractAuthTokens } from '../../setup/helpers';

export let app: Express;
export let prisma: PrismaClient;

export function setAdminIntegrationContext(nextApp: Express, nextPrisma: PrismaClient): void {
  app = nextApp;
  prisma = nextPrisma;
}

export function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export async function createAdminAndLogin(): Promise<{ adminId: string; token: string }> {
  const username = uniqueUsername('admin');
  const password = 'AdminPass123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.user.create({
    data: {
      username,
      password: hashedPassword,
      email: `${username}@example.com`,
      emailVerified: true,
      isAdmin: true,
    },
  });

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return { adminId: admin.id, token: extractAuthTokens(response).token };
}

export async function createUserAndLogin(): Promise<{ userId: string; token: string; username: string }> {
  const username = uniqueUsername('user');
  const password = 'UserPass123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      username,
      password: hashedPassword,
      email: `${username}@example.com`,
      emailVerified: true,
      isAdmin: false,
    },
  });

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return { userId: user.id, token: extractAuthTokens(response).token, username };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export { request };
