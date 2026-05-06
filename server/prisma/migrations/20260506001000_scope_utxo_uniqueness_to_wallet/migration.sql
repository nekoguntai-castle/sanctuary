DROP INDEX IF EXISTS "utxos_txid_vout_key";

CREATE INDEX IF NOT EXISTS "utxos_txid_vout_idx" ON "utxos"("txid", "vout");

CREATE UNIQUE INDEX "utxos_walletId_txid_vout_key" ON "utxos"("walletId", "txid", "vout");
