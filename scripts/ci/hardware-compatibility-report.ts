#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  HARDWARE_WALLET_CAPABILITY_ROWS,
} from "../../shared/constants/hardwareWalletCapabilities";
import {
  GENERATED_P2SH_P2WPKH_VECTORS,
  GENERATED_P2SH_P2WSH_VECTORS,
  GENERATED_P2TR_VECTORS,
  GENERATED_P2WPKH_VECTORS,
  GENERATED_P2WSH_VECTORS,
} from "../../server/tests/fixtures/generated-psbt-vectors";
import { GENERATED_SIGNED_PSBT_VECTORS } from "../../server/tests/fixtures/generated-signed-psbt-vectors";
import {
  BLOCKED_HARDWARE_SIGNED_ROWS,
  HARDWARE_SIGNED_PSBT_VECTORS,
  REQUIRED_HARDWARE_SIGNED_ROWS,
  UNSUPPORTED_HARDWARE_SIGNED_ROWS,
  type HardwareSignedPsbtVector,
  type RequiredHardwareSignedRow,
} from "../../server/tests/fixtures/hardware-signed-psbt-vectors";
import { VERIFIER_PROVENANCE } from "../../server/tests/fixtures/verified-address-vectors";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8")) as T;
const rowKey = (row: RequiredHardwareSignedRow): string =>
  `${row.vendor}:${row.scriptType}`;

interface ReportOptions {
  asOf: string;
  revision: string | null;
}

/**
 * Classifies release eligibility: no enabled rows is safely disabled; enabled
 * rows with complete current evidence require the strict release verifier; any
 * missing evidence or expired physical row blocks the release.
 */
export function classifyHardwareReleaseDecision(
  enabledRows: readonly { evidenceIds: readonly string[] }[],
  expiredPhysicalRowCount: number,
):
  | "safe-fail-closed"
  | "enabled-rows-require-strict-release-verification"
  | "blocked-invalid-enabled-row" {
  if (enabledRows.length === 0) return "safe-fail-closed";
  if (
    expiredPhysicalRowCount === 0 &&
    enabledRows.every((row) => row.evidenceIds.length > 0)
  ) {
    return "enabled-rows-require-strict-release-verification";
  }
  return "blocked-invalid-enabled-row";
}

const fixtureFreshness = (
  vector: HardwareSignedPsbtVector,
  asOf: number,
): "fresh" | "expired" =>
  Date.parse(vector.evidence.expiresAt) > asOf ? "fresh" : "expired";

const hardwareRows = (asOf: number) => {
  const unsupported = new Map(
    UNSUPPORTED_HARDWARE_SIGNED_ROWS.map((row) => [rowKey(row), row]),
  );
  const blocked = new Map(
    BLOCKED_HARDWARE_SIGNED_ROWS.map((row) => [rowKey(row), row]),
  );
  const physical = new Map(
    HARDWARE_SIGNED_PSBT_VECTORS.map((vector) => [rowKey(vector), vector]),
  );

  return REQUIRED_HARDWARE_SIGNED_ROWS.map((row) => {
    const key = rowKey(row);
    const vector = physical.get(key);
    const unsupportedRow = unsupported.get(key);
    const blockedRow = blocked.get(key);
    if (vector) {
      return {
        ...row,
        status: "physical-evidence-present" as const,
        reason:
          "A Tier 3 fixture is present; capability enablement remains a separate reviewed decision.",
        evidenceIds: [vector.id],
        freshness: fixtureFreshness(vector, asOf),
        expiresAt: vector.evidence.expiresAt,
        deviceTuple: {
          ...vector.device,
          sdkPackages: vector.evidence.sdkPackages,
          hostOs: vector.evidence.hostOs,
          browser: vector.evidence.browser,
        },
      };
    }
    if (unsupportedRow) {
      return {
        ...row,
        status: "unsupported-product-blocked" as const,
        reason: unsupportedRow.reason,
        evidenceIds: [],
        freshness: "unverified" as const,
        expiresAt: null,
        deviceTuple: null,
      };
    }
    return {
      ...row,
      status: blockedRow
        ? ("blocked-pending-physical-evidence" as const)
        : ("unverified-missing-physical-evidence" as const),
      reason:
        blockedRow?.reason ??
        "No current reviewed physical-device fixture is committed.",
      evidenceIds: [],
      freshness: "unverified" as const,
      expiresAt: null,
      deviceTuple: null,
    };
  });
};

