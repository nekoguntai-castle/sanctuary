import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  checkInventory,
  expandInventory,
  findRelevantDirtySources,
  listRepositoryFiles,
  matchesRepositoryPattern,
  resolveVendorSources,
  runCli,
  validateInventoryShape,
} from "../../scripts/ci/hardware-emulator-source-inventory.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(
  REPO_ROOT,
  "scripts/ci/hardware-emulator-source-inventory.mjs",
);

const LEGACY_SOURCES = {
  trezor: [
    ".github/actions/setup-node-toolchain/action.yml",
    ".github/workflows/verify-vectors.yml",
    ".nvmrc",
    "package.json",
    "package-lock.json",
    "scripts/ci/ensure-node.sh",
    "scripts/ci/check-trezor-transport-provenance.sh",
    "scripts/ci/images/go-runner.Dockerfile",
    "scripts/ci/provider-context.sh",
    "scripts/ci/docker-exec-tcp-forwarder.mjs",
    "scripts/ci/resolve-trezor-publish-binding.sh",
    "shared/constants/hardwareWalletCapabilities.ts",
    "shared/constants/walletPolicy.ts",
    "src/hooks/send/types.ts",
    "src/hooks/send/useUsbSigning.ts",
    "src/hooks/useHardwareWallet.ts",
    "src/services/hardwareWallet/identity.ts",
    "src/services/hardwareWallet/psbtAccountBinding.ts",
    "src/services/hardwareWallet/service.ts",
    "src/services/hardwareWallet/types.ts",
    "src/services/hardwareWallet/adapters/trezor/index.ts",
    "src/services/hardwareWallet/adapters/trezor/multisig.ts",
    "src/services/hardwareWallet/adapters/trezor/pathUtils.ts",
    "src/services/hardwareWallet/adapters/trezor/refTxs.ts",
    "src/services/hardwareWallet/adapters/trezor/sessionIdentity.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbt.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtErrors.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtNetwork.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtPayloads.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtSignatures.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtTypes.ts",
    "src/services/hardwareWallet/adapters/trezor/signPsbtValidation.ts",
    "src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts",
    "src/services/hardwareWallet/adapters/trezor/types.ts",
    "src/services/hardwareWallet/adapters/trezor/xpubUtils.ts",
    "config/tooling/vitest.trezor-emulator.config.ts",
    "config/trezor-emulator-proof.json",
    "scripts/ci/run-trezor-emulator-proof.sh",
    "tests/fixtures/trezorEmulatorProof.ts",
    "tests/ci/dockerExecTcpForwarder.test.ts",
    "tests/ci/trezorEmulatorRunnerPreflight.test.ts",
    "tests/config/trezorEmulatorProofBinding.test.ts",
    "tests/config/trezorEmulatorProofConfig.test.ts",
    "tests/integration/trezorEmulator.integration.test.ts",
    "tests/integration/trezorEmulator/controller.test.ts",
    "tests/integration/trezorEmulator/controller.ts",
    "tests/integration/trezorEmulator/fixtures.ts",
    "tests/integration/trezorEmulator/proofReplay.ts",
  ],
  ledger: [
    "package-lock.json",
    "config/ledger-emulator/Dockerfile",
    "config/ledger-emulator/automation.json",
    "config/ledger-emulator/proof.json",
    "config/tooling/vitest.ledger-emulator.config.ts",
    "scripts/ci/docker-exec-tcp-forwarder.mjs",
    "scripts/ci/run-ledger-emulator-proof.sh",
    "src/services/hardwareWallet/adapters/ledger/ledgerAdapter.ts",
    "src/services/hardwareWallet/adapters/ledger/session.ts",
    "src/services/hardwareWallet/adapters/ledger/signPsbt.ts",
    "src/services/hardwareWallet/adapters/ledger/walletPolicy.ts",
    "tests/integration/ledgerEmulator.integration.test.ts",
    "tests/integration/ledgerEmulator/fixtures.ts",
    ".github/workflows/verify-vectors.yml",
  ],
  jade: [
    ".github/workflows/quality.yml",
    ".github/workflows/verify-vectors.yml",
    ".nvmrc",
    "package.json",
    "package-lock.json",
    "config/jade-emulator-proof.json",
    "config/tooling/vitest.jade-emulator.config.ts",
    "config/wallet-safety-critical-paths.json",
    "docs/reference/hardware-wallet-validation.md",
    "docs/reference/release-gates.md",
    "docs/reference/trust-and-verification.md",
    "scripts/ci/check-wallet-safety-classifier.mjs",
    "scripts/ci/docker-exec-tcp-forwarder.mjs",
    "scripts/ci/download-verified-source.sh",
    "scripts/ci/provider-context.sh",
    "scripts/ci/run-jade-emulator-proof.sh",
    "scripts/ci/verify-jade-junit.mjs",
    "shared/constants/walletPolicy.ts",
    "shared/schemas/psbtSigningContext.ts",
    "src/services/hardwareWallet/adapters/jadeIdentity.ts",
    "server/tests/fixtures/hardware-signed-psbt-vectors.ts",
    "server/tests/helpers/hardwareSignedEvidenceProvenance.ts",
    "server/tests/helpers/hardwareSignedFixtureIntake.ts",
    "src/services/hardwareWallet/adapters/jadeProtocol.ts",
    "src/services/hardwareWallet/adapters/jadeSignedPsbt.ts",
    "src/services/hardwareWallet/psbtAccountBinding.ts",
    "tests/ci/check-wallet-safety-classifier.test.mjs",
    "tests/ci/check-workflow-composition.test.sh",
    "tests/ci/download-verified-source.test.sh",
    "tests/ci/verify-jade-junit.test.mjs",
    "tests/config/jadeEmulatorProofConfig.test.ts",
    "tests/integration/jadeEmulator.integration.test.ts",
    "tests/integration/jadeEmulator/fixtures.ts",
    "tests/integration/jadeEmulator/tcpTransport.ts",
  ],
};

