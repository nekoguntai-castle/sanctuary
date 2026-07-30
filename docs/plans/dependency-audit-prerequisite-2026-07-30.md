# Dependency Audit Prerequisite — 2026-07-30

## Context

The first bug-scrub remediation PR is blocked by high-severity advisories
published after the current `main` lockfile was last verified. CI also exposed
an organization runner that advertises only `ubuntu-latest` while providing
Node 20 instead of the repository-required Node 24. Repeated workflow attempts
assigned different jobs to that runner and failed before setup, so deterministic
runner selection is part of this prerequisite.

## Plan

- [x] Upgrade only the OpenTelemetry packages and protobuf overrides that remove
  confirmed high advisory paths; preserve unrelated Trezor, browser-polyfill,
  and Firebase direct versions.
- [x] Test a React Router 7.11 downgrade, which npm identifies as outside the
  affected RSC range, before considering any exception. Pin exactly `7.11.0`
  (no caret), assert both router packages resolve to 7.11.0 after a clean
  install, and prove HashRouter navigation with the frontend suite/build.
  If it exposes other high advisories, retain an exact patched-current pin and
  scope an exception only to the RSC-only advisory.
- [x] Refresh the standalone website lockfile, clear its critical and fixable
  high advisories, and scope any unfixable high exception; critical advisories
  are never exceptible.
- [x] Add one audit implementation used by CI and local quality checks across
  the root workspace, explicit server/gateway workspace calls, and every
  standalone lockfile.
- [x] Model exceptions at exact advisory + installed package/version + lockfile
  + approved root-to-leaf dependency path granularity. Each entry requires an
  owner, rationale, upstream/tracking link, runtime surface, and UTC expiry no
  more than 90 days away. Reject missing, duplicate, stale, or unused entries.
- [x] Anchor each exception path to the audited `nodes` location and reconstruct
  its exact ancestry from the corresponding package lock; npm's package-name
  `via` graph alone is insufficient when duplicate versions exist. Test an
  approved and unapproved path to the same package/advisory.
- [x] Use strict `YYYY-MM-DD` expiry dates. An exception is valid while
  `current UTC date <= expiresOn` and invalid beginning 00:00Z the following
  day; inject the date into tests.
- [x] Run all tree audits through one aggregate policy process. Unused entries
  are evaluated globally after their declared lockfile has been audited, so an
  exception used in one tree does not fail unrelated trees.
- [x] Resolve npm's transitive `via` graph fail closed. An inherited finding is
  suppressible only when every reachable high leaf is approved for that exact
  path. Collapse npm's naturally cyclic carrier components, but require every
  component to resolve to at least one classified advisory leaf; leafless
  cycles, unknown nodes, malformed output, mixed approved/unapproved leaves,
  registry failures, unsupported schemas, and all critical findings fail.
- [x] If no compatible upstream glob chain exists, document both current paths:
  OpenTelemetry GCP detector → gcp-metadata → gaxios → rimraf → glob and
  Firebase/Firestore → google-gax → rimraf → glob. Accept only paths whose glob
  input is library-controlled; a new root or lock path must fail.
- [x] Cover the website-only Docusaurus → serve-handler → minimatch →
  brace-expansion path separately as non-production build tooling if its
  refreshed lock still has no compatible fix.
- [x] Add deterministic fixtures for allowed, unknown, expired (including the
  exact expiry boundary), malformed, duplicate, unused, mixed-leaf,
  shared-subgraph, missing-node, classified-cycle, leafless-cycle,
  path/version mismatch, severity escalation, and critical cases.
- [x] Verify clean `npm ci` for root and every standalone lockfile; audit all
  trees; peer-lock resolution; root/server/gateway typechecks and tests; website
  build; OpenTelemetry startup/export tests; router navigation tests; gateway
  Firebase tests; and the updated `tests/ci/quality-audit.test.sh`.
- [x] Restore unrelated Firebase, Trezor, and browser-polyfill manifest/lock
  churn before verification. Run actionlint/workflow composition checks and
  prove the workflow and `scripts/quality.sh` invoke the same aggregate runner.
- [x] Require `ubuntu-22.04` on every job in `.github/workflows/quality.yml` and
  `.github/workflows/test.yml` so Forgejo excludes the incompatible runner
  while retaining the two organization runners that advertise the Node
  24-capable label.
- [x] Add a workflow contract test that rejects a quality/test job which drops
  the Node 24-capable runner selector.

## Review

Pass 1 found incomplete standalone-lock coverage, insufficient exception scope,
unproven direct upgrades, and underspecified graph/expiry failure behavior.
Pass 2 required lockfile-backed path resolution, aggregate unused accounting,
exact expiry semantics, and unrelated-churn cleanup; those are now explicit.
Pass 3 found no actionable issues.

Implementation verification passed: all seven aggregate audit targets, 15 audit
gate fixtures, lockfile peer resolution, 98 workflow-composition assertions,
root/server/gateway typechecks and builds, 6,350 frontend tests at 100% coverage,
10,197 backend tests at 100% coverage, 562 gateway tests at 100% coverage, and
the production frontend and documentation builds.

Implementation review initially required all cycles to fail. The live npm audit
graph showed a legitimate Docusaurus carrier cycle
(`plugin-content-docs` ↔ `theme-common`) that still resolves to the exact
brace-expansion advisory leaf. The plan now treats strongly connected carrier
components as graph structure while remaining fail closed on leafless or
partially classified components. Pass 4 found no further audit-gate issues.

Post-push verification reproduced the Node 20 placement failure across seven
different quality/test jobs on two workflow attempts. Pass 5 extends the
prerequisite with a runner-selector contract rather than relying on retries.
Pass 6 corrected the selector to the single discriminating label, required
exact workflow job counts, and added a mutation fixture proving column-zero
comments cannot truncate validation. The final review found no remaining issue.
