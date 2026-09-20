# Open issue and dependency closeout plan

Reviewed 2026-09-19 against Forgejo `main` at `9c81f62fe9372c226740e8dfb10e947524a87c89`.
Dependency upgrades are authorized. This document is the analysis and implementation plan; it does not change dependencies or publish issue comments.

## Findings and intended outcome

Forgejo currently has **three open issues and zero open PRs**:

| Issue | Finding | Appropriate outcome |
| --- | --- | --- |
| [#721 Dependency Dashboard](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/issues/721) | Rolling Renovate report with a substantial queue and infrastructure warnings | Clear actionable updates and lookup failures; retain the dashboard while dependency monitoring is enabled |
| [#696 Security Monitor](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/issues/696) | Rolling report targets `050b39dc`, before merged security PR #1245 and deployment PR #1246 | Rescan current main, remediate residual findings, and retain the rolling monitor |
| [#537 Trezor/elliptic](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/issues/537) | Still blocked by upstream dependencies | Close only after an actual dependency-path remediation and verification |

There is no evidence supporting immediate closure of any of these three issue records. The useful measure is **resolved dashboard entries and security findings**, with merged, verified PRs as evidence. Closing dashboards merely to lower the issue count would obscure continuing work.

### What #721 actually contains

- 2 updates awaiting approval: `cbor-x` 1.6.6 and Ledger WebUSB 6.35.0.
- 62 rate-limited entries, including lockfile maintenance.
- 17 entries awaiting status checks.
- 3 entries blocked by deliberately closed PRs.
- 1 purportedly open PR, #1244, which is already merged.

Thus there are **81 queued update entries**, plus 3 closed-PR entries to reconcile. These are not 81 independent necessary upgrades: patch and major alternatives overlap, some affect separate projects, and some only raise a manifest floor above a version already installed.

The local Renovate configuration allows updates at any time, limits creation to 1 PR/hour and 2 concurrent PRs, and requires a three-day release age. Funds-critical packages have explicit dashboard approval because ordinary Renovate edits do not update their integrity/provenance records.

Reported infrastructure problems are missing GitHub lookup credentials/rate limiting, missing Docker authentication, and failed digest lookups for three private Nexus images. The internal-host warning describes a **future default change**, not proof that internal HTTP is currently blocked. Pending status checks need inspection of the actual branches/check contexts; the dashboard alone does not identify their cause.

## Execution order

The batches below can produce multiple small PRs. Keep the two-PR concurrency limit initially; group compatible maintenance updates to improve throughput without flooding CI. Security/toolchain work and maintenance can proceed while external credential provisioning is pending.

### Ownership, dependencies and first milestone

The implementation agent owns Sanctuary changes, local evidence and draft PR preparation. The infrastructure operator owns provisioning credentials and publishing the runner image through `runner-infra`; the monitoring maintainer owns `security-monitoring-infra` changes and report execution. One person may fill several roles, but each external handoff must identify a concrete owner and return an artifact/run URL. A reviewer checks each batch's evidence before merge.

Start by recording the new main SHA, fetching fresh issue/branch/check snapshots and verifying the pinned Linux toolchain is usable. Use separate clean worktrees for concurrent batches; serialize changes to the root lockfile and rebase dependent PRs before final checks. Preserve this planning worktree. Do not use `--allow-dirty` to bypass the signing helper's clean-tree requirement.

The dependency order is:

1. Baseline capture and runtime preflight unlock repository batches 1–8. Credential repair runs independently and blocks only authenticated bot lookups or publication that actually requires it.
2. Go runner build and publication precede switching workflow consumers to its verified digest. Its Go/module changes and all consumer pins land as a coordinated change. Keep Node/npm unchanged in this first security runner build unless required for compatibility; their later update is batch 7.
3. Routine maintenance precedes frontend/Prisma/signing changes sharing its root lockfile. Docs and monitoring triage can proceed in separate worktrees while root changes are reviewed.
4. Targeted batches precede lockfile maintenance; all merged changes precede final bot/scan reconciliation.

The first milestone is finite: baseline/report refresh; a narrowly scoped routine npm PR; a separate docs maintenance PR; Go security/toolchain PR and published runner proof; and two individually verified cbor-x/Ledger PRs. Complete independent PRs even if the external runner or credentials are pending, but report that milestone as partially blocked rather than complete. Then execute batches 4, 6–8 and compatible remaining maintenance; schedule majors with explicit owners and acceptance criteria rather than treating deferral as remediation.

The accompanying [disposition ledger](open-issue-dependency-closeout-2026-09-19-ledger.csv) maps all 85 branch entries from the captured #721 snapshot: 81 queued updates, 3 closed-PR entries and the stale open-PR entry. Batch 8's metrics replacement and the security-monitor triage are additional work, not counted as queue entries. Before implementation, reconcile the ledger against **every** checkbox branch in the refreshed body, excluding the “all” controls. Each row records: original branch/package, current resolution and target, batch/owner, status (`planned`, `in progress`, `verified`, `no-op`, `superseded`, or `blocked`), next action, and proof/PR/commit; attach the compatibility rationale to the row's evidence. Exact selected targets and resolutions remain pending baseline verification, rather than assuming every bot proposal is compatible. Match all baseline entries exactly once; record new bot entries separately. This prevents unlisted dependencies disappearing behind broad categories.

| Priority / batch | Concrete work | Required evidence |
| --- | --- | --- |
| 0. Refresh baseline and repair Renovate | Run Renovate and the security monitor against current main. Reconcile merged #1244 and stale findings from #1245. Inspect pending branch checks and inherited Renovate settings. Configure explicit host rules for the required internal hosts, GitHub lookup authentication, and a dedicated read-only Nexus package credential in the external automation service. | Successful real bot run; private image lookups succeed; no stale open-PR listing; security report records the exact tested commit. Preserve release-age checks. |
| 1. Go security/toolchain | Select a supported Go release at least 1.26 (dashboard proposes 1.27.1), update the runner image and digest, `config/ci-toolchain-lock.json`, workflow consumers, `go.mod`/`go.sum`, and x/crypto to at least 0.56.0. Coordinate btcd/btcec/btcutil updates only where compatible; btcutil v2 requires a separate import-path/API review. | Go tests; rebuilt runner canary; repeatable address-vector generation and cross-implementation verification; supply-chain checks; fresh OSV scan. Review any vector/provenance changes. |
| 2. Routine npm maintenance | Batch compatible patches/minors by lockfile and subsystem: yaml, nanoid 3, compression, tsx, Hono 4, grpc-js, Valibot, ESLint, and Stryker 9. Review gateway `@parse/node-apn` 8.1 separately with push notification tests. Align remaining TypeScript 6 manifests where the resolved version is already current. Treat lizard as a separate quality-tool update. | Clean installs with approved install scripts; affected builds/typechecks/tests; audit gate; lizard quality gate where applicable. Check actual lockfile changes before calling an entry remediated. |
| 3. Documentation maintenance | Update the Docusaurus packages together to the compatible 3.10 patch, MDX, clsx, webpack, serialize-javascript, colord, Joi 17, uuid 14, and compatible Mermaid layout updates. Upgrade docs TypeScript within its supported line. Keep React 18 until the React 19 peer graph is verified. | Docs clean install, typecheck and production build; representative architecture/Mermaid pages render. Docs security audit remains clean. |
| 4. Frontend maintenance | React 19 patches/types, Vite React plugin and node-polyfill updates, plus compatible existing test-tool versions. Treat pre-1.0 package updates as potentially breaking. | Frontend typechecks, unit tests, production build, browser/render smoke tests; inspect bundle changes for polyfills and signing dependencies. |
| 5. Approved signing-related updates | Use `scripts/bump-funds-critical.sh` separately for cbor-x 1.6.6 and Ledger WebUSB 6.35.0, beginning with its dry run. Update package integrity pins and generated hardware compatibility records together. Review Keystone UR, tiny-secp256k1 and bitcoinerlab updates with the same attention to signing behavior even where they are outside the helper's current pinned list. | Supply-chain checks, affected parsing/PSBT/address tests, Ledger emulator proof and applicable signing proofs. Regenerate vector/provenance evidence where affected. Do not create ordinary Renovate PRs that cannot satisfy the pinned-lock contract. |
| 6. Prisma 7 maintenance | Upgrade CLI, client and adapter-pg together to the compatible 7.10 line. Update version-specific `allowScripts` entries for Prisma and engines. Preserve #1246's application/migration image boundary. | Client generation; database integration; fresh install and retained-data upgrade; failed migration blocks application startup; application image excludes migration-only tooling; migration image works offline. |
| 7. Runtime and image maintenance | Coordinate Node 24.21.0 and npm 11.19.1 across engines/toolchain artifacts, checksums and runner images. Refresh same-line Node, nginx, Debian, Postgres 16, Redis 7 and runner digests. Review Ledger emulator image updates separately. Evaluate Bitcoin Core 29.4 and Python 3.14 verifier compatibility before switching. | Supply-chain/image-lock tests; Linux image builds and runner canaries; installation/upgrade smoke tests; offline inventory consistency; address/PSBT verification for verifier-image changes. |
| 8. Metrics client replacement | Replace deprecated `prom-client` with the publisher-designated `@prometheus-io/client` after API compatibility review. Update the metrics registry, individual metric modules, MCP metrics and test mocks. | Metric names, labels, types and scrape output remain compatible; tests pass; monitoring/alert smoke passes. The replacement's pre-1.0 version is not evidence of drop-in compatibility. |
| 9. Deliberate major migrations | Schedule separate PRs/projects for the remaining majors described below. Keep them visible with an explicit rationale and test plan until implemented. | Subsystem-specific migration and regression evidence, beyond merely satisfying dependency installation. |

### Major updates that must remain separate

- **Stateful services:** PostgreSQL 18, Redis 8 and Grafana 13 each need a supported migration path, retained-data tests and restore/rollback evidence. Grafana's password-migration image is part of the change. Do not simply switch image tags on existing data volumes.
- **Queue stack:** review BullMQ 6 and ioredis 6 together for compatibility, but stage changes so failures can be attributed; exercise retries, stalled jobs, reconnects, persistence, shutdown and worker behavior. Do not couple this unnecessarily to a Redis server major.
- **Backend/API and transitive overrides:** Nodemailer 10, cookie 2, http-proxy-middleware 4, Hono node-server 2, protobufjs 8, undici 8, TOML 5 and dotenv 18 require consumer/API checks. Test dotenv's environment loading/precedence against startup and CLI behavior. A root override can force a major into packages that do not support it. Prefer upgrading the owning dependency when possible.
- **Build/docs tooling:** TypeScript 7, Vitest 5 with its matching coverage package, Stryker 10, testing-library/jest-dom 7, jsdom 30, dependency-cruiser 18, Joi 18, js-yaml 5, nanoid 6, SVGO 4 and Mermaid layout 1 each need the relevant configuration/peer/API review. Move docs to React 19 only as a compatible Docusaurus/React/types set. App React is already 19.
- **Runtime/platform:** Node 26 and npm 12 conflict with the root's current supported engine ranges; establish one runtime policy before changing standalone `node-linux-x64` pins. The Node `>=20.20.2` entry is a docs engine-floor decision, not a request to downgrade the Node 24 runtime; test docs on the chosen supported runtime and explicitly record its engine-policy disposition. Ubuntu 26 `runs-on` suggestions must be reconciled with the actual self-hosted runner inventory. Bitcoin Core 31 must pass the verification corpus before replacing the existing verifier version.
- **Cryptographic libraries:** bitcoinerlab secp256k1 v2 and btcutil v2 deserve independent review and cross-implementation proofs; never force tiny-secp256k1 v2 into Trezor's v1 dependency range merely to remove an advisory.

## Security-monitor closeout work

The current #696 body contains 96 findings: 23 gitleaks, 17 OSV and 56 Semgrep. Its headline counts overlap categories: the 23 secret findings are included in the severity totals, not an additional 23 vulnerabilities. Do not equate 30 reported highs with 30 exploitable production vulnerabilities.

Merged [#1245](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/1245) already updates qs, Valibot, esbuild, Pygments and x/crypto 0.55.0. Its reported verification includes clean audits for docs, proxy and both npm verifier projects, builds/typechecks and the Go/address verification lane. A new scan must confirm that the old fingerprints disappear; repeating these upgrades adds no value.

Remaining work after that refresh:

1. Fix the x/crypto advisories requiring 0.56.0 through batch 1. Re-evaluate GO-2026-5932 independently: the dashboard gives it no fixed version, so the toolchain upgrade is not a promise to clear all four reported Go advisories.
2. Trace the root lockfile's uuid 9.0.1 through its owning dependency (currently an optional gaxios path). Prefer a compatible parent upgrade/removal; the docs uuid 14 update does not address this separate copy. Verify production and frontend reachability rather than inferring it from an optional/dev label.
3. Review the 23 secret candidates by exact fingerprint and provenance. Several point at published/generated Bitcoin vectors or test fixtures. Confirm each before narrowly suppressing in the monitoring configuration; do not blanket-ignore test directories. Rotate/revoke only if a candidate proves to be a real credential.
4. Triage Semgrep production sinks first: webhook object assignment, support-package paths, wallet export response handling and cache pattern construction. Trace validation and data flow before deciding on a fix or documented false positive. Historical August triage is not sufficient evidence for newly reported code.
5. Fix monitor normalization/deduplication in `security-monitoring-infra`: the current report has unknown severities and repeated findings. Preserve scanner coverage and raw artifacts.
6. Scan application and migration images separately. [#1246](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/1246) removes Prisma CLI tooling from application images, not from development installs or the dedicated migration image. Do not claim every Prisma-related lockfile finding is removed.
7. Run light and deep monitoring on the final merged commit and record remaining findings with reachability, fix availability and ownership. Keep #696 as the rolling monitor.

## Trezor tracker: exact closure condition

Live npm registry checks during this review still report connect/connect-web 9.7.3, utxo-lib 2.5.0 depending on tiny-secp256k1 `^1.1.7`, and elliptic 6.6.1. The [GitHub advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) is low severity, affects elliptic <=6.6.1, lists no patched version, and identifies **CVE-2025-14505**; #537's original CVE identifier is incorrect.

Close #537 only after a published fix or supported Trezor dependency-path change is installed and tested, the affected production dependency path is gone or fixed, and the production audit and Trezor signing proofs confirm the result. An upstream announcement or wider dependency range alone is insufficient.

Also verify built frontend contents before repeating the old comment's claim that the polyfill path cannot ship: build-time dependencies can contribute browser code. Do not add a low-severity exception to the high/critical npm gate; it does not fix the dependency and can create an unused-exception failure.

## Reconciliation and completion criteria

Use the root workspace lockfile for root/server/gateway/shared, and independently install/audit all five standalone projects: `docs/site`, `llm-egress-proxy`, `tests/ci/lib`, `scripts/verify-addresses`, and `scripts/verify-psbt`. `scripts/ci/npm-audit-gate.mjs` enumerates these plus workspace views. Include OSV/Go/Python/image results separately: passing the npm high/critical gate does not clear low findings or non-npm findings.

For affected npm batches, run the existing `check:npm-install-scripts`, `check:npm-ci-callsites`, `check:supply-chain-locks`, peer-resolution check and appropriate typecheck/build/test commands under the pinned runtime. Do not enable new package install scripts broadly. Runtime/runner changes also require supply-chain contract tests and the actual workflow canary; changing a checksum or satisfying a static test alone is insufficient.

Signing helper preflight must include a disposable-worktree trial. Its current `assert_lockfile_scope` allows only the target package's node_modules entries, so legitimate manifest metadata or necessary transitive changes may cause it to stop. If that occurs, inspect the preserved diff, repair the helper in a separate focused change with regression coverage for metadata, reviewed dependency-closure changes and rejection of unrelated churn, then retry. Do not hand-edit lockfiles or disable the scope check. Review upstream package/tarball changes as well as version/integrity fields.

For each major migration, attach its own go/no-go checklist before editing: supported upgrade path, source compatibility, retained-data behavior where relevant, staged rollout and restoration procedure. Never use a dependency PR as authorization to migrate a live data volume. If a test fails or a publisher version is unavailable/incompatible, keep the current pin, record the concrete blocker and continue independent batches. Revert failed unmerged changes in their isolated worktree; revert merged package-only changes through a tested follow-up. Stateful recovery uses the proven restore path, not a blind image downgrade.

- #828, #919 and #944 correspond to type versions already present in the lockfile. Inspect their exact diffs before recreating. #944 was explicitly closed for changing only a compatible range floor. Align floors in an existing maintenance PR if useful, or retain the documented no-op disposition; count neither as a security fix.
- Run lockfile maintenance last, after targeted updates, with separate review of unintended dependency churn. Preserve independent verifier lockfiles and their provenance guarantees.
- For each batch record before/after resolved versions, affected lockfiles, focused checks, audit results, PR and tested commit. Re-run only the relevant checks after subsequent changes; use the full required CI before merge.
- Refresh Renovate after merges and compare actual queue entries removed. Avoid counting both a patch and superseding major as independent fixes.
- Final desired state: zero unexplained lookup/status failures; actionable patches/minors drained; residual majors have explicit migration work; security findings are fixed or individually evidenced; #537 retains an accurate upstream blocker until genuinely resolved.

## Independent plan review

Two fresh agents independently reviewed this plan against the repository and captured issue evidence on 2026-09-19:

| Round | Reviewer | Major/blocking findings | Corrections |
| --- | --- | --- | --- |
| 1 | `plan_review_round1` | 0 | Explicitly included APNs 8.1 and dotenv 18, with push-provider and environment-loading tests. |
| 2 | `plan_review_round2` | 0 | Confirmed 85/85 ledger coverage, sequencing, helper fallback and verification scope; aligned Joi/uuid table labels with ledger batch 3. |

Primary validation independently confirmed all 85 captured branch identifiers appear exactly once, all batch assignments are valid, literal repository paths exist, and both artifacts pass whitespace checks. There are no outstanding major plan findings. This is a plan-review result, not evidence that dependency changes or their execution tests have passed.

## Evidence and limitations

This review used live Forgejo issue bodies/comments, open-PR and main-branch APIs, merged PR descriptions, repository manifests/lockfiles/configuration, live npm metadata and the [x/crypto 0.56.0 module manifest](https://proxy.golang.org/golang.org/x/crypto/@v/v0.56.0.mod), which requires Go 1.26.0. [Renovate's dashboard documentation](https://docs.renovatebot.com/key-concepts/dashboard/) describes its ongoing overview and approval purpose. The `prom-client` registry metadata explicitly names [@prometheus-io/client](https://registry.npmjs.org/@prometheus-io%2fclient/latest) as its replacement; it reported 0.16.1 at review time.

No fresh build, test suite or audit was run for this planning task; Node/npm are not available on the current shell PATH. Past PR validation is identified as reported evidence, not rerun evidence. The next implementation step is to use the repository's pinned runtime/runner and refresh both reports. Dependency targets from the dashboard must be revalidated against release age, publisher metadata and compatibility before installation.

External automation credentials remain a concrete dependency: the earlier #721 investigation found only a write-capable Nexus credential and could not provision a read-only one with the available Forgejo privileges. Check whether provisioning has since occurred; otherwise assign that step to the infrastructure operator while repository maintenance proceeds. Never commit or log credentials.
