import { z } from 'zod';

/** Exact allowlist for the only configuration facts admitted to the shareable profile. */
export const safeConfigProfileSchema = z
  .object({
    environment: z.enum(['development', 'production', 'test']),
    bitcoinNetwork: z.enum(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest']),
    notificationPipeline: z
      .object({
        databaseConfigured: z.boolean(),
        redisConfigured: z.boolean(),
        workerHealthConfigured: z.boolean(),
        electrumSubscriptionsEnabled: z.boolean(),
        telegramFeatureDefaultEnabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type SafeConfigProfile = z.infer<typeof safeConfigProfileSchema>;
