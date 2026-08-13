#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  HARDWARE_WALLET_CAPABILITY_ROWS,
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY,
  HARDWARE_WALLET_VENDORS,
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
import { validateHardwareSignedFixtureSet } from "../../server/tests/helpers/hardwareSignedFixtureIntake";
import { replayHardwareSignedVector } from "../../server/tests/helpers/hardwareSignedPsbtReplay";
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
  expectedTrustSha256?: string | null;
}

interface ReleaseCapabilityRow {
  id: string;
  vendor: string;
  modelFamily: string;
  policy: string;
  capability: string;
  enabled: boolean;
  evidenceTier: string;
  evidenceIds: readonly string[];
  freshness: { status: string; checkedAt: string | null; expiresAt: string | null };
}

interface ReleasePhysicalEvidenceRow {
  id: string;
  vendor: string;
  model: string;
  policy: string;
  capabilities: readonly string[];
  fresh: boolean;
}

const catalogModelName = (modelFamily: string): string | undefined =>
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY
    .flatMap((entry) => entry.catalogModelSlugs.map((slug, index) => ({
      slug,
      name: entry.catalogModelNames[index],
    })))
    .find(({ slug }) => slug === modelFamily)?.name;

const physicalModelName = (modelFamily: string): string | undefined => {
  const captureNames: Readonly<Record<string, string>> = {
    "bitbox02": "BitBox02 Multi",
    "bitbox02-btc-only": "BitBox02 BTC-only",
    "blockstream-jade-plus": "Jade Plus",
  };
  return captureNames[modelFamily] ?? catalogModelName(modelFamily);
};

const hasCurrentFreshness = (
  row: ReleaseCapabilityRow,
  asOf: number,
): boolean => {
  const checkedAt = row.freshness.checkedAt === null
    ? Number.NaN
    : Date.parse(row.freshness.checkedAt);
  const expiresAt = row.freshness.expiresAt === null
    ? Number.NaN
    : Date.parse(row.freshness.expiresAt);
  return row.freshness.status === "fresh"
    && Number.isFinite(checkedAt)
    && checkedAt <= asOf
    && Number.isFinite(expiresAt)
    && expiresAt > asOf;
};

const evidenceMatchesCapability = (
  evidence: ReleasePhysicalEvidenceRow | undefined,
  row: ReleaseCapabilityRow,
  model: string | undefined,
): boolean => evidence !== undefined
  && evidence.fresh
  && evidence.vendor === row.vendor
  && evidence.model === model
  && evidence.policy === row.policy
  && evidence.capabilities.includes(row.capability);

const enabledRowHasExactProof = (
  row: ReleaseCapabilityRow,
  evidenceById: ReadonlyMap<string, ReleasePhysicalEvidenceRow>,
  asOf: number,
): boolean => row.evidenceTier === "physical-device"
  && row.evidenceIds.length > 0
  && new Set(row.evidenceIds).size === row.evidenceIds.length
  && hasCurrentFreshness(row, asOf)
  && row.evidenceIds.every((id) => evidenceMatchesCapability(
    evidenceById.get(id),
    row,
    physicalModelName(row.modelFamily),
  ));

export interface HardwareReleaseValidationIssue {
  capabilityId: string | null;
  code: string;
}

export function validateExternallyPinnedTrust(
  physicalFixtureCount: number,
  trustContents: string,
  expectedTrustSha256: string | null | undefined,
): HardwareReleaseValidationIssue[] {
  if (physicalFixtureCount === 0) return [];
  if (!expectedTrustSha256 || !/^[0-9a-f]{64}$/.test(expectedTrustSha256)) {
    return [{ capabilityId: null, code: "missing-external-trust-root-pin" }];
  }
  return sha256(trustContents) === expectedTrustSha256
    ? []
    : [{ capabilityId: null, code: "external-trust-root-pin-mismatch" }];
}

/**
 * Classifies release eligibility: no enabled rows is safely disabled; enabled
 * rows with complete current evidence require the strict release verifier; any
 * missing evidence or expired physical row blocks the release.
 */
