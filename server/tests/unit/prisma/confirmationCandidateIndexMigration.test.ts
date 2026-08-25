import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260825020000_bound_confirmation_candidate_lookup/migration.sql",
);

describe("bounded confirmation candidate migration", () => {
  it("indexes both height-sensitive candidate predicates before wallet identity", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      'ON "transactions"("confirmations", "walletId")',
    );
    expect(sql).toContain(
      'ON "transactions"("blockHeight", "walletId")',
    );
    expect(sql).toContain('WHERE "blockHeight" IS NOT NULL');
  });
});
