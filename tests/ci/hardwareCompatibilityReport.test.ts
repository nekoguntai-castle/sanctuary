import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHardwareCompatibilityReport,
  classifyHardwareReleaseDecision,
  computeSigningDependencySha256,
  renderHardwareCompatibilityMarkdown,
  validateExternallyPinnedTrust,
  type PackageLockFile,
} from "../../scripts/ci/hardware-compatibility-report";
import {
  HARDWARE_WALLET_CAPABILITY_ROWS,
} from "../../shared/constants/hardwareWalletCapabilities";

const AS_OF = "2026-08-11T00:00:00.000Z";
const build = () =>
  buildHardwareCompatibilityReport({
    asOf: AS_OF,
    revision: null,
  });

describe("hardware compatibility statement", () => {
  it("is deterministic and covers every capability and hardware row exactly once", () => {
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(first.capabilityRows).toHaveLength(
      HARDWARE_WALLET_CAPABILITY_ROWS.length,
    );
    expect(first.hardwareRows).toHaveLength(22);
    expect(new Set(first.capabilityRows.map(({ id }) => id)).size).toBe(
      first.capabilityRows.length,
    );
    expect(
      new Set(
        first.hardwareRows.map(
          ({ vendor, scriptType }) => `${vendor}:${scriptType}`,
        ),
    ).size,
    ).toBe(22);
    expect(first.hardwareRows.filter(
      ({ status }) => status === "blocked-pending-physical-evidence",
    )).toHaveLength(16);
    expect(first.hardwareRows.filter(
      ({ status }) => status === "unverified-missing-physical-evidence",
    )).toHaveLength(0);
  });

  it("truthfully reports nonempty software proof and absent physical evidence", () => {
    const report = build();
    expect(report.proofTiers.tier1.addressVectorCount).toBeGreaterThan(0);
    expect(report.proofTiers.tier1.draftPsbtVectorCount).toBeGreaterThan(0);
    expect(report.proofTiers.tier1.signedPsbtVectorCount).toBeGreaterThan(0);
    expect(
      report.proofTiers.tier1.independentImplementations.length,
    ).toBeGreaterThanOrEqual(4);
    expect(report.proofTiers.tier2.vendors.map(({ vendor }) => vendor)).toEqual(
      ["ledger", "trezor", "jade"],
    );
    expect(report.proofTiers.tier3).toMatchObject({
      status: "unverified-no-physical-fixtures",
      physicalFixtureCount: 0,
      freshPhysicalRowCount: 0,
      expiredPhysicalRowCount: 0,
      validatedPhysicalFixtureCount: 0,
      validationIssueCount: 0,
    });
  });

  it("keeps every product capability disabled and unverified", () => {
    const report = build();
    expect(report.capabilityRows.every((row) => !row.enabled)).toBe(true);
    expect(
      report.capabilityRows.every((row) => row.evidenceTier === "unverified"),
    ).toBe(true);
    expect(
      report.capabilityRows.every((row) => row.evidenceIds.length === 0),
    ).toBe(true);
    expect(report.releaseDecision).toMatchObject({
      status: "safe-fail-closed",
      enabledCapabilityCount: 0,
      allFundsControllingCapabilitiesDisabled: true,
      skippedRequiredCaseCount: 0,
      pendingPhysicalRowCount: 16,
      validationIssues: [],
    });
  });

  it("matches the checked-in JSON and Markdown source-state artifacts", () => {
    const report = build();
    const jsonPath = resolve(
      "docs/reference/generated/hardware-wallet-compatibility.json",
    );
    const markdownPath = resolve(
      "docs/reference/generated/hardware-wallet-compatibility.md",
    );
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual(report);
    expect(readFileSync(markdownPath, "utf8")).toBe(
      renderHardwareCompatibilityMarkdown(report),
    );
  });

  it("rejects ambiguous generation identity", () => {
    expect(() =>
      buildHardwareCompatibilityReport({
        asOf: "not-a-time",
        revision: null,
      }),
    ).toThrow("ISO timestamp");
    expect(() =>
      buildHardwareCompatibilityReport({
        asOf: AS_OF,
        revision: "short",
      }),
    ).toThrow("full Git SHA");
  });

  it("blocks enabled rows unless every row has current strict evidence", () => {
    const asOf = Date.parse(AS_OF);
    const capability = {
      id: "ledger.ledger-nano-x.sign",
      vendor: "ledger",
      modelFamily: "ledger-nano-x",
      policy: "single-sig-native-segwit-bip84-v1",
      capability: "sign",
      enabled: true,
      evidenceTier: "physical-device",
      evidenceIds: ["proof"],
      freshness: {
        status: "fresh",
        checkedAt: "2026-08-10T00:00:00.000Z",
        expiresAt: "2026-09-10T00:00:00.000Z",
      },
    };
    const evidence = [{
      id: "proof",
      vendor: "ledger",
      model: "Ledger Nano X",
      policy: "single-sig-native-segwit-bip84-v1",
      capabilities: ["sign"],
      fresh: true,
    }];

    expect(classifyHardwareReleaseDecision([], [], 0, asOf).status).toBe(
      "safe-fail-closed",
    );
    expect(
      classifyHardwareReleaseDecision([capability], evidence, 0, asOf).status,
    ).toBe("enabled-rows-verified");
    expect(classifyHardwareReleaseDecision([{
      ...capability,
      id: "jade.blockstream-jade-plus.sign",
      vendor: "jade",
      modelFamily: "blockstream-jade-plus",
      evidenceIds: ["jade-proof"],
    }], [{
      ...evidence[0],
      id: "jade-proof",
      vendor: "jade",
      model: "Jade Plus",
    }], 0, asOf).status).toBe("enabled-rows-verified");

    for (const invalid of [
      { ...capability, evidenceIds: [] },
      { ...capability, evidenceTier: "emulator" },
      { ...capability, modelFamily: "ledger-nano-s-plus" },
      { ...capability, policy: "single-sig-taproot-bip86-v1" },
      { ...capability, freshness: { ...capability.freshness, status: "expired" } },
      { ...capability, freshness: { ...capability.freshness, expiresAt: AS_OF } },
    ]) {
      expect(
        classifyHardwareReleaseDecision([invalid], evidence, 0, asOf),
      ).toMatchObject({
        status: "blocked-invalid-enabled-row",
        issues: [{
          capabilityId: invalid.id,
          code: "enabled-row-lacks-exact-fresh-tier3-proof",
        }],
      });
    }
    expect(
      classifyHardwareReleaseDecision([], [], 1, asOf),
    ).toMatchObject({
      status: "blocked-invalid-enabled-row",
      issues: [{ capabilityId: null, code: "invalid-physical-fixture-set" }],
    });
    expect(
      classifyHardwareReleaseDecision([], [evidence[0], evidence[0]], 0, asOf),
    ).toMatchObject({
      status: "blocked-invalid-enabled-row",
      issues: [{ capabilityId: null, code: "ambiguous-physical-evidence-id" }],
    });
  });

  it("requires physical evidence trust roots to match an external release pin", () => {
    const trust = "reviewed trust roots";
    const digest = createHash("sha256").update(trust).digest("hex");
    expect(validateExternallyPinnedTrust(0, trust, null)).toEqual([]);
    expect(validateExternallyPinnedTrust(1, trust, null)).toMatchObject([
      { code: "missing-external-trust-root-pin" },
    ]);
    expect(validateExternallyPinnedTrust(1, trust, "not-a-digest")).toMatchObject([
      { code: "missing-external-trust-root-pin" },
    ]);
    expect(validateExternallyPinnedTrust(1, `${trust}!`, digest)).toMatchObject([
      { code: "external-trust-root-pin-mismatch" },
    ]);
    expect(validateExternallyPinnedTrust(1, trust, digest)).toEqual([]);
  });
});

