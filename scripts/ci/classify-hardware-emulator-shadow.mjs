#!/usr/bin/env node
import { execFile } from "node:child_process";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  HARDWARE_EMULATOR_VENDORS,
  checkInventory,
  classifyInventoryPaths,
  loadInventory,
  matchesRepositoryPattern,
  validateInventoryShape,
} from "./hardware-emulator-source-inventory.mjs";
import { ciStepSummaryFile } from "./provider-context.mjs";

const execFileAsync = promisify(execFile);
const FORCE_ALL_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const DIFF_EVENTS = new Set(["pull_request", "merge_group", "push"]);
const ZERO_SHA = "0".repeat(40);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const UNKNOWN_HARDWARE_PATTERNS = Object.freeze([
  "src/services/hardwareWallet/**",
  "config/*emulator*",
  "config/*emulator*/**",
  "config/tooling/*emulator*",
  "scripts/ci/*emulator*",
  "tests/integration/*Emulator*",
  "tests/integration/*Emulator*/**",
]);

class ShadowFallbackError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.reasonCode = reasonCode;
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function vendorReport(wouldRun, matchedPaths, reasonCodes) {
  return {
    wouldRun,
    matchedPaths: uniqueSorted(matchedPaths),
    reasonCodes: uniqueSorted(reasonCodes),
  };
}

function optionalString(value) {
  return typeof value === "string" ? value : "";
}

function runEnvelope(context) {
  return {
    id: optionalString(context.runId),
    attempt: optionalString(context.runAttempt),
    event: optionalString(context.eventName),
    baseSha: optionalString(context.baseSha),
    headSha: optionalString(context.headSha),
  };
}

export function forcedAllReport(context, reasonCodes, diagnostics = []) {
  const reasons = uniqueSorted(reasonCodes);
  return {
    schemaVersion: 1,
    mode: "shadow",
    run: runEnvelope(context),
    status: "forced_all",
    forceAll: true,
    reasonCodes: reasons,
    diagnostics: uniqueSorted(diagnostics),
    changedPaths: [],
    unknownHardwarePaths: [],
    vendors: Object.fromEntries(
      HARDWARE_EMULATOR_VENDORS.map((vendor) => [
        vendor,
        vendorReport(true, [], reasons),
      ]),
    ),
    execution: {
      emulatorsConditioned: false,
      summaryConditioned: false,
    },
  };
}

function selectedPaths(classified) {
  return new Set([
    ...classified.common,
    ...HARDWARE_EMULATOR_VENDORS.flatMap(
      (vendor) => classified.vendors[vendor],
    ),
  ]);
}

function findUnknownHardwarePaths(changedPaths, classified) {
  const selected = selectedPaths(classified);
  return changedPaths.filter(
    (path) =>
      !selected.has(path) &&
      UNKNOWN_HARDWARE_PATTERNS.some((pattern) =>
        matchesRepositoryPattern(path, pattern),
      ),
  );
}

function classifiedVendorReports(classified, forceAll, forceReasons) {
  return Object.fromEntries(
    HARDWARE_EMULATOR_VENDORS.map((vendor) => {
      const vendorMatches = classified.vendors[vendor];
      const matchedPaths = [...classified.common, ...vendorMatches];
      const reasons = [...forceReasons];
      if (classified.common.length > 0) reasons.push("common_source");
      if (vendorMatches.length > 0) reasons.push("vendor_source");
      return [
        vendor,
        vendorReport(forceAll || matchedPaths.length > 0, matchedPaths, reasons),
      ];
    }),
  );
}

export function classifyHardwareEmulatorShadow(context, inventory) {
  validateInventoryShape(inventory);
  if (FORCE_ALL_EVENTS.has(context.eventName)) {
    return forcedAllReport(context, ["scheduled_or_manual"]);
  }
  if (!DIFF_EVENTS.has(context.eventName)) {
    return forcedAllReport(context, ["unsupported_event"]);
  }
  const changedPaths = uniqueSorted(context.changedPaths ?? []);
  if (changedPaths.length === 0) {
    return forcedAllReport(context, ["empty_diff"]);
  }

  const classified = classifyInventoryPaths(inventory, changedPaths);
  const unknownHardwarePaths = findUnknownHardwarePaths(
    changedPaths,
    classified,
  );
  const forceAll = unknownHardwarePaths.length > 0;
  const forceReasons = forceAll ? ["unknown_hardware_path"] : [];
  const hasCommon = classified.common.length > 0;
  const hasVendor = HARDWARE_EMULATOR_VENDORS.some(
    (vendor) => classified.vendors[vendor].length > 0,
  );
  const reasonCodes = [...forceReasons];
  if (hasCommon) reasonCodes.push("common_source");
  if (hasVendor) reasonCodes.push("vendor_source");
  if (!forceAll && !hasCommon && !hasVendor) {
    reasonCodes.push("unrelated_change");
  }

  return {
    schemaVersion: 1,
    mode: "shadow",
    run: runEnvelope(context),
    status: forceAll ? "forced_all" : "classified",
    forceAll,
    reasonCodes: uniqueSorted(reasonCodes),
    diagnostics: [],
    changedPaths,
    unknownHardwarePaths,
    vendors: classifiedVendorReports(classified, forceAll, forceReasons),
    execution: {
      emulatorsConditioned: false,
      summaryConditioned: false,
    },
  };
}

function environmentString(environment, name) {
  return optionalString(environment[name]);
}

