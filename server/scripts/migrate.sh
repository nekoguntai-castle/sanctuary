#!/bin/sh
# Migration script that handles both fresh installs and upgrades
# For upgrades from older versions, it auto-resolves migrations that
# were already applied before the migration file restructure.

set -e

# List of migrations that existed before the restructure
# These need to be marked as applied for existing databases
LEGACY_MIGRATIONS="
20251210175307_initial_setup
20251211034758_add_use_ssl_to_node_config
20251211092644_add_hardware_device_models
20251211162258_add_wallet_sync_metadata
20251211171010_add_counterparty_address
20251211173018_add_fee_estimator_url
20251211180119_add_labels_system
"

query_boolean() {
  sql="$1"

  node - "$sql" <<'NODE'
const sql = process.argv[2];
const { PrismaClient } = require('./dist/server/src/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = process.env.DATABASE_URL || '';

  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const rows = await prisma.$queryRawUnsafe(sql);
    const firstRow = rows && rows[0] ? rows[0] : {};
    const value = Object.prototype.hasOwnProperty.call(firstRow, 'result')
      ? firstRow.result
      : Object.values(firstRow)[0];

    console.log(value === true || value === 't' || value === 1 || value === '1' ? 'true' : 'false');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
NODE
}

table_exists() {
  table_name="$1"

  query_boolean "SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = '${table_name}'
  ) AS result"
}

migration_recorded() {
  migration_name="$1"

  query_boolean "SELECT EXISTS (
    SELECT FROM _prisma_migrations
    WHERE migration_name = '${migration_name}'
  ) AS result"
}

resolve_legacy_migrations() {
  echo "Legacy database detected - resolving pre-existing migrations..."

  for migration in $LEGACY_MIGRATIONS; do
    if [ -n "$migration" ]; then
      echo "  Resolving: $migration"
      npx prisma migrate resolve --applied "$migration" 2>/dev/null || true
    fi
  done

  echo "Legacy migrations resolved."
}

main() {
  echo "=== Sanctuary Database Migration ==="

  # Check if this is an existing database (users table exists).
  echo "Checking database state..."
  TABLES_EXIST=$(table_exists users)
  MIGRATIONS_TABLE_EXISTS=$(table_exists _prisma_migrations)

  # If tables exist but it's a legacy database, we need to resolve migrations.
  if [ "$TABLES_EXIST" = "true" ]; then
    echo "Existing database detected."

    if [ "$MIGRATIONS_TABLE_EXISTS" = "true" ]; then
      FIRST_MIGRATION_EXISTS=$(migration_recorded 20251210175307_initial_setup)
    else
      FIRST_MIGRATION_EXISTS=false
    fi

    if [ "$FIRST_MIGRATION_EXISTS" = "false" ]; then
      resolve_legacy_migrations
    else
      echo "Migrations already recorded."
    fi
  else
    echo "Fresh database detected."
  fi

  # Run migrations.
  echo "Applying migrations..."
  npx prisma migrate deploy

  # Run seed (use compiled JS in production, bypasses prisma.config.ts which needs tsx).
  echo "Running database seed..."
  node dist/prisma/prisma/seed.js

  echo "=== Migration Complete ==="
}

main "$@"
