import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  classifyHardwareEmulatorShadow,
  generateHardwareEmulatorShadowReport,
  runCli,
} from "../../scripts/ci/classify-hardware-emulator-shadow.mjs";
import {
  HARDWARE_EMULATOR_VENDORS,
  classifyInventoryPaths,
  listRepositoryFiles,
  loadInventory,
} from "../../scripts/ci/hardware-emulator-source-inventory.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../..");

function fixtureInventory() {
  return {
    schemaVersion: 1,
    common: {
      files: ["common.txt"],
      patterns: ["shared/**"],
    },
    vendors: {
      trezor: { files: ["trezor.txt"], patterns: ["trezor/**"] },
      ledger: { files: ["ledger.txt"], patterns: ["ledger/**"] },
      jade: { files: ["jade.txt"], patterns: ["jade/**"] },
    },
  };
}

function context(changedPaths, eventName = "pull_request") {
  return {
    eventName,
    baseSha: "1".repeat(40),
    headSha: "2".repeat(40),
    runId: "123",
    runAttempt: "2",
    changedPaths,
  };
}

function decisions(report) {
  return Object.fromEntries(
    Object.entries(report.vendors).map(([vendor, value]) => [
      vendor,
      value.wouldRun,
    ]),
  );
}

test("common, vendor, mixed, and unrelated paths classify deterministically", () => {
  const inventory = fixtureInventory();
  const common = classifyHardwareEmulatorShadow(
    context(["shared/nested.ts"]),
    inventory,
  );
  assert.deepEqual(decisions(common), {
    trezor: true,
    ledger: true,
    jade: true,
  });
  assert.deepEqual(common.reasonCodes, ["common_source"]);

  const vendor = classifyHardwareEmulatorShadow(
    context(["trezor/new.ts", "trezor.txt", "trezor/new.ts"]),
    inventory,
  );
  assert.deepEqual(decisions(vendor), {
    trezor: true,
    ledger: false,
    jade: false,
  });
  assert.deepEqual(vendor.changedPaths, ["trezor.txt", "trezor/new.ts"]);
  assert.deepEqual(vendor.vendors.trezor.matchedPaths, [
    "trezor.txt",
    "trezor/new.ts",
  ]);

  const mixed = classifyHardwareEmulatorShadow(
    context(["jade/new.ts", "ledger/new.ts"]),
    inventory,
  );
  assert.deepEqual(decisions(mixed), {
    trezor: false,
    ledger: true,
    jade: true,
  });

  const unrelated = classifyHardwareEmulatorShadow(
    context(["docs/readme.md"]),
    inventory,
  );
  assert.deepEqual(decisions(unrelated), {
    trezor: false,
    ledger: false,
    jade: false,
  });
  assert.deepEqual(unrelated.reasonCodes, ["unrelated_change"]);
});

test("unknown hardware adapters and emulator control paths force every vendor", () => {
  for (const path of [
    "src/services/hardwareWallet/adapters/bitbox/signPsbt.ts",
    "src/services/hardwareWallet/providers/future/session.ts",
    "config/future-emulator/proof.json",
    "config/tooling/vitest.future-emulator.config.ts",
    "scripts/ci/run-future-emulator-proof.sh",
    "tests/integration/futureEmulator.integration.test.ts",
    "tests/integration/futureEmulator/fixtures.ts",
  ]) {
    const report = classifyHardwareEmulatorShadow(
      context([path]),
      fixtureInventory(),
    );
    assert.equal(report.status, "forced_all", path);
    assert.equal(report.forceAll, true, path);
    assert.deepEqual(report.unknownHardwarePaths, [path], path);
    assert.deepEqual(decisions(report), {
      trezor: true,
      ledger: true,
      jade: true,
    });
  }
});

test("known vendor paths do not trigger the unknown-provider fallback", () => {
  const report = classifyHardwareEmulatorShadow(
    context(["trezor/new-proof.ts"]),
    fixtureInventory(),
  );
  assert.equal(report.forceAll, false);
  assert.deepEqual(report.unknownHardwarePaths, []);
  assert.deepEqual(decisions(report), {
    trezor: true,
    ledger: false,
    jade: false,
  });
});

test("checked-in canonical selectors drive every shadow decision", async () => {
  const inventory = await loadInventory(REPO_ROOT);
  const classified = classifyInventoryPaths(
    inventory,
    await listRepositoryFiles(REPO_ROOT),
  );
  for (const path of classified.common) {
    assert.deepEqual(
      decisions(classifyHardwareEmulatorShadow(context([path]), inventory)),
      { trezor: true, ledger: true, jade: true },
      path,
    );
  }
  for (const vendor of HARDWARE_EMULATOR_VENDORS) {
    for (const path of classified.vendors[vendor]) {
      const expected = { trezor: false, ledger: false, jade: false };
      expected[vendor] = true;
      assert.deepEqual(
        decisions(classifyHardwareEmulatorShadow(context([path]), inventory)),
        expected,
        path,
      );
    }
  }
});