async function checkedInInventory() {
  return JSON.parse(
    await readFile(
      resolve(REPO_ROOT, "config/hardware-emulator-source-inventory.json"),
      "utf8",
    ),
  );
}

async function repositoryFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "-z"],
    { cwd: REPO_ROOT, encoding: "buffer" },
  );
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

function fixtureInventory() {
  return {
    schemaVersion: 1,
    common: { files: ["common.txt"], patterns: ["shared/**"] },
    vendors: {
      trezor: { files: ["trezor.txt"], patterns: ["trezor/**"] },
      ledger: { files: ["ledger.txt"], patterns: ["ledger/**"] },
      jade: { files: ["jade.txt"], patterns: ["jade/**"] },
    },
  };
}

const FIXTURE_FILES = [
  "common.txt",
  "shared/value.ts",
  "trezor.txt",
  "trezor/proof.ts",
  "ledger.txt",
  "ledger/proof.ts",
  "jade.txt",
  "jade/proof.ts",
];

function resolveLocalImport(source, specifier, repositoryFileSet) {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(source), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  if (base.endsWith(".js")) candidates.push(`${base.slice(0, -3)}.ts`);
  return candidates.find((candidate) => repositoryFileSet.has(candidate));
}

async function localSourceImports(source, repositoryFileSet) {
  const text = await readFile(resolve(REPO_ROOT, source), "utf8");
  const imports = new Set();
  const pattern =
    /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu;
  for (const match of text.matchAll(pattern)) {
    const dependency = resolveLocalImport(source, match[1], repositoryFileSet);
    if (dependency) imports.add(dependency);
  }
  return [...imports].sort();
}

test("checked-in inventory validates and retains every legacy proof source", async () => {
  const expanded = expandInventory(
    await checkedInInventory(),
    await repositoryFiles(),
  );
  for (const [vendor, legacySources] of Object.entries(LEGACY_SOURCES)) {
    const missing = legacySources.filter(
      (source) => !expanded.vendors[vendor].includes(source),
    );
    assert.deepEqual(missing, [], `${vendor} lost legacy proof sources`);
    assert.deepEqual(
      expanded.vendors[vendor],
      [...expanded.vendors[vendor]].sort(),
    );
    assert.equal(
      new Set(expanded.vendors[vendor]).size,
      expanded.vendors[vendor].length,
    );
  }
});

test("repository glob semantics keep star within a segment and allow double-star across segments", () => {
  assert.equal(matchesRepositoryPattern("shared/direct.ts", "shared/*"), true);
  assert.equal(
    matchesRepositoryPattern("shared/nested/value.ts", "shared/*"),
    false,
  );
  assert.equal(
    matchesRepositoryPattern("shared/nested/value.ts", "shared/**"),
    true,
  );
  assert.equal(
    matchesRepositoryPattern(
      "src/services/hardwareWallet/runtime.ts",
      "src/services/hardwareWallet/*.ts",
    ),
    true,
  );
  assert.equal(
    matchesRepositoryPattern(
      "src/services/hardwareWallet/adapters/jade.ts",
      "src/services/hardwareWallet/*.ts",
    ),
    false,
  );
});

