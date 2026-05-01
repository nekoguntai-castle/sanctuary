import { parseDerivationPath } from "../../shared/utils/bitcoin";
import type { XpubFetchFailure } from "./service";

const MAX_SKIPPED_PATHS_IN_MESSAGE = 3;

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return count === 1 ? singular : pluralWord;
}

function isTestnetFamilyPath(path: string): boolean {
  const parsed = parseDerivationPath(path);
  // Signet shares BIP-44 coin type 1 with testnet hardware-account exports.
  return parsed.valid && parsed.coinType === 1;
}

function skippedPathSummary(failures: XpubFetchFailure[]): string {
  const skipped = failures
    .slice(0, MAX_SKIPPED_PATHS_IN_MESSAGE)
    .map((failure) => `${failure.name} ${failure.path}`);
  const remaining = failures.length - skipped.length;
  return remaining > 0
    ? `${skipped.join(", ")} and ${remaining} more`
    : skipped.join(", ");
}

/**
 * Build the user-facing warning for standard account paths that USB import
 * skipped, with Ledger-specific guidance for testnet-family paths.
 */
export function buildSkippedXpubWarning(
  failures: XpubFetchFailure[],
): string | null {
  if (failures.length === 0) return null;

  const testnetFailures = failures.filter((failure) =>
    isTestnetFamilyPath(failure.path),
  );
  const skipped = skippedPathSummary(failures);

  if (testnetFailures.length > 0) {
    return [
      `${testnetFailures.length} testnet/signet ${plural(testnetFailures.length, "path")} ${testnetFailures.length === 1 ? "was" : "were"} not returned.`,
      "For Ledger, install or open the Bitcoin Test app on the device, approve public-key export prompts, then run USB import again.",
      "Ledger Live only needs to be closed if it is claiming the USB connection.",
      "If prompted for an existing device, merge the newly found accounts.",
      `Skipped: ${skipped}.`,
    ].join(" ");
  }

  return [
    `${failures.length} standard derivation ${plural(failures.length, "path")} ${failures.length === 1 ? "was" : "were"} not returned.`,
    "Approve public-key export prompts on the device and retry USB import if those accounts are needed.",
    `Skipped: ${skipped}.`,
  ].join(" ");
}

/**
 * Explain an add-account retry that found no new accounts while preserving any
 * skipped-path guidance returned by the hardware wallet import.
 */
export function buildNoNewUsbAccountsMessage(
  failures: XpubFetchFailure[],
): string {
  const warning = buildSkippedXpubWarning(failures);
  if (warning) return `No new accounts were added. ${warning}`;
  return "No new accounts to add. All derivation paths already exist on this device.";
}
