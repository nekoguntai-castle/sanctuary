-- Treat every persisted webhook diagnostic header value as secret. The CASE
-- also fails closed for malformed legacy JSON shapes, and re-running the update
-- leaves already-redacted objects unchanged.
UPDATE "webhook_deliveries" AS delivery
SET "requestHeadersRedacted" = CASE
  WHEN jsonb_typeof(delivery."requestHeadersRedacted") = 'object' THEN (
    SELECT COALESCE(
      jsonb_object_agg(header.key, to_jsonb('[REDACTED]'::text)),
      '{}'::jsonb
    )
    FROM jsonb_each(delivery."requestHeadersRedacted") AS header
  )
  ELSE NULL
END
WHERE delivery."requestHeadersRedacted" IS NOT NULL;
