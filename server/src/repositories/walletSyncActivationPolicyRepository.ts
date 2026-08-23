import { z } from 'zod';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';
import prisma from '../models/prisma';
import { safeJsonParse } from '../utils/safeJson';
import { WALLET_SYNC_ACTIVATION_KEY } from './operationalSystemSettings';

const walletSyncActivationSchema = z
  .object({
    version: z.literal(1),
    activatedAt: z.iso.datetime({ offset: true }),
    mutationFenceFloor: z.number().int().min(1),
  })
  .strict();

export interface WalletSyncActivation {
  version: 1;
  activatedAt: string;
  mutationFenceFloor: number;
}

export type WalletSyncActivationPolicy =
  { mode: 'dormant' } | { mode: 'active'; activation: WalletSyncActivation };

export function parseWalletSyncActivation(value: string): WalletSyncActivation {
  const parsed = safeJsonParse(
    value,
    walletSyncActivationSchema.nullable(),
    null,
    WALLET_SYNC_ACTIVATION_KEY,
  );
  if (parsed === null) {
    throw new Error('Invalid durable wallet-sync activation policy');
  }
  return parsed;
}

/** Refuse activation written by a fleet with a newer mutation-fence contract. */
export function assertCurrentBinarySupportsWalletSyncActivation(
  activation: WalletSyncActivation,
): void {
  if (activation.mutationFenceFloor > WALLET_SYNC_MUTATION_FENCE_FLOOR) {
    throw new Error(
      'Wallet-sync activation requires mutation-fence floor ' +
        `${activation.mutationFenceFloor}; current binary supports ` +
        WALLET_SYNC_MUTATION_FENCE_FLOOR,
    );
  }
}

export async function readWalletSyncActivationPolicy(): Promise<WalletSyncActivationPolicy> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: WALLET_SYNC_ACTIVATION_KEY },
    select: { value: true },
  });
  if (setting === null) return { mode: 'dormant' };
  const activation = parseWalletSyncActivation(setting.value);
  assertCurrentBinarySupportsWalletSyncActivation(activation);
  return { mode: 'active', activation };
}

/**
 * Permanently establish the fleet-wide activation floor. The create-only
 * upsert makes the first committed activation timestamp and floor immutable.
 * This repository deliberately has no production caller yet.
 */
export async function activateWalletSync(activatedAt = new Date()): Promise<WalletSyncActivation> {
  if (Number.isNaN(activatedAt.getTime())) {
    throw new Error('Wallet-sync activation requires a valid timestamp');
  }
  const activation: WalletSyncActivation = {
    version: 1,
    activatedAt: activatedAt.toISOString(),
    mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  };
  const setting = await prisma.systemSetting.upsert({
    where: { key: WALLET_SYNC_ACTIVATION_KEY },
    create: {
      key: WALLET_SYNC_ACTIVATION_KEY,
      value: JSON.stringify(activation),
    },
    update: {},
    select: { value: true },
  });
  const stored = parseWalletSyncActivation(setting.value);
  assertCurrentBinarySupportsWalletSyncActivation(stored);
  return stored;
}

export const walletSyncActivationPolicyRepository = {
  read: readWalletSyncActivationPolicy,
  activate: activateWalletSync,
};

export default walletSyncActivationPolicyRepository;
