import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(join(
  process.cwd(),
  'prisma/migrations/20260731000000_redact_webhook_delivery_headers/migration.sql',
), 'utf8');

describe('webhook delivery header redaction migration', () => {
  it('redacts every object value and fails closed for malformed JSON shapes', () => {
    expect(migrationSql).toContain('jsonb_each(delivery."requestHeadersRedacted")');
    expect(migrationSql).toContain("to_jsonb('[REDACTED]'::text)");
    expect(migrationSql).toContain("jsonb_typeof(delivery.\"requestHeadersRedacted\") = 'object'");
    expect(migrationSql).toMatch(/ELSE\s+NULL/);
  });

  it('is idempotent because it derives output only from existing header names', () => {
    expect(migrationSql).toContain('jsonb_object_agg(header.key');
    expect(migrationSql).not.toContain('header.value');
  });
});
