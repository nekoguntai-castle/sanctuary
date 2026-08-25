import { z } from 'zod';
import prisma, { type PrismaTxClient } from '../models/prisma';
import { safeJsonParse } from '../utils/safeJson';
import { STALE_WALLET_SCHEDULE_FORBIDDEN_KEY } from './operationalSystemSettings';
import { WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR } from '../constants/walletSyncActivation';

// Floor 2 means every worker understands the v2 reader/pre-lock retirement
// contract. It is a deployment compatibility level, not a wire-version switch:
// producers intentionally remain on sync job contract v1 in this precursor.
export const WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR =
  WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR;

const staleWalletScheduleTombstoneSchema = z.object({
  version: z.literal(1),
  forbiddenAt: z.iso.datetime({ offset: true }),
  compatibilityFloor: z.literal(WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR),
}).strict();

export interface StaleWalletScheduleTombstone {
  version: 1;
  forbiddenAt: string;
  compatibilityFloor: typeof WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR;
}

export type StaleWalletSchedulePolicy =
  | { mode: 'legacy_enabled' }
  | { mode: 'forbidden'; tombstone: StaleWalletScheduleTombstone };

export function parseStaleWalletScheduleTombstone(
  value: string,
): StaleWalletScheduleTombstone {
  const parsed = safeJsonParse(
    value,
    staleWalletScheduleTombstoneSchema.nullable(),
    null,
    STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  );
  if (parsed === null) {
    throw new Error('Invalid durable stale-wallet schedule tombstone');
  }
  return parsed;
}

type SchedulePolicyClient = Pick<PrismaTxClient, 'systemSetting'>;

export async function readStaleWalletSchedulePolicyWithClient(
  client: SchedulePolicyClient,
): Promise<StaleWalletSchedulePolicy> {
  const setting = await client.systemSetting.findUnique({
    where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
    select: { value: true },
  });
  if (setting === null) return { mode: 'legacy_enabled' };
  return {
    mode: 'forbidden',
    tombstone: parseStaleWalletScheduleTombstone(setting.value),
  };
}

export async function readStaleWalletSchedulePolicy(): Promise<StaleWalletSchedulePolicy> {
  return readStaleWalletSchedulePolicyWithClient(prisma);
}

/**
 * Permanently establish the rollback floor used by the later scheduler cutover.
 * The precursor ships this create-once writer but deliberately never calls it.
 */
export async function forbidStaleWalletScheduleWithClient(
  client: SchedulePolicyClient,
  forbiddenAt = new Date(),
): Promise<StaleWalletScheduleTombstone> {
  if (Number.isNaN(forbiddenAt.getTime())) {
    throw new Error('Stale-wallet schedule tombstone requires a valid timestamp');
  }
  const tombstone: StaleWalletScheduleTombstone = {
    version: 1,
    forbiddenAt: forbiddenAt.toISOString(),
    compatibilityFloor: WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR,
  };
  const setting = await client.systemSetting.upsert({
    where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
    create: {
      key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
      value: JSON.stringify(tombstone),
    },
    update: {},
    select: { value: true },
  });
  return parseStaleWalletScheduleTombstone(setting.value);
}


export async function forbidStaleWalletSchedule(
  forbiddenAt = new Date(),
): Promise<StaleWalletScheduleTombstone> {
  return forbidStaleWalletScheduleWithClient(prisma, forbiddenAt);
}

export const walletSyncSchedulePolicyRepository = {
  read: readStaleWalletSchedulePolicy,
  forbid: forbidStaleWalletSchedule,
};

export default walletSyncSchedulePolicyRepository;
