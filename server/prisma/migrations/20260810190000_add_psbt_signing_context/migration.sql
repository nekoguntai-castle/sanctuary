ALTER TABLE "transaction_signing_intents"
ADD COLUMN "signingContext" JSONB;

ALTER TABLE "draft_transactions"
ADD COLUMN "signingContext" JSONB;