describe("signing-dependency digest", () => {
  // Read from the scope config so the fixture cannot drift from the reviewed list.
  const requiredExactNames = (
    JSON.parse(
      readFileSync(
        resolve(__dirname, "../../config/signing-dependency-scope.json"),
        "utf8",
      ),
    ) as { exactPackageNames: string[] }
  ).exactPackageNames;

  const baseLockfile = (): PackageLockFile => ({
    packages: {
      "": { version: "0.8.72" },
      "node_modules/hono": {
        version: "4.6.0",
        resolved: "https://registry.npmjs.org/hono/-/hono-4.6.0.tgz",
        integrity: "sha512-hono",
      },
      ...Object.fromEntries(
        requiredExactNames.map((name, index) => [
          `node_modules/${name}`,
          {
            version: `${index + 1}.0.0`,
            resolved: `https://registry.npmjs.org/${name}/-/${name}-${index + 1}.0.0.tgz`,
            integrity: `sha512-${name.replace(/[^a-z0-9]/gi, "")}`,
          },
        ]),
      ),
      "node_modules/@ledgerhq/hw-app-btc": {
        version: "10.0.0",
        resolved: "https://registry.npmjs.org/@ledgerhq/hw-app-btc/-/hw-app-btc-10.0.0.tgz",
        integrity: "sha512-ledger",
      },
      "node_modules/@trezor/connect": {
        version: "9.7.3",
        resolved: "https://registry.npmjs.org/@trezor/connect/-/connect-9.7.3.tgz",
        integrity: "sha512-trezor",
      },
    },
  });

  it("is unaffected by an unrelated package version change", () => {
    const before = computeSigningDependencySha256(baseLockfile());
    const after = baseLockfile();
    after.packages!["node_modules/hono"] = {
      version: "4.9.9",
      resolved: "https://registry.npmjs.org/hono/-/hono-4.9.9.tgz",
      integrity: "sha512-different",
    };
    expect(computeSigningDependencySha256(after).sha256).toBe(before.sha256);
  });

  it("changes when a scoped package version changes", () => {
    const before = computeSigningDependencySha256(baseLockfile());
    const after = baseLockfile();
    after.packages!["node_modules/ecpair"] = {
      ...after.packages!["node_modules/ecpair"],
      version: "9.9.9",
    };
    expect(computeSigningDependencySha256(after).sha256).not.toBe(before.sha256);
  });

  it("changes when only a scoped package's integrity changes", () => {
    const before = computeSigningDependencySha256(baseLockfile());
    const after = baseLockfile();
    after.packages!["node_modules/bitcoinjs-lib"] = {
      ...after.packages!["node_modules/bitcoinjs-lib"],
      integrity: "sha512-tampered",
    };
    expect(computeSigningDependencySha256(after).sha256).not.toBe(before.sha256);
  });

  it("changes when a nested copy of a scoped package changes", () => {
    const before = computeSigningDependencySha256(baseLockfile());
    const after = baseLockfile();
    after.packages!["node_modules/some-tool/node_modules/ecpair"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/ecpair/-/ecpair-1.0.0.tgz",
      integrity: "sha512-nested",
    };
    expect(computeSigningDependencySha256(after).sha256).not.toBe(before.sha256);
  });

  it("covers @ledgerhq/* and @trezor/* prefix matches", () => {
    const before = computeSigningDependencySha256(baseLockfile());
    const after = baseLockfile();
    after.packages!["node_modules/@ledgerhq/hw-app-btc"] = {
      ...after.packages!["node_modules/@ledgerhq/hw-app-btc"],
      version: "11.0.0",
    };
    expect(computeSigningDependencySha256(after).sha256).not.toBe(before.sha256);

    const trezorChanged = baseLockfile();
    trezorChanged.packages!["node_modules/@trezor/connect"] = {
      ...trezorChanged.packages!["node_modules/@trezor/connect"],
      version: "10.0.0",
    };
    expect(computeSigningDependencySha256(trezorChanged).sha256).not.toBe(before.sha256);
  });

  it("throws a hard error when a required scoped package is missing", () => {
    const lockfile = baseLockfile();
    delete lockfile.packages!["node_modules/ecpair"];
    expect(() => computeSigningDependencySha256(lockfile)).toThrow(
      /required package "ecpair" is not present/,
    );
  });

  it("throws when a matched scoped package has no resolved version", () => {
    const lockfile = baseLockfile();
    lockfile.packages!["node_modules/ecpair"] = { resolved: "x", integrity: "y" };
    expect(() => computeSigningDependencySha256(lockfile)).toThrow(
      /has no resolved version/,
    );
  });

  it("is deterministic regardless of the lockfile's key order", () => {
    const forward = computeSigningDependencySha256(baseLockfile());
    const reversedPackages = Object.fromEntries(
      Object.entries(baseLockfile().packages!).reverse(),
    );
    const reversed = computeSigningDependencySha256({ packages: reversedPackages });
    expect(reversed.sha256).toBe(forward.sha256);
    expect(reversed.packages).toEqual(forward.packages);
  });

  it("returns a sorted, deduplicated name@version list", () => {
    const { packages } = computeSigningDependencySha256(baseLockfile());
    expect(packages).toEqual([...packages].sort());
    expect(new Set(packages).size).toBe(packages.length);
    expect(packages).toContain(
      `ecpair@${requiredExactNames.indexOf("ecpair") + 1}.0.0`,
    );
  });
});
