import type { Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '../../../../src/generated/prisma/client';
import { authHeader, createAndLoginUser, createTestUser, loginTestUser } from '../../setup/helpers';

export let app: Express;
export let prisma: PrismaClient;

export function setWalletIntegrationContext(nextApp: Express, nextPrisma: PrismaClient): void {
  app = nextApp;
  prisma = nextPrisma;
}

export function uniqueUsername(role: string): string {
  return `${role}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function uniqueFingerprint(): string {
  return Math.random().toString(16).substring(2, 10).padEnd(8, '0');
}

export { authHeader, createAndLoginUser, createTestUser, loginTestUser, request };
