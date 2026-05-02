-- Allow a device to store both mainnet and testnet/signet accounts with the
-- same purpose and script type. The derivation path remains unique per device.
DROP INDEX IF EXISTS "device_accounts_deviceId_purpose_scriptType_key";

CREATE INDEX IF NOT EXISTS "device_accounts_deviceId_purpose_scriptType_idx"
  ON "device_accounts"("deviceId", "purpose", "scriptType");
