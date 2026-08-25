-- Header reconciliation enumerates only transactions whose confirmations can
-- change at the authoritative height. Candidate-first indexes let PostgreSQL
-- satisfy either side of that predicate before wallet-scoped pagination,
-- instead of walking quiet transactions in wallet-ID order.
CREATE INDEX "transactions_confirmation_candidates_idx"
ON "transactions"("confirmations", "walletId");

CREATE INDEX "transactions_height_candidates_idx"
ON "transactions"("blockHeight", "walletId")
WHERE "blockHeight" IS NOT NULL;
