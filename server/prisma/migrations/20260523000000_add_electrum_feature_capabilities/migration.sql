-- Add Electrum feature-scoped routing and capability diagnostics.
ALTER TABLE "electrum_servers"
  ADD COLUMN "serverUsage" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN "serverFeatures" JSONB,
  ADD COLUMN "serverVersion" TEXT,
  ADD COLUMN "protocolVersion" TEXT,
  ADD COLUMN "silentPaymentVersions" JSONB,
  ADD COLUMN "supportsSilentPaymentsV0" BOOLEAN,
  ADD COLUMN "capabilityProfileKey" TEXT,
  ADD COLUMN "lastCapabilityError" TEXT;

CREATE INDEX "electrum_servers_network_enabled_serverUsage_idx"
  ON "electrum_servers"("network", "enabled", "serverUsage");

CREATE INDEX "electrum_servers_network_enabled_supportsSilentPaymentsV0_idx"
  ON "electrum_servers"("network", "enabled", "supportsSilentPaymentsV0");
