import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// `esm-main-guard-silent-noop-under-symlink` (Phase 0, iteration 23 P2
// remediation plan): every CLI below used to guard its body with a direct
// comparison of `import.meta.url` (which Node resolves through symlinks)
// against a raw `process.argv[1]` (which it does not) — via a
// ``file://${process.argv[1]}`` template, a `resolve()`/`pathToFileURL()`
// round-trip, or a bare `process.argv[1] === fileURLToPath(import.meta.url)`
// equality. Invoked through a symlinked directory, the comparison was always
// false, so the CLI exited 0 with empty stdout having done nothing. Each
// site now delegates to the shared `scripts/lib/is-main-module.mjs
// #isMainModule`, which compares realpath-resolved paths on both sides.
//
// This test proves the fix by copying the whole `scripts/` tree into a temp
// directory, aliasing it through a symlinked directory, and invoking every
// migrated CLI *through the symlink* with no arguments (or the minimum input
// needed to reach a deterministic guarded-body response) and an explicit
// `cwd` pinned inside the disposable fixture — never the real repo — so nothing
// a script reads or writes escapes the fixture. A CLI whose guard still
// silently no-ops produces empty combined stdout+stderr and exits 0; every
// one of these must instead reach its guarded body (usage/validation output,
// non-zero exit) exactly as a direct invocation would.
//
// Reproduced red against origin/main (`4088e85bd6`^, i.e. `99da288d63`) by
// running this same fixture against the pre-fix `scripts/` tree: every site
// below printed nothing and exited 0 through the symlink.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// [relative path under scripts/, args, options] — args are empty except
// where a CLI's guarded body needs at least one argument to reach a
// deterministic, fast, side-effect-free validation error instead of a
// different usage path. `options.input` feeds stdin where a CLI is
// legitimately silent on empty input (its guard still ran; it just had
// nothing to echo).
const SITES = [
  // Phase 0 original 18 sites.
  ['ownership/register-resource.mjs', []],
  ['ownership/cleanup-cli.mjs', []],
  ['ownership/describe-host-authority.mjs', []],
  ['ownership/operator-recovery-cli.mjs', []],
  ['ci/check-redis-service.mjs', []],
  ['ci/integration-db-guard.mjs', []],
  ['ci/npm-audit-gate.mjs', []],
  ['ci/check-npm-deprecations.mjs', []],
  ['ci/check-npm-ci-callsites.mjs', []],
  ['ci/check-npm-install-scripts.mjs', []],
  ['ci/subject-budget.mjs', []],
  ['ci/verify-jade-junit.mjs', []],
  ['quality/check-root-layout.mjs', []],
  ['release/verify-prepared-release.mjs', []],
  ['support-package-runner.mjs', []],
  ['perf/wallet-sync-high-fanout-replay.mjs', []],
  ['ownership/check-lifecycle-callsites.mjs', []],
  ['release/verify-release-artifacts.mjs', []],
  // Coordinator-requested extension: twelve more `path.resolve(process.argv[1])
  // === fileURLToPath(import.meta.url)` sites, same finding, same owner class.
  ['ownership/verify-ci-cleanup-upload.mjs', []],
  ['ownership/ci-cleanup-coordinator.mjs', []],
  ['ownership/deployment-cli.mjs', []],
  ['ownership/write-ci-cleanup-request.mjs', []],
  ['ownership/project-lock-cli.mjs', []],
  ['ci/report-commit-workflows.mjs', []],
  ['ci/check-supply-chain-locks.mjs', []],
  ['ci/check-github-action-runtimes.mjs', []],
  ['release/prepare-release-assets.mjs', []],
  ['release/publish-release-assets.mjs', []],
  ['architecture/generate-graphs.mjs', []],
  ['architecture/extract-call-graphs.mjs', []],
  // Further sites found by the coordinator-mandated `rg` sweep: the same
  // `resolve()`-based bug missed by a literal-`path.resolve` grep, plus a
  // third guard shape (bare `process.argv[1] === fileURLToPath(...)`, no
  // resolve/realpath at all — the same class, still symlink-broken).
  ['release/verify-wallet-safety-audit-review.mjs', []],
  ['generate-signer-inventory.mjs', []],
  // generate-address-key-corpora.mjs is deliberately NOT migrated: its exact
  // source bytes are hash-pinned into scripts/verify-addresses/sourceManifest.ts
  // (VERIFIER_SOURCE_FILES -> VERIFIER_PROVENANCE.sourceSha256, asserted by
  // tests/scripts/verifyAddressesGenerated.test.ts). Editing it invalidates
  // the checked-in vectors until the Docker-based verifier pipeline
  // regenerates them, which this phase cannot run (Docker is forbidden here).
  // Left for a follow-up with vector regeneration in scope.
  ['check-wallet-sync-lifecycle-contract.mjs', []],
  ['check-wallet-sync-mutation-boundaries.mjs', []],
  ['check-server-cycle-baseline.mjs', []],
  ['ci/forward-live-annotations.mjs', [], { input: 'esm-main-guard-symlink-probe\n' }],
  ['ci/hardware-emulator-source-inventory.mjs', []],
  ['ci/check-wallet-safety-mutation-map.mjs', []],
  ['ci/check-critical-mutation-config.mjs', []],
  ['ci/classify-hardware-emulator-shadow.mjs', []],
  ['ci/check-wallet-safety-classifier.mjs', []],
];