export function classifyHardwareReleaseDecision(
  capabilityRows: readonly ReleaseCapabilityRow[],
  physicalEvidenceRows: readonly ReleasePhysicalEvidenceRow[],
  fixtureIssueCount: number,
  asOf: number,
): {
  status:
  | "safe-fail-closed"
  | "enabled-rows-verified"
  | "blocked-invalid-enabled-row";
  issues: HardwareReleaseValidationIssue[];
} {
  const duplicateEvidenceIds = physicalEvidenceRows
    .filter((row, index) => row.id.trim() === ""
      || physicalEvidenceRows.findIndex(({ id }) => id === row.id) !== index);
  const evidenceById = new Map(physicalEvidenceRows.map((row) => [row.id, row]));
  const issues: HardwareReleaseValidationIssue[] = fixtureIssueCount === 0
    ? []
    : [{ capabilityId: null, code: "invalid-physical-fixture-set" }];
  if (duplicateEvidenceIds.length > 0) {
    issues.push({ capabilityId: null, code: "ambiguous-physical-evidence-id" });
  }
  const enabledRows = capabilityRows.filter((row) => row.enabled);
  for (const row of enabledRows) {
    if (!enabledRowHasExactProof(row, evidenceById, asOf)) {
      issues.push({ capabilityId: row.id, code: "enabled-row-lacks-exact-fresh-tier3-proof" });
    }
  }
  return {
    status: issues.length > 0
      ? "blocked-invalid-enabled-row"
      : enabledRows.length === 0
        ? "safe-fail-closed"
        : "enabled-rows-verified",
    issues,
  };
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
  const trustContents = readFileSync(
    resolve(REPO_ROOT, "config/hardware-physical-evidence-trust.json"),
    "utf8",
  );
  const trust = JSON.parse(trustContents) as {
    trustedCoreReceiptKeys: Record<string, string>;
    trustedApplicationReceiptKeys: Record<string, string>;
    trustedReviewerReceiptKeys: Record<string, string>;
  };
  const verificationContext = {
    ...trust,
    now: asOf,
    isTestedCommitReachable: (sha: string) => {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
          cwd: REPO_ROOT,
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
  };
  const fixtureIssues = validateHardwareSignedFixtureSet(
    HARDWARE_SIGNED_PSBT_VECTORS,
    UNSUPPORTED_HARDWARE_SIGNED_ROWS,
    verificationContext,
  );
  const replayIssueCount = HARDWARE_SIGNED_PSBT_VECTORS.reduce((count, vector) => {
    try {
      replayHardwareSignedVector(vector, verificationContext);
      return count;
    } catch {
      return count + 1;
    }
  }, 0);
  const trustIssues = validateExternallyPinnedTrust(
    HARDWARE_SIGNED_PSBT_VECTORS.length,
    trustContents,
    options.expectedTrustSha256,
  );
  const strictFixtureIssueCount = fixtureIssues.length
    + replayIssueCount
    + trustIssues.length;
  const freshPhysical = rows.filter((row) => row.freshness === "fresh").length;
  const expiredPhysical = rows.filter(
    (row) => row.freshness === "expired",
  ).length;
  const enabledCapabilities = HARDWARE_WALLET_CAPABILITY_ROWS.filter(
    (row) => row.enabled,
  );
  const releaseValidation = classifyHardwareReleaseDecision(
    HARDWARE_WALLET_CAPABILITY_ROWS,
    HARDWARE_SIGNED_PSBT_VECTORS.map((vector) => ({
      id: vector.id,
      vendor: vector.vendor,
      model: vector.device.model,
      policy: vector.account.canonicalPolicyId,
      capabilities: vector.coveredCapabilities,
      fresh: fixtureFreshness(vector, asOf) === "fresh",
    })),
    strictFixtureIssueCount,
    asOf,
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
        validatedPhysicalFixtureCount:
          strictFixtureIssueCount === 0 ? HARDWARE_SIGNED_PSBT_VECTORS.length : 0,
        validationIssueCount: strictFixtureIssueCount,
      },
    },
    // Zero enabled rows is a safe fail-closed state. Once any row is enabled,
    // absent or expired physical evidence makes the release invalid.
    releaseDecision: {
      status: releaseValidation.status,
      enabledCapabilityCount: enabledCapabilities.length,
      allFundsControllingCapabilitiesDisabled: enabledCapabilities.length === 0,
      pendingPhysicalRowCount: rows.filter(
        (row) => row.status === "blocked-pending-physical-evidence"
          || row.status === "unverified-missing-physical-evidence",
      ).length,
      skippedRequiredCaseCount: releaseValidation.issues.filter(
        ({ capabilityId }) => capabilityId !== null,
      ).length,
      validationIssues: [...trustIssues, ...releaseValidation.issues],
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
    `All inventoried signer families (${HARDWARE_WALLET_VENDORS.join(", ")}) remain disabled unless a separately reviewed capability row says otherwise.`,
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
    expectedTrustSha256: process.env.HARDWARE_EVIDENCE_TRUST_SHA256 ?? null,
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
