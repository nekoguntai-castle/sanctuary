import { describe, expect, it } from "vitest";
import {
  buildDeviceInfo,
  descriptorDeviceInfo,
  resolveWalletSignerBindings,
  type WalletSignerAccount,
  type WalletSignerDevice,
  type WalletSignerResolutionInput,
} from "../../../../src/services/wallet/walletAccountSelection";
import {
  mockAssertHardwareWalletCapability,
  mockBuildDescriptorFromDevices,
  mockPrismaClient,
} from "./walletTestHarness";
import { ForbiddenError } from "../../../../src/errors";
import { createWallet } from "../../../../src/services/wallet";
import { registerWalletCreateAccountSelectionValidationTests } from "./create-account-selection.validation.contracts";

type AccountOverrides = Partial<WalletSignerAccount>;

function account(
  deviceId: string,
  id: string,
  overrides: AccountOverrides = {},
): WalletSignerAccount {
  return {
    id,
    deviceId,
    purpose: "single_sig",
    scriptType: "native_segwit",
    derivationPath: "m/84'/0'/0'",
    xpub: `xpub-${id}`,
    ...overrides,
  };
}

function device(
  id: string,
  accounts: readonly WalletSignerAccount[],
  fingerprint = "abc12345",
): WalletSignerDevice {
  return { id, label: `Device ${id}`, fingerprint, accounts };
}

function resolutionInput(
  overrides: Partial<WalletSignerResolutionInput> = {},
): WalletSignerResolutionInput {
  return {
    type: "single_sig",
    scriptType: "native_segwit",
    network: "mainnet",
    signers: [{ deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 0 }],
    ...overrides,
  };
}

function createMockDevice(
  id: string,
  fingerprint: string,
  accounts: Array<{
    purpose: string;
    scriptType: string;
    derivationPath: string;
    xpub: string;
  }>,
): Record<string, unknown> {
  return {
    id,
    userId: "test-user-id",
    fingerprint,
    type: "coldcard",
    label: `Device ${id}`,
    xpub: accounts[0]?.xpub ?? "legacy-xpub",
    derivationPath: accounts[0]?.derivationPath ?? null,
    accounts: accounts.map((entry, index) => ({
      id: `${id}-account-${index}`,
      deviceId: id,
      ...entry,
    })),
  };
}

