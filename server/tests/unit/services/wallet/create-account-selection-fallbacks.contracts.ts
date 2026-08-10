import { describe, expect, it } from "vitest";
import { buildDeviceInfo } from "../../../../src/services/wallet/walletAccountSelection";

const walletInput = {
  name: "Fail Closed Wallet",
  type: "single_sig",
  scriptType: "native_segwit",
  network: "testnet3",
} as const;

export function registerWalletCreateAccountSelectionFallbackTests(): void {
  describe("createWallet - removed account selection fallbacks", () => {
    it("rejects an invalid account path instead of treating its network as unknown", () => {
      const device = {
        id: "device-1",
        userId: "test-user-id",
        fingerprint: "abc12345",
        type: "coldcard",
        label: "Unknown Path Device",
        xpub: "legacy-xpub",
        derivationPath: "m/84'/1'/0'",
        accounts: [{
          id: "account-1",
          deviceId: "device-1",
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "not-a-valid-path",
          xpub: "xpub-unknown-network",
        }],
      };

      expect(() => buildDeviceInfo(device as never, walletInput))
        .toThrow("must have exactly one matching testnet3 single_sig native_segwit account; found 0");
    });

    it("rejects a legacy-only device instead of using legacy xpub/path", () => {
      const device = {
        id: "device-1",
        userId: "test-user-id",
        fingerprint: "abc12345",
        type: "coldcard",
        label: "Legacy Device",
        xpub: "legacy-xpub",
        derivationPath: "m/84'/1'/0'",
        accounts: [],
      };

      expect(() => buildDeviceInfo(device as never, walletInput))
        .toThrow("must have exactly one matching testnet3 single_sig native_segwit account; found 0");
    });

    it("rejects purpose-only fallback when script policy differs", () => {
      const device = {
        id: "device-1",
        userId: "test-user-id",
        fingerprint: "abc12345",
        type: "coldcard",
        label: "Wrong Script Device",
        xpub: "legacy-xpub",
        derivationPath: "m/84'/1'/0'",
        accounts: [{
          id: "account-1",
          deviceId: "device-1",
          purpose: "single_sig",
          scriptType: "legacy",
          derivationPath: "m/44'/1'/0'",
          xpub: "tpub-legacy",
        }],
      };

      expect(() => buildDeviceInfo(device as never, walletInput))
        .toThrow("must have exactly one matching testnet3 single_sig native_segwit account; found 0");
    });

    it("rejects arbitrary first-account fallback when purpose differs", () => {
      const device = {
        id: "device-1",
        userId: "test-user-id",
        fingerprint: "abc12345",
        type: "coldcard",
        label: "Wrong Purpose Device",
        xpub: "legacy-xpub",
        derivationPath: "m/84'/1'/0'",
        accounts: [{
          id: "account-1",
          deviceId: "device-1",
          purpose: "multisig",
          scriptType: "native_segwit",
          derivationPath: "m/48'/1'/0'/2'",
          xpub: "tpub-multisig",
        }],
      };

      expect(() => buildDeviceInfo(device as never, walletInput))
        .toThrow("must have exactly one matching testnet3 single_sig native_segwit account; found 0");
    });
  });
}
