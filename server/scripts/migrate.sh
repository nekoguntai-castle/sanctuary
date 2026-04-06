#!/bin/sh
# Migration script that handles both fresh installs and upgrades
# For upgrades from older versions, it auto-resolves migrations that
# were already applied before the migration file restructure.

set -e

echo "=== Sanctuary Database Migration ==="

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

# Check if this is an existing database (users table exists)
echo "Checking database state..."
TABLES_EXIST=$(npx prisma db execute --stdin <<EOF 2>/dev/null || echo "error"
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'users'
);
EOF
)

# Check if _prisma_migrations table exists and has our migrations
MIGRATIONS_TABLE_EXISTS=$(npx prisma db execute --stdin <<EOF 2>/dev/null || echo "error"
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = '_prisma_migrations'
);
EOF
)

# If tables exist but it's a legacy database, we need to resolve migrations
if echo "$TABLES_EXIST" | grep -q "t" 2>/dev/null; then
  echo "Existing database detected."

  # Check if the first legacy migration is already recorded
  FIRST_MIGRATION_EXISTS=$(npx prisma db execute --stdin <<EOF 2>/dev/null || echo "false"
SELECT EXISTS (
  SELECT FROM _prisma_migrations
  WHERE migration_name = '20251210175307_initial_setup'
);
EOF
)

  if echo "$FIRST_MIGRATION_EXISTS" | grep -q "f" 2>/dev/null; then
    echo "Legacy database detected - resolving pre-existing migrations..."

    for migration in $LEGACY_MIGRATIONS; do
      if [ -n "$migration" ]; then
        echo "  Resolving: $migration"
        npx prisma migrate resolve --applied "$migration" 2>/dev/null || true
      fi
    done

    echo "Legacy migrations resolved."
  else
    echo "Migrations already recorded."
  fi
else
  echo "Fresh database detected."
fi

# Run migrations
echo "Applying migrations..."
npx prisma migrate deploy

# Run seed (use compiled JS in production, bypasses prisma.config.ts which needs tsx)
echo "Running database seed..."
node dist/prisma/prisma/seed.js

echo "=== Migration Complete ==="
