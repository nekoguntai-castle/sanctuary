-- AlterTable
ALTER TABLE "wallets"
ADD COLUMN "requestedFullResyncGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processedFullResyncGeneration" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "wallets_full_resync_generation_bounds_check"
CHECK (
  0 <= "processedFullResyncGeneration"
  AND "processedFullResyncGeneration" <= "requestedFullResyncGeneration"
  AND "requestedFullResyncGeneration" <= 2147483647
);
