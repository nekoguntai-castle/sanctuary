import type { Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '../../../../src/generated/prisma/client';
import {
  WALLET_POLICY_REGISTRY_VERSION,
  findWalletPolicy,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  WalletScriptType,
  WalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import { authHeader, createAndLoginUser, createTestUser, loginTestUser } from '../../setup/helpers';

export const TESTNET_SINGLE_SIG_XPUB = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
export const TESTNET_SINGLE_SIG_RECEIVE = `wpkh([aabbccdd/84'/1'/0']${TESTNET_SINGLE_SIG_XPUB}/0/*)`;
export const TESTNET_SINGLE_SIG_CHANGE = `wpkh([aabbccdd/84'/1'/0']${TESTNET_SINGLE_SIG_XPUB}/1/*)`;

export function canonicalSingleSigDescriptorFields() {
  const policy = findWalletPolicy(WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT);
  if (!policy) throw new Error('Native SegWit single-sig policy fixture is unavailable');
  return {
    descriptor: TESTNET_SINGLE_SIG_RECEIVE,
    changeDescriptor: TESTNET_SINGLE_SIG_CHANGE,
    fingerprint: 'aabbccdd',
    descriptorPolicyVersion: 1,
    descriptorSourceKind: 'generated_pair',
    sourceDescriptor: TESTNET_SINGLE_SIG_RECEIVE,
    sourceChangeDescriptor: TESTNET_SINGLE_SIG_CHANGE,
    canonicalPolicyId: policy.id,
    canonicalPolicyVersion: WALLET_POLICY_REGISTRY_VERSION,
  };
}

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
  const fingerprint = 'aabbccdd';
  const xpub = TESTNET_SINGLE_SIG_XPUB;
  const derivationPath = "m/84'/1'/0'";
  const device = await prisma.device.create({
    data: {
      userId,
      type: 'bitbox',
      label: 'Integration BitBox signer',
      fingerprint,
      xpub,
      derivationPath,
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id,
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath,
      xpub,
    },
  });

  await prisma.walletDevice.create({
    data: {
      walletId,
      deviceId: device.id,
      deviceAccountId: account.id,
      signerIndex: 0,
      signerBindingVersion: 1,
      signerFingerprint: fingerprint,
      signerXpub: xpub,
      signerDerivationPath: derivationPath,
      signerPurpose: 'single_sig',
      signerScriptType: 'native_segwit',
    },
  });
}

export { authHeader, createAndLoginUser, createTestUser, loginTestUser, request };