/**
 * Builds the Tier 1/2/3 compatibility statement at an explicit evidence time.
 * `revision` is null only for the checked-in source-state snapshot; release
 * candidates must supply the exact tested commit. Unknown, absent, or expired
 * physical proof never enables a funds-controlling capability.
 */
export function buildHardwareCompatibilityReport(options: ReportOptions) {
  const asOf = Date.parse(options.asOf);
  if (!Number.isFinite(asOf))
    throw new Error("compatibility report asOf must be an ISO timestamp");
  if (options.revision !== null && !/^[0-9a-f]{40}$/.test(options.revision)) {
    throw new Error(
      "compatibility report revision must be a full Git SHA or null",
    );
  }

  const packageLock = readFileSync(
    resolve(REPO_ROOT, "package-lock.json"),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
  ) as { version: string };
  const ledger = readJson<{
    bitcoinApp: { version: string };
    speculos: { version: string };
    sdk: Record<string, string>;
  }>("config/ledger-emulator/proof.json");
  const trezor = readJson<{
    firmware: string;
    bridge: string;
    connect: string;
    model: string;
  }>("config/trezor-emulator-proof.json");
  const jade = readJson<{
    firmware: { runtimeVersion: string };
    sdk: Record<string, string>;
  }>("config/jade-emulator-proof.json");
  const rows = hardwareRows(asOf);
  const freshPhysical = rows.filter((row) => row.freshness === "fresh").length;
  const expiredPhysical = rows.filter(
    (row) => row.freshness === "expired",
  ).length;
  const enabledCapabilities = HARDWARE_WALLET_CAPABILITY_ROWS.filter(
    (row) => row.enabled,
  );
  const draftPsbtCount = [
    ...GENERATED_P2WPKH_VECTORS,
    ...GENERATED_P2SH_P2WPKH_VECTORS,
    ...GENERATED_P2TR_VECTORS,
    ...GENERATED_P2WSH_VECTORS,
    ...GENERATED_P2SH_P2WSH_VECTORS,
  ].length;

  return {
    schemaVersion: 1,
    statementId: "sanctuary-hardware-wallet-compatibility-v1",
    generatedAt: options.asOf,
    revision: options.revision,
    source: {
      applicationVersion: packageJson.version,
      packageLockSha256: sha256(packageLock),
      capabilityManifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
    },
    capabilityRows: HARDWARE_WALLET_CAPABILITY_ROWS.map((row) => ({ ...row })),
    hardwareRows: rows,
    proofTiers: {
      tier1: {
        status: "configured-and-nonempty" as const,
        addressVectorCount: VERIFIER_PROVENANCE.exactCaseCount,
        draftPsbtVectorCount: draftPsbtCount,
        signedPsbtVectorCount: GENERATED_SIGNED_PSBT_VECTORS.length,
        independentImplementations: VERIFIER_PROVENANCE.evidenceScopes.map(
          ({ implementation }) => implementation,
        ),
      },
      tier2: {
        status: "required-ci-proofs" as const,
        vendors: [
          {
            vendor: "ledger" as const,
            emulator: `Speculos ${ledger.speculos.version}`,
            firmwareOrApp: `Bitcoin app ${ledger.bitcoinApp.version}`,
            sdk: ledger.sdk,
          },
          {
            vendor: "trezor" as const,
            emulator: `Trezor User Env ${trezor.model}`,
            firmwareOrApp: `firmware ${trezor.firmware}; Bridge ${trezor.bridge}`,
            sdk: { connect: trezor.connect },
          },
          {
            vendor: "jade" as const,
            emulator: "Jade QEMU",
            firmwareOrApp: `firmware ${jade.firmware.runtimeVersion}`,
            sdk: jade.sdk,
          },
        ],
      },
      tier3: {
        status:
          HARDWARE_SIGNED_PSBT_VECTORS.length === 0
            ? ("unverified-no-physical-fixtures" as const)
            : ("physical-fixtures-present" as const),
        physicalFixtureCount: HARDWARE_SIGNED_PSBT_VECTORS.length,
        freshPhysicalRowCount: freshPhysical,
        expiredPhysicalRowCount: expiredPhysical,
      },
    },
    // Zero enabled rows is a safe fail-closed state. Once any row is enabled,
    // absent or expired physical evidence makes the release invalid.
    releaseDecision: {
      status: classifyHardwareReleaseDecision(
        enabledCapabilities,
        expiredPhysical,
      ),
      enabledCapabilityCount: enabledCapabilities.length,
      allFundsControllingCapabilitiesDisabled: enabledCapabilities.length === 0,
      skippedRequiredCaseCount: 0,
    },
  };
}

