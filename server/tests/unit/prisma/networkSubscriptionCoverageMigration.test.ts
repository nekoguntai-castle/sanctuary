import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260823230000_add_network_header_checkpoint/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("network header and subscription coverage migration", () => {
  it("keeps unknown or pending checkpoint rows in an open durable gap", () => {
    expect(migrationSql).toContain(
      'ADD COLUMN "coverageGapStartedAt" TIMESTAMP(3)',
    );
    expect(migrationSql).toContain(
      'SET "coverageGapStartedAt" = address."createdAt"',
    );
    expect(migrationSql).toContain(
      'ALTER COLUMN "coverageGapStartedAt" SET DEFAULT CURRENT_TIMESTAMP',
    );
    expect(migrationSql).toContain(
      '"address_subscription_checkpoints_coverage_gap_check"',
    );
    expect(migrationSql).toContain(
      'CREATE FUNCTION "normalize_address_subscription_coverage_gap"()',
    );
    expect(migrationSql).toContain(
      'BEFORE INSERT OR UPDATE ON "address_subscription_checkpoints"',
    );
    expect(migrationSql).toContain(
      'NEW."coverageGapStartedAt" := CURRENT_TIMESTAMP',
    );
    expect(migrationSql).toContain('NEW."coverageGapStartedAt" := NULL');
    expect(migrationSql).toMatch(
      /"statusKnown" = TRUE[\s\S]+"processedEnrollmentGeneration" = "requestedEnrollmentGeneration"[\s\S]+"coverageGapStartedAt" IS NULL/,
    );
    expect(migrationSql).toMatch(
      /"statusKnown" = FALSE[\s\S]+"processedEnrollmentGeneration" < "requestedEnrollmentGeneration"[\s\S]+"coverageGapStartedAt" IS NOT NULL/,
    );
  });

  it("keys unresolved comparison evidence to an address and bounded generation", () => {
    expect(migrationSql).toContain(
      'CREATE TABLE "address_subscription_comparison_failures"',
    );
    expect(migrationSql).toContain(
      '"address_subscription_failure_generation_bounds_check"',
    );
    expect(migrationSql).toContain(
      'FOREIGN KEY ("addressId") REFERENCES "address_subscription_checkpoints"("addressId")',
    );
    expect(migrationSql).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
  });

  it("persists coherent bounded per-network failure history", () => {
    expect(migrationSql).toContain(
      'CREATE TABLE "network_subscription_coverage_state"',
    );
    expect(migrationSql).toContain(
      '"network_subscription_coverage_count_bounds_check"',
    );
    expect(migrationSql).toContain(
      '"network_subscription_coverage_history_coherence_check"',
    );
    expect(migrationSql).toMatch(
      /"historicalComparisonFailureCount" = 0[\s\S]+"firstComparisonFailureAt" IS NULL[\s\S]+"lastComparisonFailureAt" IS NULL/,
    );
  });

  it("stores header progress and an optional durable unresolved-gap start", () => {
    expect(migrationSql).toContain('CREATE TABLE "network_header_checkpoints"');
    expect(migrationSql).toContain('"coverageGapStartedAt" TIMESTAMP(3)');
    expect(migrationSql).toContain(
      '"network_header_checkpoints_hash_format_check"',
    );
    expect(migrationSql).toContain(
      '"network_header_checkpoints_height_bounds_check"',
    );
  });

  it("applies all related DDL atomically", () => {
    expect(
      migrationSql
        .trimStart()
        .startsWith("-- Durable per-network chain-tip progress."),
    ).toBe(true);
    expect(migrationSql).toMatch(/\nBEGIN;[\s\S]+\nCOMMIT;\s*$/);
  });
});