test("expansion is deterministic and automatically includes new files under prefixes", async () => {
  const inventory = await checkedInInventory();
  const files = await repositoryFiles();
  const added = [
    "shared/new/nested-contract.ts",
    "src/services/hardwareWallet/newCommonContract.ts",
    "src/services/hardwareWallet/adapters/trezor/newProofPath.ts",
  ];
  const forward = expandInventory(inventory, [...files, ...added]);
  const reverse = expandInventory(inventory, [...files, ...added].reverse());
  assert.deepEqual(forward, reverse);
  for (const vendor of ["trezor", "ledger", "jade"]) {
    assert.ok(forward.vendors[vendor].includes(added[0]));
    assert.ok(forward.vendors[vendor].includes(added[1]));
  }
  assert.ok(forward.vendors.trezor.includes(added[2]));
  assert.equal(forward.vendors.ledger.includes(added[2]), false);
  assert.equal(forward.vendors.jade.includes(added[2]), false);
});

test("emulator proof entrypoints retain their recursive local import closure", async () => {
  const files = await repositoryFiles();
  const repositoryFileSet = new Set(files);
  const expanded = expandInventory(await checkedInInventory(), files);
  const entrypoints = {
    trezor: ["tests/integration/trezorEmulator.integration.test.ts"],
    ledger: ["tests/integration/ledgerEmulator.integration.test.ts"],
    jade: ["tests/integration/jadeEmulator.integration.test.ts"],
  };
  for (const vendor of Object.keys(entrypoints)) {
    const selected = new Set(expanded.vendors[vendor]);
    const pending = [...entrypoints[vendor]];
    const visited = new Set();
    while (pending.length > 0) {
      const source = pending.pop();
      if (visited.has(source)) continue;
      visited.add(source);
      for (const dependency of await localSourceImports(
        source,
        repositoryFileSet,
      )) {
        assert.ok(
          selected.has(dependency),
          `${vendor} source closure omits ${dependency}, imported by ${source}`,
        );
        if (!visited.has(dependency)) pending.push(dependency);
      }
    }
  }
});

test("malformed schemas and selectors fail closed", () => {
  const cases = [
    [() => ({ ...fixtureInventory(), schemaVersion: 2 }), /schemaVersion/],
    [
      () => ({ ...fixtureInventory(), extra: true }),
      /root must contain exactly/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.vendors.unknown = value.vendors.jade;
        return value;
      },
      /vendors must contain exactly/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common = { files: [], patterns: [] };
        return value;
      },
      /at least one selector/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.files.push("common.txt");
        return value;
      },
      /duplicate selectors/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.files[0] = "../outside";
        return value;
      },
      /normalized|traversal/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.files[0] = "/absolute";
        return value;
      },
      /repository-relative/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.files[0] = "bad\npath";
        return value;
      },
      /control characters/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.patterns[0] = "shared/exact.ts";
        return value;
      },
      /must contain a wildcard/,
    ],
    [
      () => {
        const value = fixtureInventory();
        value.common.patterns[0] = "shared/**/file?.ts";
        return value;
      },
      /unsupported glob syntax/,
    ],
  ];
  for (const [build, expected] of cases) {
    assert.throws(() => validateInventoryShape(build()), expected);
  }
});

test("missing, empty, and overlapping source selections fail closed", () => {
  const missing = fixtureInventory();
  missing.common.files[0] = "missing.txt";
  assert.throws(
    () => expandInventory(missing, FIXTURE_FILES),
    /exact file does not exist/,
  );

  const emptyPattern = fixtureInventory();
  emptyPattern.common.patterns[0] = "absent/**";
  assert.throws(
    () => expandInventory(emptyPattern, FIXTURE_FILES),
    /matches no repository files/,
  );

  const withinScope = fixtureInventory();
  withinScope.common.files.push("shared/value.ts");
  assert.throws(
    () => expandInventory(withinScope, FIXTURE_FILES),
    /selectors overlap/,
  );

  const acrossScopes = fixtureInventory();
  acrossScopes.vendors.trezor.files.push("shared/value.ts");
  assert.throws(
    () => expandInventory(acrossScopes, FIXTURE_FILES),
    /declared scopes overlap/,
  );
});

