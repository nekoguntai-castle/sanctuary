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

export async function attachNonTargetTestSigner(walletId: string, userId: string): Promise<void> {
  const device = await prisma.device.create({
    data: {
      userId,
      type: 'bitbox',
      label: 'Integration BitBox signer',
      fingerprint: uniqueFingerprint(),
      xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
      derivationPath: "m/84'/1'/0'",
    },
  });

  await prisma.walletDevice.create({
    data: { walletId, deviceId: device.id },
  });
}

export { authHeader, createAndLoginUser, createTestUser, loginTestUser, request };
