-- Create feature flags table for runtime feature toggling
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "modifiedBy" TEXT,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- Create feature flag audit trail table
CREATE TABLE "feature_flag_audit" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousValue" BOOLEAN NOT NULL,
    "newValue" BOOLEAN NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_audit_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on flag key
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- Indexes for feature_flags
CREATE INDEX "feature_flags_category_idx" ON "feature_flags"("category");
CREATE INDEX "feature_flags_enabled_idx" ON "feature_flags"("enabled");

-- Indexes for feature_flag_audit
CREATE INDEX "feature_flag_audit_featureFlagId_idx" ON "feature_flag_audit"("featureFlagId");
CREATE INDEX "feature_flag_audit_changedBy_idx" ON "feature_flag_audit"("changedBy");
CREATE INDEX "feature_flag_audit_createdAt_idx" ON "feature_flag_audit"("createdAt");

-- Foreign key: audit -> feature flag
ALTER TABLE "feature_flag_audit" ADD CONSTRAINT "feature_flag_audit_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