test("unknown vendor resolution fails closed", () => {
  assert.throws(
    () => resolveVendorSources(fixtureInventory(), FIXTURE_FILES, "unknown"),
    /unknown vendor/,
  );
});

test("dirty-source detection is vendor-specific and includes untracked pattern matches", () => {
  const inventory = fixtureInventory();
  assert.deepEqual(
    findRelevantDirtySources(
      inventory,
      [
        "unrelated.txt",
        "shared/new-untracked.ts",
        "trezor/proof.ts",
        "ledger/proof.ts",
      ],
      "trezor",
    ),
    ["shared/new-untracked.ts", "trezor/proof.ts"],
  );
  assert.throws(
    () => findRelevantDirtySources(inventory, [], "unknown"),
    /unknown vendor/,
  );
  for (const path of ["../escape", "/absolute", "bad\npath", "bad\\path"]) {
    assert.throws(
      () => findRelevantDirtySources(inventory, [path], "trezor"),
      /hardware emulator source inventory:/,
    );
  }
});

test("commit-bound resolution excludes untracked files and rejects dirty sources and symlinks", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "hardware-proof-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "config"), { recursive: true });
  await writeFile(
    resolve(root, "config/hardware-emulator-source-inventory.json"),
    `${JSON.stringify(fixtureInventory(), null, 2)}\n`,
  );
  for (const file of FIXTURE_FILES) {
    await mkdir(resolve(root, file, ".."), { recursive: true });
    await writeFile(resolve(root, file), `${file}\n`);
  }
  for (const args of [
    ["init"],
    ["config", "user.name", "Inventory Test"],
    ["config", "user.email", "inventory-test@example.invalid"],
    ["add", "."],
    ["commit", "-m", "fixture"],
  ]) {
    await execFileAsync("git", args, { cwd: root });
  }

  let cleanCliOutput = "";
  await runCli(
    ["list", "--vendor", "trezor", "--format", "lines", "--require-clean"],
    root,
    (chunk) => {
      cleanCliOutput += chunk;
    },
  );
  assert.match(cleanCliOutput, /trezor\/proof\.ts/);
  await writeFile(resolve(root, "trezor/untracked.ts"), "untracked\n");
  assert.equal(
    (await listRepositoryFiles(root)).includes("trezor/untracked.ts"),
    false,
  );
  await assert.rejects(
    () => checkInventory(root, { requireCleanVendor: "trezor" }),
    /cannot attest dirty sources.*trezor\/untracked\.ts/,
  );

  await rm(resolve(root, "trezor/untracked.ts"));
  await rm(resolve(root, "trezor/proof.ts"));
  await assert.rejects(
    () => checkInventory(root, { requireCleanVendor: "trezor" }),
    /cannot attest dirty sources.*trezor\/proof\.ts/,
  );
  await writeFile(resolve(root, "trezor/proof.ts"), "trezor/proof.ts\n");
  await unlink(resolve(root, "trezor/proof.ts"));
  await symlink("../trezor.txt", resolve(root, "trezor/proof.ts"));
  await execFileAsync("git", ["add", "trezor/proof.ts"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "track symlink"], {
    cwd: root,
  });
  await assert.rejects(
    () => checkInventory(root, { requireCleanVendor: "trezor" }),
    /selected source is not a regular file.*trezor\/proof\.ts/,
  );
});

test("CLI validates and lists deterministic line output", async () => {
  const validation = await execFileAsync("node", [SCRIPT, "validate"], {
    cwd: REPO_ROOT,
  });
  assert.match(validation.stdout, /inventory is valid/);
  const listing = await execFileAsync(
    "node",
    [SCRIPT, "list", "--vendor", "ledger", "--format", "lines"],
    { cwd: REPO_ROOT },
  );
  const lines = listing.stdout.trim().split("\n");
  assert.deepEqual(lines, [...lines].sort());
  assert.ok(lines.includes("scripts/ci/run-ledger-emulator-proof.sh"));
  assert.ok(lines.includes("shared/constants/walletPolicy.ts"));

  for (const args of [
    ["list", "--vendor", "unknown", "--format", "lines"],
    ["list", "--vendor", "ledger", "--format", "json"],
    ["unexpected"],
  ]) {
    await assert.rejects(
      () => execFileAsync("node", [SCRIPT, ...args], { cwd: REPO_ROOT }),
      (error) =>
        typeof error.stderr === "string" &&
        /unknown vendor|usage:/.test(error.stderr),
    );
  }
});