/** Renders the human-readable companion to the canonical JSON statement. */
export function renderHardwareCompatibilityMarkdown(
  report: ReturnType<typeof buildHardwareCompatibilityReport>,
): string {
  const tableRows = report.hardwareRows.map((row) => [
    row.vendor,
    row.scriptType,
    row.status,
    row.freshness,
    row.evidenceIds.join(", ") || "none",
  ]);
  const table = renderMarkdownTable(
    ["Vendor", "Script", "Status", "Tier 3 freshness", "Evidence"],
    tableRows,
  );
  const lines = [
    "# Hardware wallet compatibility statement",
    "",
    `Generated: ${report.generatedAt}`,
    `Revision: ${report.revision ?? "source-state artifact (release revision not supplied)"}`,
    `Application: ${report.source.applicationVersion}`,
    `Decision: ${report.releaseDecision.status}`,
    "",
    "All Ledger, Jade Plus, and Trezor funds-controlling capabilities remain disabled unless a separately reviewed capability row says otherwise.",
    "",
    ...table,
    "",
    "## Proof counts",
    "",
    `- Tier 1 address vectors: ${report.proofTiers.tier1.addressVectorCount}`,
    `- Tier 1 draft PSBT vectors: ${report.proofTiers.tier1.draftPsbtVectorCount}`,
    `- Tier 1 signed PSBT vectors: ${report.proofTiers.tier1.signedPsbtVectorCount}`,
    `- Tier 3 physical fixtures: ${report.proofTiers.tier3.physicalFixtureCount}`,
  ];
  return `${lines.join("\n")}\n`;
}

const renderMarkdownTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const renderRow = (row: readonly string[]): string =>
    `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
  return [
    renderRow(headers),
    renderRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(renderRow),
  ];
};

interface CliOptions extends ReportOptions {
  jsonPath: string;
  markdownPath: string;
}

const parseCli = (args: string[]): CliOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!args[index].startsWith("--") || !value)
      throw new Error(`invalid argument ${args[index]}`);
    values.set(args[index], value);
  }
  const asOf = values.get("--as-of");
  const jsonPath = values.get("--json");
  const markdownPath = values.get("--markdown");
  if (!asOf || !jsonPath || !markdownPath) {
    throw new Error("--as-of, --json, and --markdown are required");
  }
  return {
    asOf,
    revision: values.get("--revision") ?? null,
    jsonPath,
    markdownPath,
  };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = buildHardwareCompatibilityReport(options);
    writeFileSync(
      resolve(options.jsonPath),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(
      resolve(options.markdownPath),
      renderHardwareCompatibilityMarkdown(report),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
