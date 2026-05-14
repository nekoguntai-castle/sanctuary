-- Store account usernames in their canonical lowercase form. The guard fails
-- migration instead of silently merging accounts when legacy rows differ only
-- by case or surrounding whitespace.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "users"
     GROUP BY LOWER(BTRIM("username"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize usernames: case-only or whitespace-only duplicate usernames exist';
  END IF;
END $$;

UPDATE "users"
   SET "username" = LOWER(BTRIM("username")),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "username" <> LOWER(BTRIM("username"));

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique"
    ON "users" (LOWER("username"));
