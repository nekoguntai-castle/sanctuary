-- Add explicit testnet3 and testnet4 support.
-- Legacy "testnet" rows represent Bitcoin testnet3 and are migrated in place.

ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3Enabled" BOOLEAN DEFAULT false;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3Mode" TEXT DEFAULT 'singleton';
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3SingletonHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3SingletonPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3SingletonSsl" BOOLEAN DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3PoolMin" INTEGER DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3PoolMax" INTEGER DEFAULT 3;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet3PoolLoadBalancing" TEXT DEFAULT 'round_robin';

ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4Enabled" BOOLEAN DEFAULT false;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4Mode" TEXT DEFAULT 'singleton';
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4SingletonHost" TEXT;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4SingletonPort" INTEGER;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4SingletonSsl" BOOLEAN DEFAULT true;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4PoolMin" INTEGER DEFAULT 1;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4PoolMax" INTEGER DEFAULT 3;
ALTER TABLE "node_configs" ADD COLUMN IF NOT EXISTS "testnet4PoolLoadBalancing" TEXT DEFAULT 'round_robin';

UPDATE "wallets"
SET "network" = 'testnet3'
WHERE "network" = 'testnet';

UPDATE "electrum_servers"
SET "network" = 'testnet3'
WHERE "network" = 'testnet';

UPDATE "node_configs"
SET "network" = 'testnet3'
WHERE "network" = 'testnet';

UPDATE "node_configs"
SET
  "testnet3Enabled" = COALESCE("testnetEnabled", false),
  "testnet3Mode" = COALESCE("testnetMode", 'singleton'),
  "testnet3SingletonHost" = COALESCE("testnetSingletonHost", 'electrum.blockstream.info'),
  "testnet3SingletonPort" = COALESCE("testnetSingletonPort", 60002),
  "testnet3SingletonSsl" = COALESCE("testnetSingletonSsl", true),
  "testnet3PoolMin" = COALESCE("testnetPoolMin", 1),
  "testnet3PoolMax" = COALESCE("testnetPoolMax", 3),
  "testnet3PoolLoadBalancing" = COALESCE("testnetPoolLoadBalancing", 'round_robin')
WHERE "testnet3SingletonHost" IS NULL
  AND "testnet3SingletonPort" IS NULL;

UPDATE "node_configs"
SET
  "testnet4Mode" = COALESCE("testnet4Mode", 'singleton'),
  "testnet4SingletonSsl" = COALESCE("testnet4SingletonSsl", true),
  "testnet4PoolMin" = COALESCE("testnet4PoolMin", 1),
  "testnet4PoolMax" = COALESCE("testnet4PoolMax", 3),
  "testnet4PoolLoadBalancing" = COALESCE("testnet4PoolLoadBalancing", 'round_robin')
WHERE "testnet4SingletonHost" IS NULL
  AND "testnet4SingletonPort" IS NULL;