function firstNonempty(...values) {
  return values.find((value) => value.length > 0) ?? "";
}

function eventRevisions(environment, eventName) {
  const workflowSha = environmentString(environment, "WORKFLOW_SHA");
  switch (eventName) {
    case "pull_request":
      return {
        baseSha: environmentString(environment, "PR_BASE_SHA"),
        headSha: firstNonempty(
          environmentString(environment, "PR_HEAD_SHA"),
          workflowSha,
        ),
      };
    case "merge_group":
      return {
        baseSha: environmentString(environment, "MERGE_GROUP_BASE_SHA"),
        headSha: firstNonempty(
          environmentString(environment, "MERGE_GROUP_HEAD_SHA"),
          workflowSha,
        ),
      };
    case "push":
      return {
        baseSha: environmentString(environment, "PUSH_BEFORE_SHA"),
        headSha: workflowSha,
      };
    default:
      return { baseSha: "", headSha: workflowSha };
  }
}

function contextFromEnvironment(environment) {
  const eventName = environmentString(environment, "EVENT_NAME");
  const revisions = eventRevisions(environment, eventName);
  return {
    eventName,
    ...revisions,
    runId: environmentString(environment, "SANCTUARY_CI_RUN_ID_OVERRIDE"),
    runAttempt: environmentString(
      environment,
      "SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE",
    ),
  };
}

function requireRevision(sha, label) {
  if (!SHA_PATTERN.test(sha) || sha === ZERO_SHA) {
    throw new ShadowFallbackError(
      "missing_revision",
      `${label} revision is missing or invalid`,
    );
  }
}

async function verifyRevision(root, sha, label) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `${sha}^{commit}`], {
      cwd: root,
    });
  } catch {
    throw new ShadowFallbackError(
      "unresolvable_revision",
      `${label} revision is not available in the checkout`,
    );
  }
}

function diffRevisionArguments(context) {
  if (context.eventName === "pull_request") {
    return [`${context.baseSha}...${context.headSha}`];
  }
  return [context.baseSha, context.headSha];
}

async function changedPathsForEvent(root, context) {
  requireRevision(context.baseSha, "base");
  requireRevision(context.headSha, "head");
  await verifyRevision(root, context.baseSha, "base");
  await verifyRevision(root, context.headSha, "head");
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        ...diffRevisionArguments(context),
        "--",
      ],
      { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    );
    return new TextDecoder("utf-8", { fatal: true })
      .decode(stdout)
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new ShadowFallbackError(
      "diff_error",
      "failed to compute the revision-bound changed-path set",
    );
  }
}

function fallbackReason(error) {
  if (error instanceof ShadowFallbackError) return error.reasonCode;
  if (
    error instanceof Error &&
    error.message.startsWith("hardware emulator source inventory:")
  ) {
    return error.message.includes("candidatePaths[")
      ? "invalid_changed_path"
      : "inventory_error";
  }
  return "inventory_error";
}

function diagnosticMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function generateHardwareEmulatorShadowReport({
  root,
  environment,
}) {
  const context = contextFromEnvironment(environment);
  try {
    const inventory = validateInventoryShape(await loadInventory(root));
    await checkInventory(root);
    if (FORCE_ALL_EVENTS.has(context.eventName)) {
      return classifyHardwareEmulatorShadow(context, inventory);
    }
    if (!DIFF_EVENTS.has(context.eventName)) {
      return classifyHardwareEmulatorShadow(context, inventory);
    }
    const changedPaths = await changedPathsForEvent(root, context);
    return classifyHardwareEmulatorShadow(
      { ...context, changedPaths },
      inventory,
    );
  } catch (error) {
    return forcedAllReport(
      context,
      [fallbackReason(error)],
      [diagnosticMessage(error)],
    );
  }
}

async function writeReportAtomically(outputPath, report) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
}

function markdownSummary(report) {
  const lines = [
    "### Hardware emulator shadow classification",
    "",
    `Status: \`${report.status}\`; actual emulator execution remains unconditional.`,
    "",
    "| Emulator | Would run under shadow policy | Matched paths |",
    "| --- | --- | ---: |",
  ];
  for (const vendor of HARDWARE_EMULATOR_VENDORS) {
    const decision = report.vendors[vendor];
    lines.push(
      `| ${vendor} | ${decision.wouldRun ? "yes" : "no"} | ${decision.matchedPaths.length} |`,
    );
  }
  lines.push("", `Reasons: ${report.reasonCodes.join(", ")}`, "");
  return `${lines.join("\n")}\n`;
}

function usage() {
  return "usage: classify-hardware-emulator-shadow.mjs --output <report.json>";
}

export async function runCli(
  args,
  { root = process.cwd(), environment = process.env } = {},
) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new Error(usage());
  }
  const outputPath = resolve(root, args[1]);
  const report = await generateHardwareEmulatorShadowReport({
    root,
    environment,
  });
  await writeReportAtomically(outputPath, report);
  const summaryPath =
    environment.SANCTUARY_CI_STEP_SUMMARY_FILE ?? ciStepSummaryFile();
  if (summaryPath) await appendFile(summaryPath, markdownSummary(report), "utf8");
  if (report.forceAll && report.reasonCodes[0] !== "scheduled_or_manual") {
    process.stderr.write(
      `hardware emulator shadow classifier forced all: ${report.reasonCodes.join(", ")}\n`,
    );
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
