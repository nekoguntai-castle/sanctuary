/**
 * Aggregate-only database observation for notification eligibility.
 *
 * The SQL performs all joins and de-duplication in PostgreSQL and returns counts
 * only. User, wallet, credential, preference, and relationship rows never cross
 * the repository boundary.
 */
import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';

export interface NotificationEligibilityCounts {
  configuredTelegramUsers: number;
  enabledTelegramUsers: number;
  eligibleReceivedWallets: number;
  eligibleSentWallets: number;
  eligibleDraftWallets: number;
  eligibleConsolidationWallets: number;
  disabledReceivedWallets: number;
  disabledSentWallets: number;
  disabledDraftWallets: number;
  disabledConsolidationWallets: number;
  enabledUsersWithoutWalletSettings: number;
  missingCredentialUsers: number;
  orphanedWalletSettings: number;
}

const QUERY_TIMEOUT_MS = 2_000;

/** Return only aggregate counts derived from current database-backed settings. */
export async function getNotificationEligibilityCounts(): Promise<NotificationEligibilityCounts> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, true)`,
    );
    return tx.$queryRaw<NotificationEligibilityCounts[]>(Prisma.sql`
    WITH telegram_users AS (
      SELECT
        u."id" AS user_id,
        COALESCE(u."preferences"->'telegram'->>'enabled', 'false') = 'true' AS global_enabled,
        NULLIF(u."preferences"->'telegram'->>'botToken', '') IS NOT NULL AS has_token,
        NULLIF(u."preferences"->'telegram'->>'chatId', '') IS NOT NULL AS has_chat,
        CASE
          WHEN jsonb_typeof(u."preferences"->'telegram'->'wallets') = 'object'
          THEN u."preferences"->'telegram'->'wallets'
          ELSE '{}'::jsonb
        END AS wallets
      FROM "users" u
    ), telegram_settings AS (
      SELECT
        users.user_id,
        users.global_enabled,
        users.has_token,
        users.has_chat,
        wallet_setting.key AS wallet_id,
        wallet_setting.value AS setting
      FROM telegram_users users
      CROSS JOIN LATERAL jsonb_each(users.wallets) AS wallet_setting
    ), existing_wallet_settings AS (
      SELECT
        settings.user_id,
        settings.wallet_id,
        settings.global_enabled,
        settings.has_token,
        settings.has_chat,
        settings.setting,
        w."groupId" AS group_id
      FROM telegram_settings settings
      JOIN "wallets" w ON w."id" = settings.wallet_id
    ), candidate_wallet_settings AS (
      SELECT *
      FROM existing_wallet_settings
      WHERE global_enabled AND has_token AND has_chat
        AND COALESCE(setting->>'enabled', 'false') = 'true'
    ), accessible_wallet_settings AS (
      -- Scope both access paths to wallet settings that actually exist, then
      -- UNION to retain exactly one row for a user/wallet reachable both ways.
      SELECT settings.user_id, settings.wallet_id
      FROM candidate_wallet_settings settings
      JOIN "wallet_users" direct_access
        ON direct_access."walletId" = settings.wallet_id
        AND direct_access."userId" = settings.user_id
      UNION
      SELECT settings.user_id, settings.wallet_id
      FROM candidate_wallet_settings settings
      JOIN "group_members" group_access
        ON group_access."groupId" = settings.group_id
        AND group_access."userId" = settings.user_id
    ), settings_diagnostics AS (
      SELECT
        settings.user_id,
        settings.wallet_id,
        settings.global_enabled,
        settings.has_token,
        settings.has_chat,
        settings.setting,
        existing.wallet_id IS NOT NULL AS wallet_exists
      FROM telegram_settings settings
      LEFT JOIN existing_wallet_settings existing
        ON existing.user_id = settings.user_id
        AND existing.wallet_id = settings.wallet_id
    ), wallet_eligibility AS (
      SELECT
        settings.wallet_id,
        BOOL_OR(COALESCE(setting->>'notifyReceived', 'false') = 'true') AS notify_received,
        BOOL_OR(COALESCE(setting->>'notifySent', 'false') = 'true') AS notify_sent,
        BOOL_OR(COALESCE(setting->>'notifyDraft', 'false') = 'true') AS notify_draft,
        BOOL_OR(COALESCE(setting->>'notifyConsolidation', 'false') = 'true') AS notify_consolidation
      FROM candidate_wallet_settings settings
      JOIN accessible_wallet_settings accessible
        ON accessible.user_id = settings.user_id
        AND accessible.wallet_id = settings.wallet_id
      GROUP BY settings.wallet_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM telegram_users WHERE has_token AND has_chat)
        AS "configuredTelegramUsers",
      (SELECT COUNT(*)::int FROM telegram_users WHERE global_enabled)
        AS "enabledTelegramUsers",
      COUNT(*) FILTER (WHERE notify_received)::int AS "eligibleReceivedWallets",
      COUNT(*) FILTER (WHERE notify_sent)::int AS "eligibleSentWallets",
      COUNT(*) FILTER (WHERE notify_draft)::int AS "eligibleDraftWallets",
      COUNT(*) FILTER (WHERE notify_consolidation)::int AS "eligibleConsolidationWallets",
      COUNT(*) FILTER (WHERE NOT notify_received)::int AS "disabledReceivedWallets",
      COUNT(*) FILTER (WHERE NOT notify_sent)::int AS "disabledSentWallets",
      COUNT(*) FILTER (WHERE NOT notify_draft)::int AS "disabledDraftWallets",
      COUNT(*) FILTER (WHERE NOT notify_consolidation)::int AS "disabledConsolidationWallets",
      (
        SELECT COUNT(*)::int FROM telegram_users
        WHERE global_enabled AND wallets = '{}'::jsonb
      ) AS "enabledUsersWithoutWalletSettings",
      (
        SELECT COUNT(*)::int FROM telegram_users
        WHERE global_enabled AND (NOT has_token OR NOT has_chat)
      ) AS "missingCredentialUsers",
      (
        SELECT COUNT(*)::int FROM settings_diagnostics WHERE NOT wallet_exists
      ) AS "orphanedWalletSettings"
    FROM wallet_eligibility
    `);
  }, { timeout: QUERY_TIMEOUT_MS });
  const [row] = rows;

  if (!row) throw new Error('notification_eligibility_unavailable');
  return row;
}