export function registerWalletCreateAccountSelectionTests(): void {
  describe("wallet signer account selection", () => {
    describe("explicit signer bindings", () => {
      it("returns an immutable snapshot-ready single-sig binding and descriptor projection", () => {
        const selected = account("device-1", "account-1", {
          derivationPath: "m/84h/0h/7h",
          xpub: "xpub-nonzero-account",
        });

        const bindings = resolveWalletSignerBindings(
          [device("device-1", [selected])],
          resolutionInput(),
        );

        expect(bindings).toEqual([{
          deviceId: "device-1",
          deviceAccountId: "account-1",
          signerIndex: 0,
          signerBindingVersion: 1,
          signerFingerprint: "abc12345",
          signerXpub: "xpub-nonzero-account",
          signerDerivationPath: "m/84'/0'/7'",
          signerPurpose: "single_sig",
          signerScriptType: "native_segwit",
        }]);
        expect(descriptorDeviceInfo(bindings[0])).toEqual({
          fingerprint: "abc12345",
          xpub: "xpub-nonzero-account",
          derivationPath: "m/84'/0'/7'",
        });
        expect(Object.isFrozen(bindings)).toBe(true);
        expect(Object.isFrozen(bindings[0])).toBe(true);
      });

      it("resolves multisig signers in explicit request and signer-index order", () => {
        const firstDevice = device("device-1", [account("device-1", "multi-1", {
          purpose: "multisig",
          scriptType: "nested_segwit",
          derivationPath: "m/48'/0'/3'/1'",
        })], "11112222");
        const secondDevice = device("device-2", [account("device-2", "multi-2", {
          purpose: "multisig",
          scriptType: "nested_segwit",
          derivationPath: "m/48'/0'/9'/1'",
        })], "33334444");

        const bindings = resolveWalletSignerBindings(
          [firstDevice, secondDevice],
          resolutionInput({
            type: "multi_sig",
            scriptType: "nested_segwit",
            signers: [
              { deviceId: "device-2", deviceAccountId: "multi-2", signerIndex: 0 },
              { deviceId: "device-1", deviceAccountId: "multi-1", signerIndex: 1 },
            ],
          }),
        );

        expect(bindings.map((binding) => binding.deviceId)).toEqual(["device-2", "device-1"]);
        expect(bindings.map((binding) => binding.signerIndex)).toEqual([0, 1]);
      });

      it.each(["testnet3", "testnet4", "signet", "regtest"] as const)(
        "accepts coin-type-1 account for %s",
        (network) => {
          const selected = account("device-1", "account-1", {
            scriptType: "taproot",
            derivationPath: "m/86'/1'/4'",
            xpub: "tpub-testnet-family",
          });

          const [binding] = resolveWalletSignerBindings(
            [device("device-1", [selected])],
            resolutionInput({ network, scriptType: "taproot" }),
          );

          expect(binding.signerDerivationPath).toBe("m/86'/1'/4'");
        },
      );

      it.each([
        ["device", [
          { deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 0 },
          { deviceId: "device-1", deviceAccountId: "account-2", signerIndex: 1 },
        ], "Duplicate signer device"],
        ["account", [
          { deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 0 },
          { deviceId: "device-2", deviceAccountId: "account-1", signerIndex: 1 },
        ], "Duplicate signer account"],
        ["index", [
          { deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 0 },
          { deviceId: "device-2", deviceAccountId: "account-2", signerIndex: 0 },
        ], "Duplicate signer index"],
      ] as const)("rejects duplicate signer %s", (_kind, signers, message) => {
        expect(() => resolveWalletSignerBindings([], resolutionInput({ signers })))
          .toThrow(message);
      });

      it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        "rejects invalid signer index %s",
        (signerIndex) => {
          expect(() => resolveWalletSignerBindings([], resolutionInput({
            signers: [{ deviceId: "device-1", deviceAccountId: "account-1", signerIndex }],
          }))).toThrow("Signer index must be a non-negative safe integer");
        },
      );

      it("rejects a gap or request-order mismatch in signer indices", () => {
        expect(() => resolveWalletSignerBindings([], resolutionInput({
          signers: [{ deviceId: "device-1", deviceAccountId: "account-1", signerIndex: 1 }],
        }))).toThrow("Signer indices must be contiguous and match request order");
      });

      it("rejects an empty signer selection", () => {
        expect(() => resolveWalletSignerBindings([], resolutionInput({ signers: [] })))
          .toThrow("At least one explicit signer is required");
      });

      it("rejects missing and ambiguous loaded devices", () => {
        expect(() => resolveWalletSignerBindings([], resolutionInput()))
          .toThrow("Signer device device-1 was not loaded");

        const selected = account("device-1", "account-1");
        expect(() => resolveWalletSignerBindings([
          device("device-1", [selected]),
          device("device-1", [selected]),
        ], resolutionInput())).toThrow("Signer device device-1 is ambiguous");
      });

      it("rejects missing, cross-device, and ambiguous accounts", () => {
        expect(() => resolveWalletSignerBindings(
          [device("device-1", [account("device-1", "other")])],
          resolutionInput(),
        )).toThrow("account account-1 does not belong to this device");

        expect(() => resolveWalletSignerBindings(
          [device("device-1", [account("device-2", "account-1")])],
          resolutionInput(),
        )).toThrow("inconsistent device ownership");

        const duplicate = account("device-1", "account-1");
        expect(() => resolveWalletSignerBindings(
          [device("device-1", [duplicate, duplicate])],
          resolutionInput(),
        )).toThrow("account account-1 is ambiguous");
      });

      it.each([
        ["wrong purpose", { purpose: "multisig", derivationPath: "m/48'/0'/0'/2'" }, "purpose must be single_sig"],
        ["wrong script metadata", { scriptType: "legacy" }, "script type must be native_segwit"],
        ["metadata/path mismatch", { derivationPath: "m/86'/0'/0'" }, "script type must be native_segwit"],
        ["wrong coin type", { derivationPath: "m/84'/1'/0'" }, "coin type does not match mainnet"],
        ["malformed path", { derivationPath: "not-a-path" }, "derivation path is malformed"],
        ["out-of-range account index", { derivationPath: "m/84'/0'/2147483648'" }, "account index exceeds the BIP32 range"],
        ["unhardened path", { derivationPath: "m/84'/0'/0" }, "hardened account-level path"],
        ["non-account-level path", { derivationPath: "m/84'/0'/0'/0/1" }, "hardened account-level path"],
        ["hardened single-sig suffix", { derivationPath: "m/84'/0'/0'/1'" }, "hardened account-level path"],
      ] as const)("rejects %s", (_case, overrides, message) => {
        const selected = account("device-1", "account-1", overrides);
        expect(() => resolveWalletSignerBindings(
          [device("device-1", [selected])],
          resolutionInput(),
        )).toThrow(message);
      });

      it("accepts the maximum canonical BIP32 account index", () => {
        const selected = account("device-1", "account-12", {
          derivationPath: "m/84'/0'/2147483647'",
        });

        expect(resolveWalletSignerBindings(
          [device("device-1", [selected])],
          resolutionInput({
            signers: [{ deviceId: "device-1", deviceAccountId: "account-12", signerIndex: 0 }],
          }),
        )[0]).toMatchObject({ signerDerivationPath: "m/84'/0'/2147483647'" });
      });

      it.each([
        "m/48'/0'/0'/2'/1'",
      ])("rejects non-canonical multisig account path %s", (derivationPath) => {
        const selected = account("device-1", "account-1", {
          purpose: "multisig",
          scriptType: "native_segwit",
          derivationPath,
        });
        expect(() => resolveWalletSignerBindings(
          [device("device-1", [selected])],
          resolutionInput({ type: "multi_sig" }),
        )).toThrow("hardened account-level path");
      });
    });

    describe("current wallet-create compatibility", () => {
      it("projects the only exact account", () => {
        const selected = account("device-1", "account-1");
        const loaded = {
          ...device("device-1", [selected]),
          userId: "test-user-id",
          type: "coldcard",
          xpub: "legacy-wrong-xpub",
          derivationPath: "m/44'/0'/0'",
        };

        expect(buildDeviceInfo(loaded as never, {
          name: "Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
        })).toEqual({
          fingerprint: "abc12345",
          xpub: "xpub-account-1",
          derivationPath: "m/84'/0'/0'",
        });
      });

      it("rejects zero or ambiguous exact accounts and never uses legacy identity", () => {
        const wrong = account("device-1", "wrong", {
          purpose: "multisig",
          derivationPath: "m/48'/0'/0'/2'",
        });
        const loaded = {
          ...device("device-1", [wrong]),
          userId: "test-user-id",
          type: "coldcard",
          xpub: "legacy-xpub",
          derivationPath: "m/84'/0'/0'",
        };
        const input = { name: "Wallet", type: "single_sig", scriptType: "native_segwit" } as const;

        expect(() => buildDeviceInfo(loaded as never, input)).toThrow("found 0");

        const exact = account("device-1", "exact");
        expect(() => buildDeviceInfo({ ...loaded, accounts: [exact, { ...exact, id: "exact-2" }] } as never, input))
          .toThrow("found 2");
      });

      it("propagates unexpected account inspection failures", () => {
        const broken = account("device-1", "broken");
        Object.defineProperty(broken, "derivationPath", {
          get: () => { throw new Error("account read failed"); },
        });

        expect(() => buildDeviceInfo(device("device-1", [broken]), {
          name: "Wallet",
          type: "single_sig",
          scriptType: "native_segwit",
        })).toThrow("account read failed");
      });

      it.each(["ledger", "jade", "trezor"])(
        "blocks %s before account resolution or persistence",
        async (type) => {
          mockAssertHardwareWalletCapability.mockImplementationOnce(() => {
            throw new ForbiddenError("blocked", undefined, {
              vendor: type,
              capability: "import",
            });
          });
          mockPrismaClient.device.findMany.mockResolvedValue([{
            ...createMockDevice("device-1", "abc12345", [{
              purpose: "single_sig",
              scriptType: "native_segwit",
              derivationPath: "m/84'/0'/0'",
              xpub: "xpub",
            }]),
            type,
          }]);

          await expect(createWallet("test-user-id", {
            name: "Blocked Wallet",
            type: "single_sig",
            scriptType: "native_segwit",
            signers: [{ deviceId: "device-1", deviceAccountId: "device-1-account-0", signerIndex: 0 }],
          })).rejects.toMatchObject({
            statusCode: 403,
            details: { vendor: type, capability: "import" },
          });

          expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
          expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
          expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
        },
      );
    });

    registerWalletCreateAccountSelectionValidationTests({
      createMockDevice,
      userId: "test-user-id",
    });
  });
}
