-- Fence refresh-session writers while legacy rows are invalidated and the
-- access-token lineage contract becomes mandatory.
BEGIN;

LOCK TABLE "refresh_tokens" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "accessTokenJti" TEXT,
  ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sessionFamilyId" TEXT;

UPDATE "users" AS u
SET "sessionVersion" = u."sessionVersion" + 1
WHERE EXISTS (
  SELECT 1
  FROM "refresh_tokens" AS rt
  WHERE rt."userId" = u."id"
    AND (
      rt."accessTokenJti" IS NULL
      OR rt."accessTokenExpiresAt" IS NULL
      OR rt."sessionFamilyId" IS NULL
    )
);

DELETE FROM "refresh_tokens"
WHERE "accessTokenJti" IS NULL
   OR "accessTokenExpiresAt" IS NULL
   OR "sessionFamilyId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "refresh_tokens"
    WHERE "accessTokenJti" IS NULL
       OR "accessTokenExpiresAt" IS NULL
       OR "sessionFamilyId" IS NULL
  ) THEN
    RAISE EXCEPTION 'refresh token lineage backfill incomplete';
  END IF;
END $$;

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "accessTokenJti" SET NOT NULL,
  ALTER COLUMN "accessTokenExpiresAt" SET NOT NULL,
  ALTER COLUMN "sessionFamilyId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "refresh_tokens_sessionFamilyId_idx"
  ON "refresh_tokens"("sessionFamilyId");

CREATE TABLE IF NOT EXISTS "revoked_refresh_session_families" (
  "sessionFamilyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "revoked_refresh_session_families_pkey" PRIMARY KEY ("sessionFamilyId")
);

CREATE INDEX IF NOT EXISTS "revoked_refresh_session_families_expiresAt_idx"
  ON "revoked_refresh_session_families"("expiresAt");
CREATE INDEX IF NOT EXISTS "revoked_refresh_session_families_userId_idx"
  ON "revoked_refresh_session_families"("userId");

COMMIT;
