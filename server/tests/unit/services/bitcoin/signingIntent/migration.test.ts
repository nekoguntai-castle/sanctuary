import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transaction signing intent migration', () => {
  it('creates durable digest-bound intent storage and draft bindings', () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      'prisma/migrations/20260810170000_add_transaction_signing_intents/migration.sql',
    ), 'utf8');
    expect(sql).toContain('CREATE TABLE "transaction_signing_intents"');
    expect(sql).toContain('"snapshotDigest" TEXT NOT NULL');
    expect(sql).toContain('"unsignedPsbtSha256" TEXT NOT NULL');
    expect(sql).toContain('ADD COLUMN "signingIntentId" TEXT');
    expect(sql).toContain('ADD COLUMN "signingIntentDigest" TEXT');
    expect(sql).toContain('CONSTRAINT "transaction_signing_intents_snapshot_digest_check"');
    expect(sql).toContain('CREATE FUNCTION "protect_transaction_signing_intent_snapshot"()');
  });

  it('constrains every durable broadcast lifecycle state', () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      'prisma/migrations/20260810180000_add_signing_intent_broadcast_claims/migration.sql',
    ), 'utf8');
    expect(sql).toContain('CONSTRAINT "transaction_signing_intents_broadcast_state_check"');
    for (const state of ['ready', 'claimed', 'unknown', 'accepted', 'complete']) {
      expect(sql).toContain(`"broadcastState" = '${state}'`);
    }
    expect(sql).toContain('CONSTRAINT "transaction_signing_intents_broadcast_raw_tx_check"');
  });
});
