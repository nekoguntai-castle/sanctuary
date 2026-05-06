-- Testnet-family networks can legitimately derive the same address string from
-- the same hardware-wallet account. Keep wallet-local dedupe while allowing the
-- same address string to exist in separate wallet/network scopes.

DROP INDEX IF EXISTS "addresses_address_key";

CREATE INDEX IF NOT EXISTS "addresses_address_idx" ON "addresses"("address");

CREATE UNIQUE INDEX IF NOT EXISTS "addresses_walletId_address_key" ON "addresses"("walletId", "address");
