import { describe, expect, it } from "vitest";
import {
  buildNoNewUsbAccountsMessage,
  buildSkippedXpubWarning,
} from "../../src/services/hardwareWallet/xpubImportWarnings";
import type { XpubFetchFailure } from "../../src/services/hardwareWallet/service";

const failure = (
  name: string,
  path: string,
  message = "Device rejected public key export",
): XpubFetchFailure => ({ name, path, message });

describe("xpubImportWarnings", () => {
  it("uses Ledger Bitcoin Test guidance when skipped paths include coin-type 1", () => {
    const warning = buildSkippedXpubWarning([
      failure("Mainnet Native SegWit (BIP-84)", "m/84'/0'/0'"),
      failure("Testnet Native SegWit (BIP-84)", "m/84'/1'/0'"),
      failure("Testnet Taproot (BIP-86)", "m/86'/1'/0'"),
    ]);

    expect(warning).toContain("2 testnet/signet paths were not returned");
    expect(warning).toContain("Bitcoin Test app");
    expect(warning).toContain("Ledger Live only needs to be closed");
    expect(warning).toContain("merge the newly found accounts");
    expect(warning).toContain("Skipped: Mainnet Native SegWit (BIP-84) m/84'/0'/0'");
  });

  it("summarizes skipped path names and count without overwhelming the UI", () => {
    const warning = buildSkippedXpubWarning([
      failure("Testnet Native SegWit (BIP-84)", "m/84'/1'/0'"),
      failure("Testnet Taproot (BIP-86)", "m/86'/1'/0'"),
      failure("Testnet Nested SegWit (BIP-49)", "m/49'/1'/0'"),
      failure("Signet Multisig Native SegWit (BIP-48)", "m/48'/1'/0'/2'"),
    ]);

    expect(warning).toContain(
      "Skipped: Testnet Native SegWit (BIP-84) m/84'/1'/0', Testnet Taproot (BIP-86) m/86'/1'/0', Testnet Nested SegWit (BIP-49) m/49'/1'/0' and 1 more.",
    );
  });

  it("uses generic guidance when only mainnet paths are skipped", () => {
    const warning = buildSkippedXpubWarning([
      failure("Mainnet Native SegWit (BIP-84)", "m/84'/0'/0'"),
    ]);

    expect(warning).toContain("1 standard derivation path was not returned");
    expect(warning).toContain("Approve public-key export prompts");
    expect(warning).not.toContain("Bitcoin Test app");
  });

  it("uses plural generic guidance for multiple skipped mainnet paths", () => {
    const warning = buildSkippedXpubWarning([
      failure("Mainnet Native SegWit (BIP-84)", "m/84'/0'/0'"),
      failure("Mainnet Taproot (BIP-86)", "m/86'/0'/0'"),
    ]);

    expect(warning).toContain("2 standard derivation paths were not returned");
    expect(warning).not.toContain("testnet/signet");
  });

  it("wraps skipped path guidance when no new USB accounts are found", () => {
    expect(buildNoNewUsbAccountsMessage([])).toBe(
      "No new accounts to add. All derivation paths already exist on this device.",
    );

    expect(
      buildNoNewUsbAccountsMessage([
        failure("Testnet Native SegWit (BIP-84)", "m/84'/1'/0'"),
      ]),
    ).toContain("No new accounts were added. 1 testnet/signet path was not returned");
  });
});
