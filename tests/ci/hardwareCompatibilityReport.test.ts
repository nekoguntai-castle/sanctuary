import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHardwareCompatibilityReport,
  classifyHardwareReleaseDecision,
  renderHardwareCompatibilityMarkdown,
} from "../../scripts/ci/hardware-compatibility-report";

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
    expect(first.capabilityRows).toHaveLength(18);
    expect(first.hardwareRows).toHaveLength(22);
    expect(new Set(first.capabilityRows.map(({ id }) => id)).size).toBe(18);
    expect(
      new Set(
        first.hardwareRows.map(
          ({ vendor, scriptType }) => `${vendor}:${scriptType}`,
        ),
      ).size,
    ).toBe(22);
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
    expect(classifyHardwareReleaseDecision([], 0)).toBe("safe-fail-closed");
    expect(
      classifyHardwareReleaseDecision([{ evidenceIds: ["proof"] }], 0),
    ).toBe("enabled-rows-require-strict-release-verification");
    expect(classifyHardwareReleaseDecision([{ evidenceIds: [] }], 0)).toBe(
      "blocked-invalid-enabled-row",
    );
    expect(
      classifyHardwareReleaseDecision([{ evidenceIds: ["proof"] }], 1),
    ).toBe("blocked-invalid-enabled-row");
  });
});
