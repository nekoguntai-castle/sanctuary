-- Existing transactions have not proven that every raw non-coinbase input was
-- resolvable. They enter the bounded fair repair rotation until evidence is complete.
ALTER TABLE "transactions"
ADD COLUMN "classificationInputsComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "classificationLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "ioComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ioLastAttemptAt" TIMESTAMP(3);