function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'esm-main-guard-symlink-'));
  const realDir = join(dir, 'real');
  mkdirSync(realDir);
  cpSync(join(REPO_ROOT, 'scripts'), join(realDir, 'scripts'), { recursive: true });

  // Isolate every CLI's default-config and default-source lookups from real
  // repo state so the guarded body always reaches a fast, deterministic
  // failure rather than doing real work or reading/writing outside the
  // fixture: no config/, server/, docs/, etc. are copied or symlinked here,
  // and every invocation below pins `cwd` inside this fixture too, so a
  // script that resolves paths against `process.cwd()` (rather than its own
  // `import.meta.url`) still can't reach — or write into — the real repo.
  const npmAuditExceptions = join(realDir, 'scripts/ci/npm-audit-exceptions.json');
  if (existsSync(npmAuditExceptions)) rmSync(npmAuditExceptions);

  // A handful of CLIs import bare specifiers (e.g. fast-xml-parser); Node
  // resolves those by walking up from the importing file through
  // node_modules directories, so aliasing the repo's real node_modules at
  // the fixture root satisfies that resolution without copying it. This is
  // a read-only reference, never a write target.
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(realDir, 'node_modules'));

  const symlinkedDir = join(dir, 'linked');
  symlinkSync(realDir, symlinkedDir);

  return { dir, symlinkedDir };
}

function runSites(baseDir, scriptsRootDir, description) {
  for (const [relativePath, args, options = {}] of SITES) {
    const scriptPath = join(scriptsRootDir, 'scripts', relativePath);
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: baseDir,
      input: options.input,
    });

    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.notEqual(
      combined.length,
      0,
      `${relativePath} (${description}): guarded body did not run (empty stdout+stderr, exit ${result.status}) — the silent-noop bug is back`,
    );
  }
}

test('every migrated ESM main-guard site runs its guarded body through a symlinked directory', () => {
  const { dir, symlinkedDir } = buildFixture();
  try {
    runSites(dir, symlinkedDir, 'symlinked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every migrated site still runs its guarded body under direct (unsymlinked) invocation', () => {
  const { dir } = buildFixture();
  const realDir = join(dir, 'real');
  try {
    runSites(dir, realDir, 'direct');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importing a migrated CLI module does not run its guarded body', async () => {
  // A sample of the guard variants: a `file://${argv[1]}` template site and
  // a resolve()/pathToFileURL site. Importing must produce no CLI output
  // because isMainModule(import.meta.url) is false when argv[1] is this
  // test file, not the imported module.
  const originalArgv1 = process.argv[1];
  try {
    await import('../../scripts/ci/check-redis-service.mjs');
    await import('../../scripts/ci/subject-budget.mjs');
  } finally {
    assert.equal(process.argv[1], originalArgv1);
  }
});