test("schedule, manual, unsupported, and empty changes fail closed", () => {
  for (const [eventName, expectedReason] of [
    ["schedule", "scheduled_or_manual"],
    ["workflow_dispatch", "scheduled_or_manual"],
    ["repository_dispatch", "unsupported_event"],
  ]) {
    const report = classifyHardwareEmulatorShadow(
      context([], eventName),
      fixtureInventory(),
    );
    assert.equal(report.status, "forced_all");
    assert.deepEqual(report.reasonCodes, [expectedReason]);
    assert.ok(Object.values(decisions(report)).every(Boolean));
  }

  const empty = classifyHardwareEmulatorShadow(context([]), fixtureInventory());
  assert.deepEqual(empty.reasonCodes, ["empty_diff"]);
  assert.ok(Object.values(decisions(empty)).every(Boolean));
});

test("unsafe changed paths are rejected before classification", () => {
  for (const path of ["../escape", "/absolute", "bad\npath", "bad\\path"]) {
    assert.throws(
      () =>
        classifyHardwareEmulatorShadow(context([path]), fixtureInventory()),
      /hardware emulator source inventory:/u,
    );
  }
});

async function git(root, args) {
  const { stdout = "" } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function writeFixture(root, path, contents = `${path}\n`) {
  const target = resolve(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

async function createRepository() {
  const root = await mkdtemp(resolve(tmpdir(), "hardware-shadow-"));
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Codex Test"]);
  await git(root, ["config", "user.email", "codex@example.com"]);
  await writeFixture(
    root,
    "config/hardware-emulator-source-inventory.json",
    `${JSON.stringify(fixtureInventory(), null, 2)}\n`,
  );
  for (const path of [
    "common.txt",
    "shared/base.ts",
    "trezor.txt",
    "trezor/base.ts",
    "trezor/original.ts",
    "ledger.txt",
    "ledger/base.ts",
    "jade.txt",
    "jade/base.ts",
  ]) {
    await writeFixture(root, path);
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "base"]);
  return root;
}

function pullRequestEnvironment(baseSha, headSha, extra = {}) {
  return {
    EVENT_NAME: "pull_request",
    PR_BASE_SHA: baseSha,
    PR_HEAD_SHA: headSha,
    WORKFLOW_SHA: headSha,
    SANCTUARY_CI_RUN_ID_OVERRIDE: "88",
    SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE: "3",
    ...extra,
  };
}

test("revision-bound diff retains deletion and rename source paths", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseSha = await git(root, ["rev-parse", "HEAD"]);
  await mkdir(resolve(root, "docs"), { recursive: true });
  await git(root, ["mv", "trezor/original.ts", "docs/renamed.md"]);
  await git(root, ["commit", "-qm", "rename source"]);
  const headSha = await git(root, ["rev-parse", "HEAD"]);

  const report = await generateHardwareEmulatorShadowReport({
    root,
    environment: pullRequestEnvironment(baseSha, headSha),
  });
  assert.deepEqual(report.changedPaths, [
    "docs/renamed.md",
    "trezor/original.ts",
  ]);
  assert.deepEqual(decisions(report), {
    trezor: true,
    ledger: false,
    jade: false,
  });
});

test("pull requests exclude base-only changes from diverged history", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const commonAncestor = await git(root, ["rev-parse", "HEAD"]);

  await writeFixture(root, "trezor/base.ts", "base branch only\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "base-only vendor change"]);
  const baseSha = await git(root, ["rev-parse", "HEAD"]);

  await git(root, ["checkout", "-qb", "feature", commonAncestor]);
  await writeFixture(root, "docs/readme.md", "head branch only\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "head-only docs change"]);
  const headSha = await git(root, ["rev-parse", "HEAD"]);

  const report = await generateHardwareEmulatorShadowReport({
    root,
    environment: pullRequestEnvironment(baseSha, headSha),
  });
  assert.deepEqual(report.changedPaths, ["docs/readme.md"]);
  assert.deepEqual(decisions(report), {
    trezor: false,
    ledger: false,
    jade: false,
  });
});

test("merge groups and pushes retain exact two-revision semantics", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const commonAncestor = await git(root, ["rev-parse", "HEAD"]);

  await writeFixture(root, "ledger/base.ts", "base branch only\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "base-only vendor change"]);
  const baseSha = await git(root, ["rev-parse", "HEAD"]);
  await git(root, ["checkout", "-qb", "exact-head", commonAncestor]);
  await writeFixture(root, "docs/readme.md", "head branch only\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "head-only docs change"]);
  const headSha = await git(root, ["rev-parse", "HEAD"]);

  for (const environment of [
    {
      EVENT_NAME: "merge_group",
      MERGE_GROUP_BASE_SHA: baseSha,
      MERGE_GROUP_HEAD_SHA: headSha,
      WORKFLOW_SHA: headSha,
    },
    {
      EVENT_NAME: "push",
      PUSH_BEFORE_SHA: baseSha,
      WORKFLOW_SHA: headSha,
    },
  ]) {
    const report = await generateHardwareEmulatorShadowReport({
      root,
      environment,
    });
    assert.deepEqual(report.changedPaths, [
      "docs/readme.md",
      "ledger/base.ts",
    ]);
    assert.deepEqual(decisions(report), {
      trezor: false,
      ledger: true,
      jade: false,
    });
  }
});

test("missing and unavailable revisions emit valid force-all reports", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const headSha = await git(root, ["rev-parse", "HEAD"]);

  const missing = await generateHardwareEmulatorShadowReport({
    root,
    environment: pullRequestEnvironment("", headSha),
  });
  assert.deepEqual(missing.reasonCodes, ["missing_revision"]);
  assert.ok(Object.values(decisions(missing)).every(Boolean));

  const unavailable = await generateHardwareEmulatorShadowReport({
    root,
    environment: pullRequestEnvironment("f".repeat(40), headSha),
  });
  assert.deepEqual(unavailable.reasonCodes, ["unresolvable_revision"]);
  assert.ok(Object.values(decisions(unavailable)).every(Boolean));
});

test("invalid changed paths and diff failures emit specific force-all reports", async (t) => {
  const invalidPathRoot = await createRepository();
  t.after(() => rm(invalidPathRoot, { recursive: true, force: true }));
  await writeFixture(invalidPathRoot, "bad\\path", "invalid path\n");
  await git(invalidPathRoot, ["add", "."]);
  await git(invalidPathRoot, ["commit", "-qm", "add invalid path"]);
  const invalidPathBase = await git(invalidPathRoot, ["rev-parse", "HEAD"]);
  await rm(resolve(invalidPathRoot, "bad\\path"));
  await git(invalidPathRoot, ["add", "."]);
  await git(invalidPathRoot, ["commit", "-qm", "delete invalid path"]);
  const invalidPathHead = await git(invalidPathRoot, ["rev-parse", "HEAD"]);
  const invalidPathReport = await generateHardwareEmulatorShadowReport({
    root: invalidPathRoot,
    environment: pullRequestEnvironment(invalidPathBase, invalidPathHead),
  });
  assert.deepEqual(invalidPathReport.reasonCodes, ["invalid_changed_path"]);
  assert.ok(Object.values(decisions(invalidPathReport)).every(Boolean));

  const diffErrorRoot = await createRepository();
  t.after(() => rm(diffErrorRoot, { recursive: true, force: true }));
  const diffErrorBase = await git(diffErrorRoot, ["rev-parse", "HEAD"]);
  const tree = await git(diffErrorRoot, ["rev-parse", "HEAD^{tree}"]);
  const unrelatedHead = await git(diffErrorRoot, [
    "commit-tree",
    tree,
    "-m",
    "unrelated root",
  ]);
  const diffErrorReport = await generateHardwareEmulatorShadowReport({
    root: diffErrorRoot,
    environment: pullRequestEnvironment(diffErrorBase, unrelatedHead),
  });
  assert.deepEqual(diffErrorReport.reasonCodes, ["diff_error"]);
  assert.ok(Object.values(decisions(diffErrorReport)).every(Boolean));
});

test("malformed inventory emits a valid force-all report", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sha = await git(root, ["rev-parse", "HEAD"]);
  await writeFixture(
    root,
    "config/hardware-emulator-source-inventory.json",
    '{"schemaVersion":999}\n',
  );
  const report = await generateHardwareEmulatorShadowReport({
    root,
    environment: pullRequestEnvironment(sha, sha),
  });
  assert.deepEqual(report.reasonCodes, ["inventory_error"]);
  assert.ok(Object.values(decisions(report)).every(Boolean));
});

test("CLI writes the machine report and human summary without job outputs", async (t) => {
  const root = await createRepository();
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseSha = await git(root, ["rev-parse", "HEAD"]);
  await writeFixture(root, "docs/readme.md", "unrelated\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "docs"]);
  const headSha = await git(root, ["rev-parse", "HEAD"]);
  const summaryPath = resolve(root, "summary.md");

  await runCli(["--output", "report/report.json"], {
    root,
    environment: pullRequestEnvironment(baseSha, headSha, {
      SANCTUARY_CI_STEP_SUMMARY_FILE: summaryPath,
    }),
  });
  const report = JSON.parse(
    await readFile(resolve(root, "report/report.json"), "utf8"),
  );
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, "shadow");
  assert.equal(report.execution.emulatorsConditioned, false);
  assert.equal(report.execution.summaryConditioned, false);
  assert.deepEqual(report.reasonCodes, ["unrelated_change"]);
  assert.match(
    await readFile(summaryPath, "utf8"),
    /actual emulator execution remains unconditional/u,
  );
});

test("CLI rejects missing, malformed, and empty output arguments", async () => {
  for (const args of [[], ["--output"], ["--output", ""], ["report.json"]]) {
    await assert.rejects(() => runCli(args), /usage: classify-hardware/u);
  }
});
