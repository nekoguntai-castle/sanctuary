# Sanctuary — Lessons

Patterns to remember from CI corrections, surprising debugs, and reviews. Written terse so future-me can scan quickly. Each entry: rule, why, how to apply.

## Use Workspace-Absolute Paths For Repo-Root CI Helpers

**Rule:** Workflow steps must invoke repo-root helper scripts through `${{ github.workspace }}/scripts/...`, especially when a job or later edit may set `working-directory`.

**Why:** The PR-required checks passed, but the post-merge `main` push lane ran full backend jobs from `server/`; `bash scripts/ci/ensure-node.sh` resolved under `server/scripts/...` and failed before tests started.

**How to apply:**

- Prefer `bash ${{ github.workspace }}/scripts/ci/ensure-node.sh`, `ensure-python.sh`, and `install-semgrep.sh` in workflow run steps.
- Keep syntax-only checks such as `bash -n scripts/ci/...` rooted in the checkout, but do not use bare helper invocations for actual setup steps.
- Run the workflow runtime/policy guard after workflow edits so bare helper calls fail locally before a long remote lane is queued.
- When a CI failure happens before the test body starts, inspect workflow execution context and default working directories before changing application code.

## Keep Release Workflows Tag-Scoped Unless Branch Checks Are Real

**Rule:** Release workflows that only validate or publish tagged releases should not run on ordinary `main` branch pushes.

**Why:** The post-merge `main` push triggered a release check that was intentionally designed to skip branch work, but the skipped branch path still produced a failed run and made `main` look red.

**How to apply:**

- Trigger release validation from release tags, manual dispatch, or explicit release events instead of broad branch pushes.
- If branch release checks are required, make them real deterministic checks with logs, not placeholder skip paths.
- Verify the target-branch push lane after changing workflow triggers, because PR checks do not exercise every `push` trigger.

## Keep PR Marker Jobs Independent From Skipped Full Lanes

**Rule:** A PR no-op marker job should not depend on the non-PR full-lane graph it is replacing.

**Why:** The Test Suite quick PR lane passed its actual changed-file checks, but the `Full Test Summary` PR marker still depended on skipped full-lane jobs and failed immediately in Forgejo before any test assertion ran.

**How to apply:**

- Split PR marker jobs from non-PR summary/gate jobs when the non-PR job needs a large `needs:` graph.
- Keep the PR marker as a tiny job with no full-lane dependencies; let `PR Required Checks` depend on the real quick-lane jobs.
- Keep the non-PR full summary behind the full-lane `needs:` graph so `main`, schedules, and manual full runs still enforce the broad gate.
- If a red job finishes before its dependencies or test body could plausibly run, inspect the workflow graph before changing test code.

## Verify The Post-Merge Lane, Not Only PR Required Checks

**Rule:** After merging workflow or CI-scope changes, check the latest target-branch `push` run separately from the PR-required contexts before declaring Actions clean.

**Why:** The PR quick lane passed, but `main` immediately ran push-only full-lane jobs that failed. Those failures were easy to miss if only the PR head status was treated as the whole CI surface.

**How to apply:**

- Query the target branch head SHA after merge and inspect its `push` workflow statuses.
- Treat stale failed PR attempts and current target-branch failures as separate buckets.
- When PRs intentionally skip Docker-heavy or full-suite jobs, run local equivalents or a branch/manual full-lane rehearsal before merge.
- In final delivery notes, state whether post-merge target-branch Actions were checked and what remained red.

## Audit Workflow Action Families As A Set

**Rule:** When swapping a workflow action implementation for forge compatibility, search and replace the entire action family before declaring the lane fixed.

**Why:** Upload steps had moved to the Forgejo artifact action, but remaining GitHub `download-artifact` steps in the full coverage merge path still failed during manual full-lane rehearsal.

**How to apply:**

- Run an exact `rg` for both the short action name and version-pinned references, such as `actions/download-artifact` and `download-artifact@`.
- Check downstream summary/download jobs as well as the obvious producer/consumer pair that first failed.
- Re-run workflow lint and the manual lane that exercises the artifact handoff after the replacement.

## Do Not Trust Workflow-Level Concurrency Across Forgejo Workflow Files

**Rule:** For shared-runner Docker, browser, and install E2E sections, use an explicit lock in the job commands instead of relying only on workflow-level `concurrency`.

**Why:** Matching ref-level concurrency groups did not stop separate workflow files from overlapping during manual rehearsal. The overlap caused install E2Es and browser E2E to fail at the same time on the same branch head.

**How to apply:**

- Put the lock around the mutating Docker/browser test section, not just the workflow declaration.
- Keep lock names generic and repo-local; do not encode runner hostnames, IP addresses, or operational paths.
- Rehearse by dispatching the affected workflows together, because a single workflow run cannot prove cross-workflow isolation.

## Disambiguate Runner Requests Before Inspecting App Code

**Rule:** When the user asks about a "runner", first identify whether they mean Forgejo Actions, local scripts, CI test runners, or an application background worker before diving into repository internals.

**Why:** The user asked about making a runner fire more parallel sessions and then clarified they meant Forgejo, while the first investigation went into Sanctuary worker/support-package runner code.

**How to apply:**

- Check for context words like Forgejo, Actions, CI, host IPs, queues, workers, or support packages.
- If the request is operational and mentions a host, inspect runner/service config before app source.
- For Forgejo, look for `runner.capacity`, the runner config path, and the service/container manager.

## Scrub Internal Operational Metadata Before Commit

**Rule:** Do not commit private CI/CD hostnames, IP addresses, usernames, service names, config paths, or capacity details into repo-tracked task notes, tests, or docs.

**Why:** Operational debugging often produces useful local notes, but those details expose infrastructure topology when they land in the repository.

**How to apply:**

- Before committing, scan the diff for private address ranges, host aliases, SSH usernames, service/container names, and absolute operational paths.
- Use reserved example domains such as `.invalid` in tests instead of real local endpoints.
- Keep runner and deployment verification details in the chat or private operator notes, not repo-tracked project docs.

## Narrow Privacy-Feature Removals To The Approved Scope

**Rule:** When the user narrows a removal from a broad privacy-feature sweep to one named feature, remove only that feature and explicitly leave adjacent implemented features untouched.

**Why:** One privacy-mixing item was only an unused experimental flag and text references, while Payjoin is implemented across API, UI, persistence, and tests. Treating both the same would create unnecessary product and schema churn.

**How to apply:**

- Re-run a targeted search for the narrowed feature before editing.
- Remove runtime toggles, schema entries, docs, and tests for that feature only.
- Keep adjacent protocol names and code paths unchanged unless the user separately approves their removal.
- Verify with a targeted `rg` scan that names only the removed feature.

## Remeasure Sliding Indicators After Layout Settles

**Rule:** UI indicators that depend on `offsetLeft` or `offsetWidth` must remeasure after first paint and after container, tab, or font sizing changes.

**Why:** The sidebar network selector could load with Testnet active while the sliding selected background was measured before the tab strip finished its final layout. Switching networks later forced a remeasure and made it look correct.

**How to apply:**

- Measure once in a layout effect, then schedule a post-paint remeasure.
- Use `ResizeObserver` on the tab strip and active tab when indicator dimensions depend on rendered text width.
- Re-run measurement after `document.fonts.ready` when text sizing affects indicator width.
- Add focused tests that simulate final layout arriving after mount instead of only asserting click-triggered updates.

## Keep Repo Work In The Project Checkout When Temp Space Is Constrained

**Rule:** Do not create or continue feature work in `/tmp` when the user reports temp-space pressure or when a normal project checkout is available.

**Why:** This session initially used a `/tmp` worktree, then hit confusing command and storage friction. The user corrected the workflow: clean up stale temporary worktrees and continue from the main local checkout.

**How to apply:**

- Prefer the durable project checkout or another durable repo checkout for branch work.
- Use `/tmp` only for short-lived generated artifacts that are safe to delete and clearly ignored.
- If stale worktrees/branches exist, inspect them, preserve unrelated local files, and clean only the stale items the user approved.
- After consolidating work, verify `git worktree list`, local branches, and `git status --short --branch` before continuing implementation.

## Match Commands To The Current Approval Policy

**Rule:** Check the session's sandbox and approval policy before running commands, and do not request escalation when the policy is `never`.

**Why:** The user had to ask why ordinary commands kept requesting approval. The active environment later showed `danger-full-access` with approval policy `never`, so escalation flags would be rejected and would add noise.

**How to apply:**

- Read the active environment/permissions instructions at the start of resumed work.
- Run normal terminal commands directly when filesystem access is unrestricted.
- Avoid `sandbox_permissions` unless the current policy explicitly allows it and the command truly needs it.
- If command behavior seems abnormal, explain the current policy and adjust the workflow before retrying the same failing pattern.

## Do Not Assume GitHub Workspace Env In Forgejo Jobs

**Rule:** Forgejo Actions jobs can mount the repository under a workspace path without exporting `GITHUB_WORKSPACE` or `ACT`; install tests must detect Docker-visible workspace paths directly.

**Why:** Local act-like reproductions passed with GitHub-style env vars, while real Forgejo install jobs fell back to `/tmp`, which is not visible to the host Docker daemon for bind-mounted runtime files.

**How to apply:**

- Treat workspace-mounted project roots as runner scratch roots even when GitHub-style env vars are absent.
- Reproduce Docker-socket tests with the repo mounted under a workspace path and those env vars unset.
- Redact verbose install output before printing it, because runner origin URLs and generated secrets can appear in traces.

## Use Run-Scoped Install Test Scratch Roots

**Rule:** Docker-backed install tests must not reuse a fixed workspace scratch directory across CI jobs; include the run identity and process UID in the default workspace scratch root.

**Why:** A previous Docker-backed job can leave `.tmp/install-tests` owned by root in the shared checkout. A later non-root job then fails before Docker starts because `mktemp` cannot create its runtime directory.

**How to apply:**

- Keep install scratch roots under the checked-out workspace when the host Docker daemon must see bind mounts, but use a path like `.tmp/install-tests-<run>-<uid>`.
- Do not depend on chmodding or deleting stale root-owned scratch directories from a later non-root job.
- Keep generated TLS material for install stack smoke jobs under the same run-scoped root, not under fixed repo paths such as `docker/nginx/ssl`.
- Do not let `actions/checkout` pre-clean Docker-backed install workspaces on the shared Forgejo runner; run-scoped scratch paths provide isolation without tripping over stale generated artifacts from older jobs.
- Exclude `.tmp` from Docker build contexts so install-test runtime data and generated artifacts do not enter production image builds.
- Reproduce this class of failure with `GITHUB_WORKSPACE`, `GITHUB_RUN_ID`, and the run-derived install ports set locally before rerunning the remote workflow.

## Reconcile Database Role Passwords After Volume Restores

**Rule:** After restoring a Postgres volume or dump into a running Sanctuary stack, reconcile the database role password with the runtime env and verify TCP auth from the compose network before declaring login fixed.

**Why:** Local socket `psql` checks can pass while Prisma fails new TCP connections with `P1000` / `28P01`, which surfaces in the UI as `database operation failed`.

**How to apply:**

- Source the active runtime env file and update the restored Postgres role password to match `POSTGRES_PASSWORD`.
- Verify with an external client on the Sanctuary compose network, using `psql -h postgres`, not only `docker exec ... psql` over a local socket.
- Restart app services after repair so Prisma pools reconnect with the corrected credentials.
- Include a health endpoint and fresh login check in the restore verification path.

## Treat Postgres Role Drift As Runtime State, Not Code Drift

**Rule:** If `DATABASE_URL`, the Postgres container env, and the runtime env file agree but TCP auth still fails, the live Postgres role password has drifted; repair the role and collect runtime evidence before blaming code edits.

**Why:** The recurring local `database operation failed` happened while backend, worker, and Postgres containers had not restarted. The three credential sources matched, but Postgres rejected them with `28P01`, so the database role state had changed independently of the checkout.

**How to apply:**

- Compare short hashes for backend `DATABASE_URL`, Postgres container `POSTGRES_PASSWORD`, and the runtime env file without printing secrets.
- Test TCP auth from the compose network with a throwaway Postgres client; do not rely on local socket `psql`.
- Enable Postgres DDL and connection logging after unexplained role drift so any future `ALTER ROLE` leaves a clearer trail.
- When restarting backend/worker behind nginx, also refresh frontend nginx if public HTTPS returns `502` while in-network backend health is good.

## Keep Dry-Run Setup Tests Away From Live Runtime State

**Rule:** Setup, install, and unit-test paths that pass `--no-start` must not reconcile or mutate a running local Postgres role, even if a Sanctuary stack is already up in the same checkout.

**Why:** The local recurring `database operation failed` login bug was reintroduced by an install unit test that ran `scripts/setup.sh --no-start` with throwaway test passwords. Setup still found the live compose Postgres container and changed the real `sanctuary` role password to the test value.

**How to apply:**

- Gate live database reconciliation behind the same condition that actually starts services.
- Treat `--no-start`, dry-run, and unit-test setup invocations as file/config generation only.
- After testing installer/setup scripts while a local stack is running, verify the app-relevant `postgres:5432` auth path and health endpoint before assuming the stack is still clean.
- Prefer helper tests that assert dry-run setup cannot touch Docker runtime state.

## Keep Forgejo Runner Locks Inside The Workspace

**Rule:** Workflow-level runner locks should use a path under `${{ github.workspace }}` instead of a parent directory inferred from the checkout path.

**Why:** Forgejo job containers can mount the checkout in a writable workspace while the parent directory is owned or mounted differently. A lock helper that creates `../.sanctuary-runner-locks` can fail before the E2E body starts, leaving no application containers or logs to inspect.

**How to apply:**

- Set `SANCTUARY_RUNNER_LOCK_DIR` explicitly in workflows that call `scripts/ci/with-runner-lock.sh`.
- Prefer `.tmp/runner-locks` under the checkout so the path follows the job workspace and remains ignored.
- Add unit assertions for workflow lock paths when a runner-only failure mode is fixed.

## Separate Marker Jobs From Real E2E Failures

**Rule:** When a Forgejo run reports multiple red install E2E jobs, first identify which job actually executed the Docker body and which jobs are marker or summary jobs reflecting an upstream result.

**Why:** The broad manual install run reported both Fresh Install E2E and Install Script E2E as failed, but the install-script job was only checking the combined fresh/install job result. Treating both as independent failures made the debug loop look larger than it was.

**How to apply:**

- Inspect job `needs` and marker-step logic before changing application code.
- Patch runner/workflow handoff issues when the same E2E command passes locally and the remote failure happens before useful app logs.
- Keep named marker jobs for branch protection, but document when their status is derived from a combined job.
- Keep unit/preflight jobs named separately from Docker E2E jobs once the checkout handoff is stable; otherwise a fast unit failure is reported as a Docker Fresh failure.
- Prefer one root-cause patch and one broad rerun over repeated speculative workflow retries.

## Serialize Shared-Checkout Quick Lanes On Forgejo

**Rule:** Forgejo quick-lane and quality jobs that run `npm ci`, `npm install --package-lock-only`, build assets, run browser installs, or clone the current checkout must either use isolated temp clones from a stable source or serialize on the same workspace lock.

**Why:** The PR Test Suite quick lane failed in hygiene and frontend jobs while browser/render jobs were also active, and the Quality lockfile peer-resolution job later failed while sibling quality jobs were active. The commands passed locally, so the common failure mode was concurrent shared-checkout mutation, not the checks themselves.

**How to apply:**

- Use `clean: false` for checkout-heavy jobs on the shared runner.
- Put checkout-mutating command bodies behind the same lock used by browser/render E2E sections.
- Run quality checks that invoke package-manager resolvers from a temp clone with a temp npm cache.

## Key Static-Analysis Baselines On Stable Evidence

**Rule:** Static-analysis baseline identity must be based on stable evidence, such as rule id, normalized path, and matched source fingerprint, not line numbers alone.

**Why:** The Quality gate failed on a stale Semgrep line range even when no new security finding existed. Treating line movement as a new finding created avoidable churn and made the CI debug loop look larger than it was.

**How to apply:**

- Reproduce with the same `semgrep scan --config p/default --severity ERROR --error --json` command and `check-semgrep-baseline.mjs`.
- Keep line numbers as review/reporting metadata only; do not use them as the primary baseline key.
- Fail when the rule, normalized path, or matched source fingerprint changes, because that requires human review.
- Add tests for harmless line movement and meaningful source changes whenever baseline matching logic changes.

## Treat The CI Checkout As Immutable Input

**Rule:** Jobs that install dependencies, build assets, run browser tests, generate runtime files, or invoke Docker-backed install scripts should operate from a per-job clone instead of mutating the shared Actions checkout.

**Why:** Forgejo exposed repeated failures where successful local commands became remote flakes because sibling jobs or older Docker runs left checkout state, permissions, reports, or generated files behind. Retrying long suites without isolating that state wastes time and makes failures ambiguous.

**How to apply:**

- Use `scripts/ci/run-in-isolated-workspace.sh` for short-lived package/test commands.
- Use `scripts/ci/create-isolated-workspace.sh --docker-visible` for Docker-backed jobs whose bind mounts must be visible to the host Docker daemon.
- Chain quick jobs that still consume the same workspace when job-level parallelism offers little value but creates checkout races.
- Chain quality jobs that all read the shared checkout; temp clones still need a stable source checkout.
- Keep marker jobs as thin status translators only; the actual test body should run in the named job or in a documented combined job.
- Clean isolated workspaces after containers are stopped, and make cleanup warning-only so stale root-owned generated files cannot fail an otherwise passed test.

## Give Long Fixture Suites First-Class Job Boundaries

**Rule:** Long E2E suites with independent fixtures should expose each fixture as a named job or matrix cell, with per-fixture artifacts, instead of hiding all fixtures inside one sequential shell step.

**Why:** The extended install upgrade path failed after earlier install and baseline jobs passed, but the remote job logs were unavailable through the API. A single combined `Upgrade Extended` job made it impossible to tell which fixture failed without rerunning local guesses.

**How to apply:**

- Put fixture names in the CI job name so the failing case is visible from status alone.
- Keep shared-runner locks around the mutating E2E body rather than relying on a combined sequential shell step for isolation.
- Upload artifacts per fixture so failed fixture evidence can be downloaded independently.
- Preserve aggregate summary semantics through the matrix job result instead of weakening required checks.

## Treat BuildKit Cache Corruption As A Build Boundary Failure

**Rule:** When Docker BuildKit fails while exporting or unpacking an image layer with tar/cache errors, recover at the compose build boundary and then keep startup in `--no-build` mode.

**Why:** Removing duplicate compose builds fixed one race, but a later Forgejo upgrade run still failed on `archive/tar: invalid tar header` for the backend image itself. Re-running long E2E suites without a targeted builder-cache recovery only repeats the expensive failure.

**How to apply:**

- Capture the compose build output and retry only recognized cache-corruption failures.
- Clear Docker builder cache, not containers or volumes, and retry once with `--no-cache`.
- After a successful build, use `docker compose up --no-build` so startup cannot trigger a second, differently handled build.
- For legacy installers, inspect the build log even when the installer exits `0`; older setup paths can print a BuildKit failure and still continue to a misleading completion banner.
- Keep this logic in installer/setup code, not in CI-only wrapper sleeps or brittle log-line assertions.

## Pin CI Node Patch Versions On Forgejo

**Rule:** Forgejo workflows should use an exact Node patch version, not a floating major, when native JavaScript toolchain commands are required gates.

**Why:** A quality run pulled a newer Node 24 patch and ESLint segfaulted three times before any lint finding was produced, while the same command passed locally on the previously verified Node patch.

**How to apply:**

- Keep `.node-version`, `.nvmrc`, and setup-node workflow `NODE_VERSION` values aligned.
- For jobs that intentionally use the runner-provisioned Node binary, keep the guard to a major-version check unless the job also installs the exact patch.
- Treat native exit `139` in lint/typecheck/build setup as toolchain instability until the exact command fails locally on the same Node patch.
- Prefer pinning the known-good patch over adding more retries around deterministic native crashes.

## Serialize Node Toolchain Gates On Shared Forgejo Runners

**Rule:** Node-heavy CI command bodies that install dependencies, typecheck, lint, build docs, or generate graphs should use a shared runner lock when they can run in parallel on the same Forgejo runner.

**Why:** After pinning Node, quick frontend checks still hit native `139` crashes in `npm ci` and TypeScript while architecture and quality workflows were active. Retrying whole jobs did not remove the underlying resource contention.

**How to apply:**

- Use the existing `scripts/ci/with-runner-lock.sh` helper with a specific lock name such as `node-toolchain`.
- Put the lock around the expensive command body, not just checkout or a single small command.
- Keep Docker/browser E2E on the existing `e2e` lock; use a separate Node lock so unrelated Docker serialization does not hide the actual resource boundary.

## Avoid Setup Actions When The Job Already Bootstraps The Tool

**Rule:** On Forgejo, avoid setup actions for tools that the job can verify and bootstrap itself with a simple command check.

**Why:** Verify Vectors failed before vector tests because `actions/setup-python` downloaded a corrupted Python archive and tar failed. The verifier script already creates its own Python virtualenv and installs pinned dependencies.

**How to apply:**

- Prefer `python3 --version` plus `python3 -m venv --help` when the script creates a venv itself.
- Keep dependency pinning inside the repo-owned script where local and CI behavior match.
- Reserve setup actions for cases where they provide semantic coverage that the repo script cannot supply.

## Separate Dependency Install From Native Codegen In CI

**Rule:** CI jobs that need Prisma-generated clients should install Node dependencies with lifecycle scripts disabled, then run `prisma generate` explicitly behind the retry/lock boundary.

**Why:** Verify Vectors failed in `npm ci` because `server` postinstall ran Prisma generate and the native process exited `139`. When codegen is hidden inside lifecycle scripts, the workflow cannot retry or label the real failing operation.

**How to apply:**

- Use `npm ci --ignore-scripts` for dependency installation in narrowly-scoped CI jobs.
- Run shared-module linking and `npx prisma generate` as named commands through `scripts/ci/retry-command.sh`.
- Use `npm run test:run` for focused Vitest commands after generating Prisma once, so `pretest` does not re-run codegen before every test step.

## Resolve Docker Before Starting CI Containers

**Rule:** Forgejo workflows that start Docker services must run `scripts/ci/wait-for-docker.sh` before the first `docker` or `docker compose` command.

**Why:** Verify Vectors reached Bitcoin Core startup after the dependency/codegen split, then failed because Docker was pointed at a `docker-in-docker` hostname that this runner could not resolve.

**How to apply:**

- Use the shared Docker wait helper instead of assuming a specific `DOCKER_HOST`.
- Treat the Docker CLI endpoint and published service host as separate values; remote Docker port mappings are not necessarily reachable on job-container loopback.
- Keep endpoint parsing in `scripts/ci/docker-endpoint-lib.sh` so workflow helpers and repo scripts do not drift.
- Add the helper to workflow path filters when a workflow depends on it.
- Resolve Docker once per job before repo scripts that start containers, so scripts can stay portable across local, hosted, and Forgejo runner environments.

## Keep Crypto Primitives Portable Across CI Images

**Rule:** Verification scripts that need Bitcoin HASH160 must not assume `hashlib.new('ripemd160')` is available in every CI Python/OpenSSL build.

**Why:** Verify Vectors reached the real vector checks after the Forgejo Docker fixes, but the Python verifier failed every HASH160 path on a runner image where RIPEMD160 was unavailable through `hashlib`.

**How to apply:**

- Prefer the verifier's pinned crypto dependency for RIPEMD160 fallback instead of relaxing consensus requirements.
- Keep direct `hashlib.new('ripemd160')` calls behind one helper so single-sig and multisig paths share the same behavior.
- Locally rerun the repeatable verifier after cryptographic fallback changes; fixture drift checks should still pass.

## Validate Native CI Tools Inside The Retry Boundary

**Rule:** CI tool installation retries must include the executable validation command, not only package installation.

**Why:** Code Quality failed after Semgrep installed because `semgrep --version` exited with native `139`. The first install attempt also hit a package hash mismatch, so reusing the same venv/cache was not a reliable recovery path.

**How to apply:**

- Install each native Python/Node tool in a fresh temp workspace per attempt when validating the executable fails.
- Disable package caches on retry after download integrity errors or native crashes.
- Keep the installer in a tested script instead of embedding multi-branch retry logic directly in workflow YAML.

## Treat Runner Toolchains As Explicit Contracts

**Rule:** Required PR workflows should verify preinstalled runner toolchains with repo-owned scripts before running package managers, instead of downloading Node/Python in every job.

**Why:** Forgejo jobs kept failing before repo code ran: `setup-node` exited `139` while adding Node to cache, and `setup-python` failed extracting a corrupt archive. The same issue resurfaced across unrelated jobs because toolchain setup was still hidden inside provider actions.

**How to apply:**

- Use workflow actions for orchestration, not fragile per-job toolchain mutation when the runner image already owns the toolchain.
- Put version checks in small scripts with local tests, and reuse them across Quality/Test/Verify workflows.
- Invoke repo scripts through `bash` unless the executable bit is intentionally part of the contract and verified in tests.
- Create Python virtualenvs in run-scoped temp directories by default; never reuse a repo-local venv across CI jobs unless the reuse path has corruption detection and cleanup.

## Scope Every Optional Service Port To The Test Run

**Rule:** Docker-backed fixtures that enable optional services must derive all host ports from the run-scoped test port allocation, not from fixed "isolated" constants.

**Why:** The optional-profiles upgrade fixture used fixed monitoring and Jaeger ports. On the shared runner, a leftover or sibling service could hold one of those ports, causing the fixture to fail before backend health even though the core upgrade path was healthy.

**How to apply:**

- Treat app ports and optional service ports as one allocation family.
- Preserve explicit operator overrides, but make CI defaults derive from `install-test-ports.sh` or the harness `HTTPS_PORT`.
- Unit test the derived port range so future fixtures do not quietly reintroduce fixed host ports.
- When locally verifying uncommitted CI fixes inside isolated clones, apply the working-tree diff to the clone before running the repro; otherwise the clone only tests committed `HEAD`.

## Treat Explicit Installer Sources As Authoritative

**Rule:** Installer `--source` arguments must override existing git remotes and must not fall back to another forge; automatic/default source selection may fail over only when the operator did not explicitly choose a source.

**Why:** The user ran `./install.sh --source codeberg` from a checkout whose `origin` still pointed at GitHub. The installer printed Codeberg but `git fetch` used the stale GitHub remote, producing a GitHub credential prompt instead of a Codeberg pull.

**How to apply:**

- Track whether the source came from an explicit CLI argument separately from the selected forge name.
- Before any online `git fetch` in an existing checkout, rewrite `origin` to the selected forge URL.
- Run git network operations with terminal prompts disabled so a 404 or blocked forge fails cleanly.
- Add regression coverage for stale `origin` plus explicit `--source`, explicit-source no-fallback, and automatic prompt-free failover.

## Audit Coverage Before Broad Feature Commits

**Rule:** Before committing a broad feature series, map each new behavior area to focused tests and add direct helper tests for any new branchy utility modules that are only indirectly covered.

**Why:** The user asked for one more test coverage pass before committing the Testnet/Signet upgrade series. The main flows were covered, but direct tests for derivation-path grouping and skipped-xpub warning copy made the testnet-specific helper behavior explicit and easier to preserve.

**How to apply:**

- Group changed code by behavior, not by file count: hardware import, account selection, sync routing, dashboard status, mempool data, UI contrast, and migrations.
- Prefer small direct unit tests for reusable helpers whose behavior would otherwise be asserted only through a component or hook.
- Re-run the focused suites that correspond to the behavior map, then type checks, lizard, and diff hygiene before staging.

## Avoid Light Toggle Surfaces In Dark Mode

**Rule:** Shared switch/toggle controls must set both dark-mode thumb color and dark-mode focus ring offset explicitly.

**Why:** The new testnet/signet sync toggle reused `dark:bg-sanctuary-100`, which is near-white in the Sanctuary dark palette, and the default Tailwind focus ring offset is white unless overridden.

**How to apply:**

- Use dark surface tokens such as `dark:bg-sanctuary-900` for toggle thumbs in dark mode.
- Add `dark:focus:ring-offset-sanctuary-950` when using `focus:ring-offset-*` on dark surfaces.
- Add focused class assertions when fixing theme-specific control regressions.
- If the user still sees a light surface, verify browser-computed styles for the rendered route and remove white/light base classes from that specific control instead of relying on `dark:` overrides.

## Check Dark Theme Inverted Palette Contrast

**Rule:** In dark mode, do not assume low numeric theme shades are light text colors; inspect the active theme palette before choosing badge foreground/background classes.

**Why:** The Sanctuary dark palette inverts semantic color scales, so `dark:text-testnet-100` resolves to a dark amber and became unreadable on the wallet-detail testnet badge.

**How to apply:**

- For dark-mode network badges, pair dark backgrounds like `dark:bg-testnet-50` with light foregrounds like `dark:text-testnet-950`.
- Add focused render assertions for the actual dark-mode utility classes when fixing theme contrast bugs.
- Re-check signet alongside testnet when they share the same badge helper.

## Surface Partial Hardware Account Imports

**Rule:** Do not treat a hardware wallet USB import as complete when standard paths were skipped; preserve and surface partial xpub failures, especially across mainnet/testnet coin-type boundaries.

**Why:** The user registered a Ledger after the testnet path fix, but the local instance still stored only the six mainnet accounts. Wallet creation then correctly rejected the missing `m/84'/1'/0'` account, while the UI gave no clue that Ledger testnet paths had been skipped.

**How to apply:**

- Track per-path xpub failures alongside successful USB imports.
- Show partial-import warnings in both new-device registration and add-account retry flows.
- For Ledger coin-type `1` paths, tell the user to open the Bitcoin Test app and retry USB import when testnet/signet paths were not returned.
- Do not imply Ledger Live is the primary blocker for coin-type `1` failures; distinguish "USB connection is claimed" from "regular Bitcoin app is open instead of Bitcoin Test."

## Treat Signet As Testnet-Family For Wallet Key Material

**Rule:** When fixing testnet wallet creation, derivation, or hardware account selection, include signet wherever the product exposes it as a selectable wallet network.

**Why:** The user caught that the testnet hardware-wallet fix did not explicitly cover signet, even though the UI/API already advertise signet and the sync layer routes it separately.

**How to apply:**

- Use coin type `1` for signet derivation paths, matching testnet/regtest hardware account exports.
- Use bitcoinjs testnet address parameters for signet address derivation and validation, while preserving `network: "signet"` for wallet records and node/electrum routing.
- Add signet regression tests next to any testnet wallet-account or address-derivation coverage.

## Pin Calendar-Boundary Tests To A Deterministic Clock

**Rule:** Tests for "this month", "last month", week/month windows, or other relative calendar presets must set an explicit fake system time near the middle of the relevant period.

**Why:** PR #237 passed locally in Hawaii time but failed in the merge queue on May 1 UTC because the test's "current month + 1 day" fixture was in the future relative to CI's clock.

**How to apply:**

- Use `vi.useFakeTimers({ now: new Date(year, month, day, hour).getTime() })` for date-preset tests.
- Restore real timers in `afterEach`.
- Avoid relative fixtures that become future-dated on the first day of a period.
- When a CI-only date failure appears, rerun the focused test with `TZ=UTC` before changing production date logic.

## Land Green Parent PRs Before Stacking Follow-Up Remediation

**Rule:** When a green PR already contains the previous completed wallet-safety tranche, merge and verify that parent before continuing new remediation on top of the same branch.

**Why:** The user caught that PR #237 was still open while follow-up fixes were being applied locally. Continuing on the same branch would turn a ready-to-merge proof tranche into a larger moving target.

**How to apply:**

- Check the PR state before adding follow-up commits to a branch with an open PR.
- If the PR is green and clean, stash local follow-up work, queue/merge the PR, and verify `mergedAt` plus `origin/main`.
- Resume new work from updated `main` or a follow-up branch, then reapply the stashed changes deliberately.
- Do not delete the PR branch until merge completion is verified, especially on merge-queue repos.

## Do Not Chase Grade Points Without A Design Boundary

**Rule:** In grade remediation, only split or classify a file when the change follows a real ownership, lifecycle, runtime, fixture, or proof-artifact boundary.

**Why:** The user clarified that classification-aware scoring and large-file cleanup were worth doing only if architecturally correct, not just to reach 100/100.

**How to apply:**

- Treat the score as a signal for investigation, not as permission to fragment cohesive modules.
- Prefer extracting mixed responsibilities into named modules when the boundary already exists in the domain.
- Leave cohesive orchestrators intact when further splitting would make lifecycle or state ownership harder to reason about.
- Document intentional non-changes in the grade report so future passes do not re-open the same metric-driven refactor.

## Model Wallet Key-Material Prerequisites Explicitly

**Rule:** Wallet setup plans must distinguish "create the wallet record" from "collect the required public key material first," especially for multisig flows that need cosigner xpub/ypub/zpub exports and may use any M-of-N quorum.

**Why:** The initial agent-wallet UI plan said the wizard could choose or create a multisig funding wallet, but the user clarified that creating the multisig wallet requires the cosigner extended public keys before Sanctuary can build the descriptor. The user also clarified that agent funding wallets are not necessarily 2-of-2; two humans may need to approve after the agent submits its partial signature.

**How to apply:**

- Treat multisig funding wallet creation as a prerequisite workflow unless all cosigner xpub/ypub/zpub data is already present.
- Describe funding wallets as M-of-N, not 2-of-2, unless the user explicitly asks for a 2-of-2 policy.
- In guided setup UI, prefer selecting an existing multisig funding wallet and link to the create/import wallet flow with explicit key-material requirements when missing.
- Keep xpub/descriptor import language focused on watch-only operational wallets unless the flow also collects every multisig cosigner export.

## Separate Agent Request Authority From Funding Signer Authority

**Rule:** Do not assume an agent must be a Bitcoin signer on the funding multisig. First decide whether the agent is a requester, a funding cosigner, or both.

**Why:** The agent-wallet design originally inherited the existing implementation where the agent submits a PSBT signed by a registered funding-wallet signer. The user questioned whether that buys anything for a treasury refill workflow where humans may need to provide all funding approvals.

**How to apply:**

- If the desired control is human approval of refills, prefer "agent as requester" with scoped API credentials and human-only funding signatures.
- Use "agent as funding cosigner" only when the product explicitly needs the agent to cryptographically approve the exact funding PSBT.
- Do not let an agent signer accidentally reduce the intended human quorum; for example, a 2-of-3 funding wallet with agent + two humans allows agent + one human to meet quorum.

## Treat Agent Funding Links As Capabilities, Not Wallet Types

**Rule:** An agent funding relationship should grant a scoped ability to request/build signable drafts from a human-owned funding wallet; it should not imply that the funding wallet is exclusively designated for agents.

**Why:** The user clarified that the funding wallet can be any human-owned single-sig or multisig wallet, and the agent-to-funding relationship is an abstract capability relationship that lets the agent wallet create a signable funding transaction.

**How to apply:**

- Do not require funding wallets to be multisig unless the product requirement is specifically human quorum approval.
- Keep ordinary wallet ownership, sharing, policy, signing, and broadcast rules intact for funding wallets used by agents.
- Model the link as operational wallet + allowed funding wallet + scoped requester permissions + caps/monitoring, not as a special "agent funding wallet" type.
- Let the normal wallet type determine how the resulting draft is signed: single-sig by its human owner, multisig by its configured human quorum.

## Verify Agent Draft Destinations Server-Side

**Rule:** Agent-created funding drafts must only pay addresses belonging to the linked agent operational wallet, with funding-wallet change as the only other allowed output.

**Why:** The user clarified that requester-only agents can build signable funding transactions, but they must never be able to create funding-wallet transactions to arbitrary external addresses.

**How to apply:**

- Validate destination ownership on the server before creating the draft or locking UTXOs.
- Do not trust labels, wallet names, or agent-provided metadata as proof of ownership.
- For single-recipient refills, require the recipient to be a verified receive address from the linked operational wallet.
- For future batch outputs, verify every non-change destination belongs to the linked operational wallet.

## Avoid One-Off Env-Prefixed Tool Commands

**Rule:** Do not rely on inline `env PATH=... command` prefixes for routine Node tooling. Use the repo's normal package scripts, a durable local runtime setup, or a stable non-env wrapper.

**Why:** Repeated env-prefixed commands are noisy, bypass reusable approval prefixes, and make local verification feel different from CI even after the repo declares the right Node version.

**How to apply:**

- Prefer plain `npm run ...` only after confirming `node --version` matches `.nvmrc` and CI.
- If the shell default is stale, use a stable Node 24 invocation or fix the local runtime once instead of prefixing every command with environment variables.
- Do not use `npx` for tools that are not installed locally; it may try the network and trigger avoidable approval or DNS failures.
- Add package scripts or local dev-tool dependencies when a verification command needs to be repeatable.

## Preserve Compose Project And Volume Identity During Local Rebuilds

**Rule:** Before rebuilding a running local instance, identify the exact Compose project, working directory, config files, environment file, and Postgres volume that currently serve the user-facing URL; rebuild that identity or explicitly migrate its data before switching projects.

**Why:** Replacing a stale `sanctuary-upgrade-test-*` project with the default `sanctuary` project created a fresh `sanctuary_postgres_data` volume and made the app appear defaulted. Recovery then required scanning preserved volumes and restoring the only non-empty source.

**How to apply:**

- Run `docker inspect` on the frontend and postgres containers for `com.docker.compose.project`, `project.working_dir`, `project.config_files`, and mounted volume names before stopping anything.
- Capture DB fingerprints before rebuild: user count, wallet count, device count, wallet networks, and oldest user timestamp.
- If the target project name changes, dump/restore or reattach the existing Postgres volume deliberately before starting the replacement stack.
- When recovering, match the user's expected data signature, for example "one device and a testnet wallet," before overwriting the active DB.

## Treat CodeQL As GitHub-Native Unless Proven Otherwise

**Rule:** Do not make CodeQL a required Forgejo gate unless the workflow has been proven on the target Forgejo runner with a pinned or self-hosted CodeQL bundle.

**Why:** `github/codeql-action/init` queries `GITHUB_API_URL` for `github/codeql-action` tags when choosing the CLI bundle. On Forgejo, `GITHUB_API_URL` points at the Forgejo instance, which has no `github/codeql-action` repo and returns `404`.

**How to apply:**

- Prefer Forgejo-native security gates such as Semgrep, dependency audit, secret scan, actionlint, lockfile checks, and complexity/duplication gates.
- If CodeQL is reintroduced on Forgejo, pin the CodeQL CLI bundle URL or self-host the CLI and verify the workflow before adding it to required checks.
- Keep GitHub-only CodeQL assumptions out of Forgejo branch protection until the Forgejo run has passed end to end.
- When comparing GitHub and Forgejo CI, compare the security coverage intent, not just exact workflow names.

## Do Not Assume Forgejo Actions Runs Are API-Cancellable

**Rule:** Before trying to clear a Forgejo Actions backlog, check the live Forgejo OpenAPI schema for a run cancel endpoint and avoid runner-level cleanup unless the user accepts failed/stale statuses.

**Why:** Forgejo `15.0.1` exposed run listing, run details, task listing, and workflow dispatch, but no `POST /actions/runs/{run_id}/cancel` endpoint. The GitHub/Gitea-style cancel route returned `404`, and the web cancel route required a browser session instead of the git/API credential.

**How to apply:**

- Use `swagger.v1.json` to confirm supported Actions endpoints for the live instance.
- Treat local runner container kills as a blunt fallback: they may free capacity but usually do not produce clean "cancelled" run history.
- For stale pre-fix queues, prefer letting Forgejo drain and judge only fresh runs on the current workflow state.
- If clean cancellation is required, use the Forgejo web UI with an authenticated browser session or upgrade/configure Forgejo to expose a supported cancel API.

## Use Nvm For Node And Npm Runtime Updates

**Rule:** When the repo standardizes on `nvm`, do not keep suggesting or running `npm install` to update the runtime/npm toolchain. Use `nvm install`, `nvm use`, or the repo's documented Node setup instead.

**Why:** The user clarified that repeated `npm install` update suggestions fight the intended `nvm` workflow and create unnecessary churn when the goal is to align the local runtime.

**How to apply:**

- Check `.nvmrc`, `.node-version`, `package.json` engines, and CI Node settings before changing local tooling.
- Use `nvm install` to install the required Node version and bundled npm version.
- Use `nvm use` before verification commands when the shell is on the wrong Node major.
- Only run `npm install` when dependencies actually need to be installed or the lockfile/package metadata intentionally changes.

## Separate Global Ops Settings From User Preferences

**Rule:** Before proposing a DB-backed setting, classify whether it is global deployment state or a per-user preference.

**Why:** The price-provider enable/disable plan initially used "settings" wording that could imply per-user provider availability. The user clarified that provider enablement should not vary by user.

**How to apply:**

- Treat external-service enablement, backend registry membership, health checks, and cache policy as global admin configuration.
- Keep live external-service diagnostics and test probes in admin/operator surfaces, not regular user preference screens.
- Keep user preferences limited to presentation or selection among globally allowed options.
- Spell out fallback behavior when an admin disables a globally enabled option that a user had selected.

## Match Local Node To CI Before Diagnosing Node-Sensitive Failures

**Rule:** Before treating a CI-only frontend or Playwright failure as an app regression, verify the local shell is running the same Node major as CI and the repo's `engines` field.

**Why:** During PR #229 delivery, local render regression tests passed under Node 22 while CI runs Node 24. The user had to correct course to align the local runtime before continuing diagnosis.

**How to apply:**

- Check `node --version`, `.nvmrc`, `.node-version`, and `package.json` before reproducing CI-only Node/Playwright failures.
- Keep repo version files aligned with the CI `NODE_VERSION` and package `engines`.
- Rerun the failing command after switching runtimes before changing app code or rerunning CI again.

## Write Non-Trivial Plans To The Task Tracker First

**Rule:** For repo work with multiple steps or architectural choices, add the plan to `tasks/todo.md` before proceeding, even if an in-chat plan already exists.

**Why:** The project workflow expects `tasks/todo.md` to be the shared task ledger. The user had to correct the plan-only response to make sure the removal plan was captured there before implementation.

**How to apply:**

- Start non-trivial implementation by adding an active task section with checkable plan items to `tasks/todo.md`.
- Mark progress in that file as the work advances.
- Add a review section with concrete verification results before handing off or opening the PR.

## Treat Merge-Queue Failures As A Different Signal From PR Checks

**Rule:** When a user reports a Test Suite failure during PR delivery, inspect merge-group and post-merge runs, not only the PR-head checks.

**Why:** PR #222 had green PR-head Test Suite checks, but the merge queue ran the full backend coverage lane and rejected the PR for a 100% threshold miss. Looking only at PR checks would have missed the real failure.

**How to apply:**

- Check `gh run list` for `gh-readonly-queue/main/pr-...` merge-group runs after queueing a PR.
- Use `gh run view <run-id> --json jobs` to find the root failing job before reading logs.
- Reproduce queue-only gates locally when possible, including elevated local socket permission for backend coverage tests.
- After fixing, re-queue and verify both merge-group checks and post-merge `main` workflows.

## Consolidate Instruction Updates Instead Of Stacking Bullets

**Rule:** When the user asks to add or refine agent guidance, search for overlapping guidance and rewrite it into a clearer structure instead of appending duplicate bullets.

**Why:** The AGENTS.md completion guidance already had verification, elegance, and excellence sections with overlap. The user clarified that a better format was preferred.

**How to apply:**

- Read the nearby instruction sections before editing.
- Merge related rules into named checklists or gates.
- Keep the user's specific requested behavior explicit in the final wording.
- When next-step guidance is requested, allow an explicit "None required" instead of inventing unnecessary follow-up work.

## Treat Plan-Only Corrections As A Hard Stop

**Rule:** When the user corrects course to "plan only" or "do not edit yet," stop before file changes and return a concrete implementation plan.

**Why:** During Console transaction prompt triage, the user interrupted to clarify that they wanted planning before edits. Even task-tracker writes count as file edits in that mode.

**How to apply:**

- Do not update `tasks/todo.md` until the user re-authorizes implementation.
- Keep investigation commands read-only unless the user asked for no tooling at all.
- Resume normal task tracking only after the user explicitly says to continue.

## Model-Backed Drawers Need Local Clear And Pending Affordances

**Rule:** Interactive assistant drawers need separate controls for clearing local display state, persisted sessions, and prompt history, plus a visible pending indicator while waiting on the model.

**Why:** Console had session switching and prompt history, but no direct way to reset the visible transcript or clean up persisted assistant state. During slow LM Studio calls, the UI also needed a stronger indication that the LLM was still thinking.

**How to apply:**

- Keep "clear display" local and non-destructive.
- Use confirmed server-backed soft deletes for sessions and prompt history.
- Make pending model state an accessible status with an icon/animation, not just disabled input state.
- Cover each operation with UI and API tests so cleanup controls do not regress silently.

## Align Browser, Proxy, and Model Timeouts

**Rule:** Any browser path backed by local model calls must keep frontend proxy timeouts longer than the client/backend model-call budget, and the browser API client must turn non-JSON proxy pages into HTTP errors.

**Why:** A Console replay against LM Studio ran slightly past nginx's 60s `/api/` proxy timeout. Nginx returned a 504 HTML page, and the browser tried to parse it as JSON, surfacing `Unexpected token '<'` instead of a useful timeout error.

**How to apply:**

- Check the deployed reverse proxy timeout whenever increasing model, backend, or client request timeouts.
- Keep proxy read/send timeouts above the longest expected Console request timeout.
- Parse API responses defensively so HTML/plain-text proxy failures become `ApiError` objects with HTTP status and a body preview.
- Add tests for proxy templates and non-JSON error responses, not only JSON backend errors.

## Multi-Wallet Console Results Need A First-Class Surface

**Rule:** When Console can produce multiple scoped tool calls, provide an aggregate result surface instead of suppressing navigation or choosing one wallet.

**Why:** The all-wallet transaction plan correctly queried every visible wallet, but the UI had only a single-wallet Transactions-tab target. Multi-wallet results therefore had no good place to show the list.

**How to apply:**

- Model Console transaction output as a query that can contain one or many wallet filters.
- Keep single-wallet prompts routed to the wallet detail Transactions tab.
- Route multi-wallet prompts to an aggregate transaction results view with wallet labels and the same date/type constraints.
- Add tests for both single-wallet and all-wallet transaction prompts so one path cannot regress the other.

## Echo Chat Prompts Before Model Calls Finish

**Rule:** Conversational UI must append the submitted user prompt optimistically before awaiting a model-backed request, and failed turns should remain visible inline with diagnostic details.

**Why:** Console waited for `/console/turns` to succeed before adding the user prompt. When a slow local LM Studio request aborted, the dialogue showed no prompt and only a generic failure surface.

**How to apply:**

- Add a pending user message before starting async model execution.
- Replace the pending row with the persisted turn on success.
- On non-setup failures, keep the user prompt and append a failed assistant row with expandable HTTP/provider details.
- Keep client, backend, and proxy timeouts aligned for local models that may be slow on first load.

## Reuse Sidebar Section Header Styling

**Rule:** New sidebar subsections must reuse the same header spacing, uppercase sizing, and left alignment as `Wallets`, `Hardware`, and system sections.

**Why:** The initial `Actions` label was indented with the quick-action icons instead of aligning with other sidebar section headers.

**How to apply:**

- Use the existing `px-4 text-[9px] font-semibold uppercase tracking-[0.15em]` header treatment.
- Keep icon rows as controls underneath the header, not as the header alignment anchor.
- Add layout tests that assert the header classes when adding sidebar action groups.

## Do Not Hide Setup Drawers Behind Setup Checks

**Rule:** A launcher for a setup/help drawer should be gated only by the broad feature being enabled, not by the deeper API checks the drawer exists to explain.

**Why:** The Console sidebar icon was hidden when `/console/tools` returned a `sanctuaryConsole` feature-gate error, so the user could not open the flyout to see the reason-specific setup message.

**How to apply:**

- Use high-level assistant enablement for launcher visibility.
- Let drawer contents handle provider, model, endpoint, and feature-flag setup states.
- Add tests that prove setup-needed states still leave the launcher visible when the assistant feature is on.

## Do Not Use Health As Enablement

**Rule:** Keep feature enablement, setup completeness, and runtime health as separate status fields. UI launchers should use enablement; execution paths can use setup and health.

**Why:** `/ai/status` treated missing/unhealthy provider setup as disabled AI, so the sidebar hid the flyout even though the assistant was turned on and the flyout was needed to explain setup or feature-gate state.

**How to apply:**

- Expose explicit fields such as `enabled`, `configured`, and `available`.
- Preserve existing stricter service checks for model execution.
- Add hook tests where `enabled=true` and `available=false` still shows setup/help entry points.

## Put Drawer Translucency On The Drawer, Not The Page

**Rule:** When the user asks for a translucent flyout/drawer, make the drawer surface translucent and keep the app backdrop visually neutral unless they explicitly ask to dim or blur the app.

**Why:** The Console drawer used a dark blurred backdrop, which made the app itself look translucent/dimmed. The user meant the right-side flyout panel should be translucent.

**How to apply:**

- Use shared drawer surface classes such as `surface-flyout` for opacity and blur.
- Keep click-away backdrops transparent for side flyouts unless modal focus requires dimming.
- Add a component test that asserts the backdrop is transparent and the drawer carries the translucent surface class.

## Enforce CI runtime migrations with a guard

**Rule:** When fixing deprecated GitHub Actions runtime warnings, add or update a CI guard that resolves action manifests and fails on banned runtimes, including composite action dependencies.

**Why:** Updating visible workflow pins removes current warnings, but future manual action updates can reintroduce `runs.using: node20` through either direct actions or nested `uses:` entries in composite actions.

**How to apply:**

- Keep job `node-version` checks separate from action runtime checks; `setup-node` does not control action `runs.using`.
- Resolve each unique workflow `uses:` target to its `action.yml`/`action.yaml` and recurse through composite action steps.
- Run the guard from the workflow-quality lane and include a fixture test that proves direct and transitive deprecated runtimes fail.

## Do Not Preserve Legacy Behavior After Greenfield Clarification

**Rule:** When the user explicitly says a feature should be greenfield, remove compatibility assumptions from plans and architecture instead of continuing to route around old behavior.

**Why:** In the MCP/Console AI plan, I recommended compatibility wrappers for existing AI label/query/insight/chat routes. The user clarified there is no need to support legacy AI and to consider the work greenfield.

**How to apply:**

- Replace migration/compatibility sections with transition/removal sections.
- Treat old routes, settings, and tests as replaceable unless the user names a specific workflow to preserve.
- Keep existing UI locations only when they are useful product surfaces, not because old behavior must remain.

## Reuse Existing Admin Surfaces Before Proposing New Ones

**Rule:** Before planning new admin UI for a capability, search for the existing admin route/component that already owns that domain and frame the plan as an extension of it.

**Why:** For MCP/Console provider profiles, I initially described an "AI provider profiles/settings screen" as if it were separate, but Sanctuary already has an admin AI Assistant section in `components/AISettings` and an AI Assistant route.

**How to apply:**

- Search route registrations and component entrypoints before naming a new screen.
- Prefer new tabs/panels in the existing domain surface when the user already has a mental model there.
- Preserve existing workflows while migrating storage or backend models under them.

## Distinguish sandbox bind denial from occupied ports

**Rule:** When a local port probe fails, inspect the error code before saying the port is in use. `EPERM`/`EACCES` means the environment blocked binding; only `EADDRINUSE` proves an occupied port.

**Why:** The Phase 3 Compose smoke allocator reported no available ports in `18080-18179`, but elevated listener inspection showed no listeners there. The direct Node probe failed with `EPERM`, so the problem was sandbox permission, not stale Compose containers.

**How to apply:**

- Preserve and report the last bind error from port scanners.
- Use elevated `ss -H -ltnp` or equivalent listener inspection before blaming old test runs.
- Keep explicit port env vars as operator overrides, but do not require them for the normal command.

## Keep benchmark defaults in code-owned config

**Rule:** Repeatable benchmark and proof defaults belong in a constants/config module or sourced defaults file, not in one-off shell-prefix variables.

**Why:** The Phase 3 Compose split initially used command-line env prefixes to work around sandbox port probing and to shrink proof sizes. That made the verification command look like the interface and hid durable defaults outside the code.

**How to apply:**

- Centralize benchmark defaults in a named module such as `scripts/perf/phase3-compose/config.mjs`.
- Let the plain package script work with defaults; keep env vars only for explicit operator overrides.
- Add a lightweight config-resolution check so defaults are exercised without requiring Docker.

## Put repeatable test env defaults in sourced constants files

**Rule:** Do not rely on one-off `VAR=value command` prefixes for repeatable test workflows. Put durable defaults in a sourced constants/defaults file and make the runner export them.

**Why:** A focused integration-test run needed a non-default PostgreSQL port because `5433` was already occupied. Prefixing the command with `TEST_POSTGRES_PORT=...` made the fix easy to lose and duplicated configuration that belongs with the runner.

**How to apply:**

- Search for an existing scoped defaults file before adding a new one.
- Use a `*-defaults.sh` helper with an `apply_*_defaults` function when a shell runner owns the workflow.
- Keep package scripts and docs pointing at the runner instead of embedding connection strings or inline env prefixes.
- Preserve shell overrides for CI and local exceptions, but make the plain command work in the common local environment.

## Never delete a merge-queue PR branch before the queue merge lands

**Rule:** On repos using GitHub merge queue, do not run `gh pr merge ... --delete-branch`. Queue the PR first, verify `mergedAt` and `mergeCommit` after the queue completes, then delete the branch only after `origin/main` contains the PR commit.

**Why:** PR #134 was added to the merge queue, then the same `gh pr merge --merge --delete-branch` invocation deleted the head branch while the PR was still queued. GitHub closed the unmerged PR and the merge queue bot removed it from the queue, leaving `origin/main` unchanged.

**How to apply:**

- Use `gh pr merge <number>` without `--delete-branch` when branch protection says the merge strategy is set by merge queue.
- Immediately verify with `gh pr view <number> --json state,mergedAt,mergeCommit` and `git branch -r --contains <head-sha>`.
- Only clean up the remote branch after `mergedAt` is non-null and `origin/main` contains the head commit.

## Add classifier tests before adding expensive CI triggers

**Rule:** Every new expensive CI path trigger must land with a classifier test that proves both the intended run case and at least one intended skip case.

**Why:** Path-aware CI speedups only hold if workflow YAML and classifier scripts stay aligned. Without executable fixtures, a broad pattern can quietly turn frontend helper, docs, or workflow-only changes back into browser, build, install, or CodeQL-heavy runs.

**How to apply:**

- Add or update the relevant classifier test in `tests/ci/` or `tests/install/unit/` in the same commit as the workflow trigger.
- Include a positive fixture for the expensive lane and a negative fixture for a nearby path that must stay cheap.
- Keep aggregate required-check logic based on the same classifier outputs used by the job `if:` conditions.

## Isolate work when another agent owns the active files

**Rule:** If the user says a problem is being worked in parallel, stop touching that problem's files and shared task tracker state. Move unrelated work into a separate worktree or branch before continuing.

**Why:** During CI optimization cleanup, the main worktree had active Ledger adapter and `tasks/todo.md` edits from parallel work. Continuing to stash, sync, or rewrite shared files there would risk trampling another agent's in-flight changes.

**How to apply:**

- Treat uncommitted files for the parallel task as user-owned until proven otherwise.
- Use `git worktree add` from the current remote base for unrelated follow-up work.
- Do not edit `tasks/todo.md` for the unrelated task if it is part of the active parallel work state.
- Before final cleanup, report any intentionally untouched local changes rather than trying to "fix" them.

## Continue follow-up batches in a worktree when the primary tree is dirty

**Rule:** If the primary worktree has unrelated local edits and the user asks to continue, create a separate worktree from `origin/main` and do all planning, implementation, commits, PRs, and verification there.

**Why:** After PR #139, the primary worktree had an unrelated `tasks/todo.md` triage edit. Continuing in that tree would mix the new CI batch with another local task and make cleanup/sync unsafe.

**How to apply:**

- Start with `git status --short --branch`, `git fetch origin main`, and `git worktree list`.
- Create a task-specific worktree and branch from `origin/main`.
- Keep task tracker and lessons updates inside that worktree's branch.
- Do not stash, reset, pull over, or rewrite the dirty primary tree unless the user explicitly asks for that cleanup.

## Treat encrypted operational state as upgrade-critical data

**Rule:** Upgrade tests must prove encrypted runtime state can still be read after upgrade, not only that the env file values look preserved.

**Why:** A node upgraded to `0.8.42` preserved enough auth behavior to fix CORS and allow password login, but existing 2FA failed because the stored TOTP secret could not be decrypted with the current `ENCRYPTION_KEY`/`ENCRYPTION_SALT`. The route code and TOTP verifier were fine; the failure was encrypted state continuity.

**How to apply:**

- For every encrypted persisted field, seed a realistic value before upgrade and perform the real post-upgrade operation that decrypts it.
- For 2FA specifically, seed/enable 2FA before upgrade, then after upgrade verify password login returns `requires2FA` and `/auth/2fa/verify` succeeds with a fresh TOTP code.
- Add operator recovery tooling for encrypted-state lockouts instead of relying on ad hoc SQL or chat-pasted commands.
- Document that losing `ENCRYPTION_KEY`/`ENCRYPTION_SALT` makes existing 2FA secrets unrecoverable; recovery means reset and re-enroll.

## Prefer one-line remote recovery commands over heredocs

**Rule:** For urgent operator recovery steps on a remote node, prefer short `docker compose exec ... node -e '...'` commands or clearly separated scripts over long heredocs.

**Why:** A 2FA reset recovery command was pasted only through the opening of a heredoc body, then closed early with `NODE`, causing Node to run an incomplete script and fail before any recovery action.

**How to apply:**

- Use one command per operation when the user is copying into a live shell.
- If a heredoc is necessary, explicitly say to paste the full block without pressing Enter at the closing marker until the whole body is present.
- For destructive or account-recovery DB updates, run a backup command first and keep the update command separate.

## Missing encryption salt on legacy envs must not rotate encryption material

**Rule:** If an existing runtime env already has `ENCRYPTION_KEY` but lacks `ENCRYPTION_SALT`, setup must keep the historical default salt (`sanctuary-node-config`) instead of generating a new random salt.

**Why:** Older installs could derive encrypted-field keys from `ENCRYPTION_KEY` plus the implicit default salt. Writing a random salt during upgrade preserves the env shape but changes the derived key, so encrypted 2FA secrets become undecryptable even though the configured key appears unchanged.

**How to apply:**

- Treat `ENCRYPTION_KEY` and `ENCRYPTION_SALT` as one versioned encryption-material pair.
- Fresh installs can generate a random salt; upgrades of existing-key/no-salt envs must materialize the legacy default.
- Add upgrade tests that exercise the real decrypting operation after setup, not just presence of both env variables.
- When diagnosing encrypted-state regressions, check whether the salt was newly added during setup before assuming the application verifier changed.

## Re-read live repo and PR state before drafting shared-file plans

**Rule:** When the user says the codebase has changed or PRs are still moving, inspect the current branch, worktree, and open PR queue before drafting a roadmap or editing shared planning files.

**Why:** Upgrade-testing planning was about to be written against earlier assumptions, but the repo already had open PRs touching the harness, nginx proxy behavior, and login-regression coverage. Planning against stale state creates the wrong sequencing and encourages overlapping edits on already-reviewed files.

**How to apply:**

- Run `git status --short`, `git show -s --format='%h %D %s' HEAD`, and `gh pr list --limit 20` before planning shared work.
- Re-open the exact workflow, harness, and tracker files that the plan will mention.
- Call out the current PR/file ownership map explicitly in the roadmap so later batches know what must merge or rebase first.

## Never persist broad approvals for destructive commands

**Rule:** Do not request or rely on persistent approval prefixes for destructive commands, especially `rm -rf`. Each destructive cleanup needs exact one-off permission, and broad accidental approvals must be removed immediately.

**Why:** The user corrected the workflow after a cleanup of local coverage output accidentally persisted `prefix_rule(pattern=["rm", "-rf"], decision="allow")`. That would let future Codex sessions delete arbitrary trees without a fresh permission check.

**How to apply:**

- Never pass `prefix_rule` for `rm -rf`, `git clean`, reset/checkout cleanup, or similar destructive operations.
- Prefer writing generated artifacts to ignored, task-specific temp paths that do not require cleanup during the same turn.
- If cleanup is necessary, request one-off approval for the exact path and command only.
- After a mistaken approval, remove the matching line from the local Codex rules file and verify no broad destructive rule remains.

## Treat open PRs as a managed queue before adding more PRs

**Rule:** Before opening another remediation PR, query the open PR list and classify each item as active, mergeable after local validation, needs grouped migration, or close/supersede. Track that queue in `tasks/todo.md`.

**Why:** The user corrected the workflow after the CodeQL remediation loop kept opening one PR at a time while 9 Dependabot PRs stayed open. That hides risk and makes the repo look unattended even when the current security batch is useful.

**How to apply:**

- Run `gh pr list --state open --limit 50 --json number,title,author,headRefName,mergeStateStatus,updatedAt,url` before starting a new PR-producing batch.
- Burn down existing safe PRs first when they are already open and relevant, especially Dependabot minor/patch updates.
- Handle related major dependency PRs as one deliberate migration, not as separate automatic merges.
- Only open new CodeQL remediation PRs while the queue is non-empty if the change directly unblocks a queued PR or fixes an urgent security issue.

## Use GitHub Actions as the final gate, not the iteration loop

**Rule:** Run the relevant full local gate before pushing or queueing a PR. GitHub Actions should be the protected-branch proof after local validation is already green, not the first place we discover local-reproducible coverage, build, or mutation failures.

**Why:** The user corrected the pipeline after merge-queue runs repeated the same expensive suites for small CodeQL batches. PR #89 also showed the failure mode directly: focused local tests passed, but the merge-group `Full Gateway Tests` job found a gateway coverage gap that `cd gateway && npm run test:coverage` would have caught locally. Fixing after queueing forced another long GitHub cycle.

**How to apply:**

- Before the first push for a batch, run the full local gate for the touched package: gateway coverage/build for gateway changes, server focused tests plus typecheck and critical mutation when touching critical server paths, frontend typechecks plus coverage for frontend changes.
- Push once per batch after local validation is green. Let PR checks run once, then enter merge queue once.
- If GitHub catches a failure that can be reproduced locally, add that local command to the pre-push checklist before retrying.
- Do not disable branch protection to move faster. Speed comes from local-first validation, scoped batches, and path-aware CI, while GitHub remains the final gate.

## Cancel superseded PR runs after force-pushes

**Rule:** After amending or force-pushing a PR branch, immediately cancel any still-running GitHub Actions runs for the previous head SHA before waiting on the new checks.

**Why:** During PR #127, the first pushed SHA started the same expensive PR workflows, then the branch was amended for a gitleaks false positive. Waiting on obsolete runs wasted runner time and made the new required runs look like duplicate work.

**How to apply:**

- Before force-pushing, note the current head SHA and any in-progress run IDs for the PR branch.
- After the push, run `gh run list --limit 20 --json databaseId,headBranch,headSha,status,workflowName,displayTitle,url` and identify in-progress runs whose `headSha` is no longer the PR head.
- Cancel only obsolete in-progress runs with `gh run cancel <run-id>`. Do not cancel current-head checks or merge-queue checks unless intentionally stopping the PR.
- Use single-shot `gh pr checks <number>` polling instead of long `--watch` output when discussing status with the user.

## Match DoS controls to the deployment exposure model

**Rule:** Do not turn CodeQL `missing-rate-limiting` cleanup into aggressive public-internet throttling by default. Sanctuary is usually deployed on private/self-hosted networks, so default limits should be generous safety valves; tighter ceilings belong behind an explicit public-exposure configuration or existing route-specific controls.

**Why:** The user clarified during the CodeQL rate-limit batch that the app is generally not put on the public internet. Heavy global throttles could create self-inflicted reliability issues on LAN/private deployments while adding little practical protection. The right split is exposure-aware: high-ceiling coarse guards for generic request volume, plus stricter existing controls on auth, mobile, AI, MCP, transaction, sync, and other sensitive flows.

**How to apply:**

- Classify each boundary as public internet, private/LAN, loopback/internal, or trusted service-to-service before choosing limits.
- Keep broad Express-boundary limiters coarse and private-network-friendly unless the repo has an explicit public-exposure mode.
- Preserve or strengthen route-specific limits where abuse has real security or cost impact, such as login, token refresh, wallet operations, AI calls, MCP, sync, and gateway mobile operations.
- Mount volume guards before body parsing when practical so they shed abusive request floods cheaply without changing normal private-network UX.
- Document any CodeQL-driven limiter that primarily exists because the scanner models a known package but not the repo's custom limiter.

## Pause bulk alert dismissal when confidence is questioned

**Rule:** If the user challenges whether a dismissed security alert is truly safe, stop bulk dismissal immediately and re-audit the evidence before clearing more alerts.

**Why:** During the CodeQL rate-limit cleanup, PR #100 added production boundary guards but default-branch CodeQL still reported modular router alerts. Bulk dismissal started with a false-positive rationale, then the user asked whether we were sure it was not an issue going forward. That was the right prompt to pause: even when the current production boundary is covered, the "going forward" question can surface config/docs gaps such as gateway rate-limit env var drift or multi-instance public deployment caveats.

**How to apply:**

- Stop the loop first; do not keep dismissing while answering.
- Count what was already dismissed and what remains open.
- Re-check production route mounting, middleware order, proxy/client-IP assumptions, multi-instance behavior, and operator-facing configuration names.
- Fix or document any real forward-looking gap before resuming alert closure.
- Use a short standardized dismissal comment that names the code change and the scanner limitation.

## Inspect merge-group jobs directly when queue status looks inconsistent

**Rule:** If a merge-group run is still `in_progress` but the user or GitHub UI indicates a job failed, inspect the run jobs directly with `gh run view <run-id>` or `gh run view <run-id> --json jobs`. Do not rely only on the PR-level check rollup.

**Why:** In PR #98, the PR check rollup still looked mostly green while the merge-group `Full Backend Tests` job had already failed its coverage step. The run stayed in progress because later full-lane jobs were still executing, so `gh pr view` did not make the backend failure obvious.

**How to apply:**

- When a queued PR appears stuck or suspicious, query `gh run list --limit 12` and identify the `merge_group` run.
- Use `gh run view <run-id>` to see failed/skipped/in-progress jobs even before the whole workflow completes.
- If logs are not available through `gh run view --job=<job-id> --log` while the run is still active, use the Actions job logs API for the specific job ID.
- Add the missing local gate to the branch before requeueing. For backend coverage failures, run the exact full command locally, not only changed-file pre-commit tests.

## Keep approval prefixes stable for GitHub CLI commands

**Rule:** Do not wrap `gh` commands with per-command environment prefixes such as `TMPDIR=...` unless there is a concrete failure that requires it. Prefer plain `gh pr ...`, `gh run ...`, or `gh api ...` so approval rules match stable command prefixes.

**Why:** The user corrected the workflow after repeated `TMPDIR=<project-checkout>/.tmp-gh gh ...` commands required changing approvals for each PR/check/run variant.

**How to apply:**

- First try plain `gh pr checks <number>`, `gh run list`, `gh run view <id>`, and `gh api ...`.
- If a GitHub command needs escalation for network access, request approval for the stable `gh` prefix, not a one-off environment-prefixed shell command.
- Only add `TMPDIR` when diagnosing an actual temp-directory failure, and explain why that exception is needed.

## Required branch-protection checks must emit explicit conclusions

**Rule:** If branch protection requires a check context, the workflow must create that check with an explicit success/failure conclusion on every event where merges depend on it. Do not rely on a required job being skipped.

**Why:** PR #103 had all substantive checks green, but `main` still blocked the merge because `Full Test Summary` was listed as a required status check while the job had `if: github.event_name != 'pull_request'`. GitHub showed the job as skipped, but the required context was not merge-satisfying for that pull-request shape.

**How to apply:**

- For required aggregate checks, prefer an always-running aggregator job with event-specific no-op steps where another lane is authoritative.
- Validate required contexts on the actual pull request with `gh pr checks <number>` and `gh pr view <number> --json mergeStateStatus,statusCheckRollup`, not only by reading workflow YAML.
- If a job can run for a long time, add an explicit `timeout-minutes` so a stuck runner fails visibly instead of blocking the queue indefinitely.

## GitHub feature eligibility depends on owner type, not just paid status

**Rule:** When enabling GitHub repository features, verify both account plan and repository owner type. Do not assume a paid personal account has the same feature surface as an organization-owned repository.

**Why:** The user clarified that `nekoguntai/sanctuary` is under a paid personal GitHub account. GitHub merge queue still rejected the repository-level `merge_queue` ruleset because the repository owner type is `User`; current GitHub docs limit merge queues to organization-owned repositories for the relevant public/private cases.

**How to apply:**

- Check `gh api repos/OWNER/REPO --jq '{owner:{login:.owner.login,type:.owner.type},visibility,private}'` before planning owner-type-sensitive GitHub features.
- Treat "GitHub Pro" and "organization-owned" as separate axes in docs and recommendations.
- If merge queue is desired for a personal repo, present "transfer to an eligible organization" as the concrete unlock path.

## Future-date test fixtures must be relative or time-frozen

**Rule:** When a test needs an input that must be "in the future," derive it from `Date.now()` or freeze time with fake timers. Do not use a calendar-fixed timestamp unless the test is explicitly about that calendar boundary.

**Why:** `server/tests/unit/services/adminAgentService.test.ts` used `2026-04-20T00:00:00.000Z` while asserting default creator metadata. That date passed locally before the boundary but failed in CI once UTC time reached April 20, 2026 because production code correctly rejected expired `expiresAt` values.

**How to apply:**

- For validation-neutral future values, use `new Date(Date.now() + N)` with a clear duration.
- For tests that need exact timestamps, use fake timers and restore them in cleanup.
- Before committing hard-coded dates, ask whether the date's relationship to current time matters.

## Do not reference unavailable Codex skills or slash commands

**Rule:** Before adding a workflow step that names a Codex skill or slash command, verify that it exists in the current Codex skill list. If it does not exist, describe the concrete review activity instead.

**Why:** The project workflow initially referenced `/simplify`, but Codex does not have that skill in this environment. The user corrected it and asked to remove the command. Keeping nonexistent commands in `AGENTS.md` creates false process requirements and wastes time at the end of tasks.

**How to apply:**

- Use "quality review", "edge case audit", or a specific command/test in task files instead of invented slash commands.
- Only invoke a named skill when it appears in the session's available skills list.
- If the user asks for a missing skill, state that it is unavailable and continue with the closest concrete workflow.

## E2E test fixtures must not collide with assertion selectors

**Rule:** When adding a required form field value in a Playwright test, choose a value that does NOT contain the substring used by later `getByText(...)` assertions in the same flow. Or anchor the assertion with `{ exact: true }` / a precise locator from the start.

**Why:** In `e2e/admin-operations.spec.ts` (commit `0883ea2a`), filling the new required email as `newuser@example.com` made the post-create assertion `getByText('newuser')` resolve to two elements — the username cell `<p>newuser</p>` AND the email cell `<p>newuser@example.com</p>` — triggering a Playwright strict-mode violation. Cost two CI cycles to discover and fix.

**How to apply:**

- Before adding a fixture value, grep the same test for `getByText('<value>'...)` substring matchers.
- If the cell that displays the username and the cell that displays the email are siblings, prefer username `foo` + email `f@example.com` (no shared substring), OR use `{ exact: true }` on the username assertion.
- More broadly: `getByText('shortString')` is fragile — prefer `{ exact: true }` or `getByRole(...)` whenever the substring could plausibly appear in a sibling element.

## Frontend tests must not fire real ApiClient calls with retry timers

**Rule:** Any hook that calls `apiClient.*` on mount needs to be globally stubbed in `tests/setup.ts` (or per-file mocked) for component tests that mount it transitively. Don't rely on `global.fetch = vi.fn()` — ApiClient catches the rejection and retries with `setTimeout`, generating console.warn output after the test body returns.

**Why:** `useIntelligenceStatus` (called by `useAppCapabilities`, used by `Layout`) was unmocked. Each Layout-mounting test triggered four `setTimeout`-backed retries that emitted `console.warn` after the test ended. Under CI parallelism these late events raced vitest's `onUserConsoleLog` flush at worker teardown and surfaced as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` in `Layout.test.tsx`. Locally it never reproduced. Fixed in commit `680192ca` by stubbing `getIntelligenceStatus` in `tests/setup.ts` (with `vi.unmock` in `tests/api/intelligence.test.ts` to preserve the API test).

**How to apply:**

- New hook that fires on mount and hits the network → mock it (or its API module) in `tests/setup.ts` with `vi.importActual` + targeted override.
- Per-file `vi.mock` calls override setup mocks (they're hoisted), so dedicated hook/api tests still work.
- Symptom check: if CI shows `Closing rpc while "onUserConsoleLog" was pending` or unexplained vitest worker teardown errors, look for unmocked retry-capable API calls in components rendered by the affected test file.

## Refresh-on-401 exempt list: only credential-presentation endpoints

**Rule:** When implementing a refresh-on-401 interceptor, the exempt list (endpoints that DO NOT trigger refresh on a 401) must contain ONLY endpoints where the credential being presented IS the thing being authenticated — never general-purpose endpoints that just happen to be in the auth namespace. Specifically: `/auth/login`, `/auth/register`, `/auth/2fa/verify`, `/auth/refresh`. Endpoints like `/auth/me`, `/auth/logout`, and `/auth/logout-all` MUST refresh on 401 because they represent ongoing-session operations where a stale access token + valid refresh cookie should recover the session, not force a re-login.

**Why:** Phase 4 of the cookie auth migration originally exempted `/auth/me`, `/auth/logout`, and `/auth/logout-all` from the refresh interceptor as "auth identity-boundary endpoints." Codex stop-time review caught the consequence: any user with an expired access token but still-valid refresh cookie would be force-logged-out on every page reload, because the boot probe `/auth/me` returned 401 and the interceptor was exempted from triggering refresh. The whole point of the migration was to make session expiry invisible — this regression undid it. Fixed in commit `<next>` by trimming the exempt list to only the four credential-presentation endpoints. `/auth/me` boot recovery now refreshes + retries when there is a valid refresh cookie. `/auth/logout` refreshes + retries so the server-side session is actually revoked even when the access token has already expired client-side.

**How to apply:**

- For each endpoint you consider exempting, ask: "is the credential being presented here the THING being authenticated?" (login = yes, refresh = yes, 2FA verify = yes, register = yes — the credentials in the request body are the identity claim). If yes, exempt. If the endpoint just consumes an existing session, do NOT exempt — it should benefit from refresh-on-401.
- Specifically: do not exempt `/auth/me`, `/auth/logout`, `/auth/logout-all`, or any other "do something with my existing session" endpoint.
- Test the exempt-list behavior with a regression test that asserts 401 → refresh + retry → success on a non-exempt endpoint that has overlap with the exempt names (e.g., `/auth/me`).
- The general principle beyond auth: an interceptor's "skip" rule and the operation's actual semantics must align. Skipping the interceptor for an endpoint that would benefit from it is silently breaking the user-visible flow.

## Pre-attached message handlers and welcome-message synchronization for async-auth WebSockets

**Rule:** When a WebSocket server authenticates connections asynchronously after the upgrade handshake (e.g., via cookie verification), the message handler must either be attached synchronously OR the client must wait for an explicit "I am ready" message from the server before sending any subscriptions. Sending immediately on `onopen` races the server's async auth and the messages are silently dropped.

**Why:** Phase 4 frontend rewrote `useWebSocket` to call `connect()` with no token, relying on Phase 3's same-origin cookie auth on the upgrade request. But the existing `services/websocket.ts` `onopen` handler took the "no token" branch and resubscribed immediately. Server-side, `authenticateOnUpgrade` runs `verifyWebSocketAccessToken` async (because verifyToken hits the token revocation list), and the message handler is only attached at the END of `completeClientRegistration`, AFTER auth completes. Client subscribe messages sent on `onopen` arrived at a socket with no message handler and were silently dropped. Fixed in commit `<next>` by moving the resubscribe trigger from `onopen` to the server's `'connected'` welcome message handler in `services/websocket.ts`. The welcome is sent at the end of `completeClientRegistration` — i.e., AFTER the message handler is attached — so resubscribing in response to it is race-free. The legacy `'authenticated'` message path (from the auth-message-after-connect flow) is preserved as a no-op log for diagnostic purposes; the perf benchmark scripts that still use sendAuthMessage now also rely on the `'connected'` welcome for resubscription.

**Follow-up (same root cause):** The first fix moved only the initial resubscribe behind the welcome, but ad-hoc `subscribe()`/`unsubscribe()`/`subscribeBatch()`/`unsubscribeBatch()` calls between `onopen` and the welcome were still gated on `ws.readyState === WebSocket.OPEN`. Any caller that hit that window (e.g., a hook mounting and subscribing while the cookie auth promise was still resolving) sent a message into the same pre-handler void and was silently dropped. Codex stop-time review caught it. Fixed in commit `<next>` by adding a private `isServerReady` boolean that flips true only in the `'connected'` handler, resets false in `connect()` and `onclose`, and gates all four mutator methods. `readyState === OPEN` is no longer sufficient anywhere in the class — `isServerReady` is the single authoritative signal. Regression tests subscribe after `simulateOpen()` and confirm no message is sent until the welcome arrives.

**Follow-up 2 (disconnect + async close race):** Relying on `onclose` alone to reset `isServerReady` was itself a race. `disconnect()` calls `ws.close()` and synchronously sets `this.ws = null`, but browsers deliver the close event asynchronously — so between those two lines and the actual close-event delivery, there is a window where `this.ws === null` AND `this.isServerReady === true`. A mutator called in that window would pass the ready gate and then crash inside `send()` on `this.ws!.send(...)`. Codex stop-time review caught it. Fixed by setting `this.isServerReady = false` synchronously at the top of `disconnect()` before touching `this.ws`. Regression test stubs `ws.close` to a no-op to model async close-event delivery and asserts that all four mutators are no-ops after `disconnect()`. **General rule:** when a state flag and a resource handle must stay consistent, reset them together synchronously on the shutdown path; do not rely on async lifecycle callbacks to close the window for you.

**How to apply:**

- Any time the server authenticates on connection asynchronously, either attach the message handler synchronously and queue subscriptions until auth completes, OR have the client wait for an explicit "ready" signal.
- The "ready" signal pattern is simpler: the server sends a welcome message at the moment it has fully wired up the connection (handler attached, auth done, user tracking complete). The client treats receipt of this message as the only valid trigger for sending state-changing messages.
- Do NOT rely on `onopen` as the moment to start sending — `onopen` only means the WebSocket handshake completed, not that the server is logically ready to receive messages.
- Add a regression test that simulates the welcome message and asserts subscriptions are sent in response to it, NOT in response to `simulateOpen()`.
- The general principle beyond WebSockets: any protocol where one side does work after the connection is established needs an explicit "ready" signal before the other side can act. Don't assume "connected" means "ready to talk."

## Don't evict credentials on server-side failures — only on terminal auth failures

**Rule:** When a route fails, ask: "was the client's credential actually the problem, or was the server the problem?" Only evict the client's credentials (clear cookies, force logout, invalidate session) on the former. For transient server errors — database hiccups, service bugs, upstream timeouts — leave the credentials alone so the client can retry.

**Why:** Fixing one Codex-flagged divergence (refresh failure should clear cookies) on commit `1f631091`, I over-corrected and added `clearAuthCookies(res)` to the `rotateRefreshToken` service-failure 500 path as well. Codex caught it on the next review: at that point the refresh token has ALREADY been verified (JWT signature OK, not revoked, user exists), so rotation returning null is a transient server error, not a terminal auth failure. Clearing the cookies would punish the client for a server bug — the client would have no credentials left to retry with, even though their session is fine. Fixed in commit `<next>` by removing the `clearAuthCookies` call from that one branch and adding a regression test that sends the three cookies, triggers the rotation-null path, and asserts the response has no clearing Set-Cookie entries for those names.

**How to apply:**

- Draw a line between "terminal auth failure" (credential is bad, no retry will fix it) and "transient server failure" (server hiccup, same credential would succeed next call). Clear cookies only on the first kind.
  - Terminal: invalid/expired/revoked token, deleted user, permission denied, user disabled.
  - Transient: rotation service bug, DB connection drop, upstream 502, rate-limit retry-after, unknown 500.
- When adding cookie-clearing logic, enumerate the failure paths explicitly and tag each one as terminal or transient before the code gets written.
- Add a regression test for the **transient** path that asserts the Set-Cookie header does NOT contain clearings for the auth cookie names. The happy-path and terminal-path tests cover the other directions.
- The general principle beyond cookies: on a server bug, leave client state alone and return an error the client can retry. Never let a server bug become a user-facing logout.

## Implementations must match the ADR they claim to implement, not the implementer's intuition

**Rule:** When implementing a phase of a plan documented in an ADR, grep the ADR for every stated invariant (precedence rules, failure behaviors, required tests, specific header/cookie attribute values) and verify each one against the code. Do not substitute a "sensible equivalent" from an unrelated part of the system.

**Why:** Phase 2 of the cookie auth migration set `POST /auth/refresh` to "body wins when both body and cookie are present," justified as "mirrors auth middleware header-over-cookie precedence." But ADR 0002 migration plan item 2 and required test spec both say the OPPOSITE: "both present uses the cookie." I conflated two different precedence rules — the auth middleware's header-over-cookie rule (mobile's active path wins over browser's passive path) with refresh token source selection (browser's modern path should win over legacy body). The same commit also omitted clearing the browser auth cookies on terminal refresh failure, which ADR 0002 explicitly required ("refresh clears cookies on failure (revoked refresh token)"). Both divergences were caught by Codex stop-time review before the commit went out — but they would have produced browser clients looping 401s on stale refresh cookies in production. Fixed in commit `<next>`: cookie-wins precedence, clearAuthCookies called before throwing UnauthorizedError on all three terminal-failure branches, tests added for each.

**How to apply:**

- Before writing a phase, open the ADR and make a checklist of every stated invariant. Treat each one as a required test and a required implementation behavior.
- "Mirrors the other half of the system" is only a valid justification if the ADR explicitly says so. Otherwise trust the ADR — it was written with the full context in mind.
- Cross-check the "Required tests" section of the ADR before adding tests. If the test spec says "both present uses the cookie" and your test asserts body-wins, the test is wrong and the code is wrong.
- Failure paths are as important as happy paths. Ask: "on terminal failure of this operation, what state should the client be left in?" If the answer is "the same stale state that caused the failure," that's a bug.
- Add a regression test for the ADR invariant, phrased in the same terms the ADR uses, so the linkage is obvious in the test file.

## Cross-cutting middleware skip rules must mirror the source-selection of the middleware they shadow

**Rule:** When a security control (CSRF, audit, rate limiting) decides whether to enforce based on "did the request authenticate via path X?", the skip rule must use the **same source-selection logic** as the auth middleware whose decision it shadows. Do not duplicate the logic with a "looks like" check; import and call the actual selector function.

**Why:** In Phase 1 of the cookie auth migration (commit `6cb4ddf0`), `middleware/csrf.ts` originally skipped CSRF when `!req.cookies?.sanctuary_access` — i.e., "if no cookie, skip." The auth middleware uses `extractTokenFromHeader(req.headers.authorization) || req.cookies?.sanctuary_access`, with the header winning. During the Phase 2-6 rollback window, a browser client that persisted the legacy bearer token in `localStorage` would send BOTH an `Authorization: Bearer ...` header AND have the new `sanctuary_access` cookie auto-attached by the browser. The auth middleware uses the header (per its precedence rule), but the CSRF middleware sees the cookie and tries to enforce — and the legacy client has no `X-CSRF-Token` because it's in legacy mode. Result: 403 on a request that's supposed to be the safety net for rolling back. Codex stop-time review caught it. Fix in commit `<next>`: import `extractTokenFromHeader` into `csrf.ts` and call it inside `skipCsrfProtection` so the skip rule mirrors the auth rule exactly. Also covered the inverse: malformed Authorization headers (`Basic ...`, `Bearer ` with no token) make `extractTokenFromHeader` return null, so the auth middleware falls back to the cookie and CSRF must enforce.

**How to apply:**

- Whenever you write a skip rule for a cross-cutting middleware, identify which middleware's decision you are shadowing. Import and call its source-selection function directly.
- The check must be `if (otherMiddlewareWillUseHeader) skip` not `if (headerLooksPresent) skip`. Header presence and "header was actually used" are different things.

## Check live origin policy before blaming auth when browser login starts returning 500

**Rule:** When browser login or refresh suddenly returns `500`, inspect live backend logs for CORS/origin rejection before assuming the auth route, cookie path, or CSRF path regressed. If the origin policy rejects the browser, surface it as a real `403`-class error and verify the deployment's `CLIENT_URL` / `CORS_ALLOWED_ORIGINS` values against the actual browser origin.

**Why:** The 2026-04-23 login outage looked like `/api/v1/auth/login` and `/api/v1/auth/refresh` were throwing server errors, but backend logs showed `middleware/corsOrigin` rejecting the browser origin with `Error: Not allowed by CORS`. Because the guard threw a plain `Error`, the centralized error handler translated the deployment misconfiguration into a misleading `500`. The same investigation also exposed that the operator `scripts/support-package.sh` helper had drifted from the backend container's compiled path layout, which slowed diagnosis when UI login was already unavailable.

**How to apply:**

- For browser login incidents, pull live backend logs first and grep for `Not allowed by CORS`, `Origin`, and auth route paths before chasing auth internals.
- Compare the actual browser origin (`scheme://host:port`) to `CLIENT_URL` and any `CORS_ALLOWED_ORIGINS` entries exactly; CORS matching is strict and scheme/port differences matter.
- Use an `ApiError` subclass for policy rejections that should map to a non-500 client response.
- For operator scripts that execute built code inside a container, resolve the module path against the container build layout, not the repo-local `dist` layout.
- Add a regression test that combines the two sources and verifies the right one wins. The test must construct the contended state (header + cookie + no CSRF token) and assert success.
- Add the inverse test: malformed header that would not authenticate, plus cookie, plus no CSRF token → must enforce CSRF (403).
- Generalizes to: audit logging that tags requests as "authenticated via header" vs "authenticated via cookie," rate limiting that scopes per source, request logging that marks the auth source. All must use the same selector.

## Pub/sub is not mutual exclusion

**Rule:** When a design needs cross-tab or cross-process serialization, use a real mutex primitive (Web Locks API, OS file lock, Redis SETNX with TTL, etc.). Do not use BroadcastChannel, postMessage, EventEmitter, or any other pub/sub mechanism as a coordination primitive. Pub/sub gives you "tell everyone this happened" — it does not give you "exactly one party gets to act."

**Why:** In ADR 0002 (frontend refresh flow), the original draft used BroadcastChannel as the cross-tab coordination primitive: "tab A broadcasts `refresh-start`, other tabs see this and skip their own refresh." Codex review caught the race: BroadcastChannel is asynchronous, and tab B can decide to refresh in the same instant as tab A before tab A's broadcast is delivered. Both tabs send `POST /auth/refresh` with the same refresh token, the server rotates the token on tab A's request, and tab B's request sees the now-invalidated token and returns 401 — logging tab B out even though auth state is fine. The fix was to switch to `navigator.locks.request(name, { mode: 'exclusive' }, callback)`, which is a real OS-level mutex with browser-guaranteed mutual exclusion across same-origin tabs.

**How to apply:**

- When reviewing a coordination design, ask: "what guarantees that exactly one party acts?" If the answer is "the broadcast arrives in time," that is not a guarantee — that is a hope. Reject the design.
- Web Locks API has 95.5% global support (caniuse 2024) and works in all evergreen browsers. Default to it for cross-tab serialization in browser code. Polyfill or vitest-mock with a Map of held lock names + FIFO waiters (~30 lines).
- BroadcastChannel still has a role: state propagation after the mutex-protected work has completed. "Tab A finished refreshing, here is the new expiry." That is fine because it is a hint, not a coordination signal.
- For server-side cross-process coordination, the same rule applies: Redis SETNX + TTL or a real distributed lock, not pub/sub.
- The "no cutting corners" feedback from the user applied: the original Option C (BroadcastChannel-only) was demoted from RECOMMENDED to REJECTED because correctness is not negotiable, and Option E (Web Locks + BroadcastChannel) was promoted because it is the only option that actually serializes.

## Pre-existing CLAUDE.md rules referenced

- "When fixing CI failures, check ALL test files and workflow files for the same issue pattern before committing. Do not fix one file at a time and re-push — batch all related fixes together." — would have caught this if I'd grepped for `getByText('newuser'` after picking the email value.

## Do not rely on shell-prefixed env vars for repeatable local test lanes

**Rule:** For recurring local test lanes, put default ports and test-only environment constants in a sourced helper file or script-owned defaults. Do not require operators or future Codex runs to remember `VAR=value command` prefixes for safety-critical isolation.

**Why:** While validating upgrade fixtures with a local Sanctuary instance already running on `8443`/`4000`, I invoked the legacy-runtime upgrade lane with only `GATEWAY_PORT=4400` in front of the command. The harness fell back to `HTTPS_PORT=8443`, collided with the user's live local instance, and had to be stopped as a test-only compose project. The real fix is to make the harness default to disposable upgrade-test ports (`9443`/`9080`/`4400`) and reserve inline env prefixes for exceptional overrides.

**How to apply:**

- If a test lane needs non-production-local ports to be safe, make those ports the lane's defaults.
- Keep per-lane constants in one helper, then source it from the harness and unit tests.
- Local docs should show ordinary commands first. Put env overrides in an "only when needed" section.
- When a user corrects command style, patch the harness or docs so the corrected behavior becomes automatic rather than a memory burden.

## Completed task logs must not keep live-task markers

**Rule:** After a PR, release, or cleanup task is merged and verified, update `tasks/todo.md` in the same cleanup pass: change `Active Task` to `Completed Task`, mark delivery checkboxes complete, and remove or annotate stale "pending" language.

**Why:** I reported that stash cleanup was done while `tasks/todo.md` still had historical sections labeled active and old unchecked delivery items. That made the task tracker look like there was live work even though the referenced PRs and fixes had already merged.

**How to apply:**

- Before answering "next steps," run `rg -n "Status: in progress|^- \\[ \\]|Active Task|pending|awaiting" tasks/todo.md` and classify each hit.
- If a referenced PR has merged, record the PR number/merge evidence and mark the task complete instead of leaving a stale checkbox.
- Keep genuine backlog as prose or a fresh task, not as old phase checkboxes from already-implemented plans.

## Valid follow-up notes need explicit backlog shape

**Rule:** When completed task reviews still contain valid follow-up ideas, promote them into one explicit backlog section with scope, guardrails, verification, and start conditions instead of leaving them buried as scattered "next" prose.

**Why:** I cleaned stale task markers but initially left useful CI and test-debt follow-ups only inside old review notes. That made it hard to tell which ideas were current work candidates and which were historical context.

**How to apply:**

- Re-scan `tasks/todo.md` for `follow-up`, `next target`, `residual`, `future work`, and unchecked boxes after stale cleanup.
- Promote still-valid items to a top-level backlog with concrete exit criteria and source-aware constraints.
- Mark resolved or blocked items as historical or conditional so they do not look like active work.

## Provider-security copy must match the active trust boundary

**Rule:** When AI provider support includes external or LAN OpenAI-compatible endpoints, do not describe "AI" as isolated unless the statement is specifically about Sanctuary's proxy/backend boundary. UI copy must state that external providers can run outside Sanctuary and receive sanitized metadata.

**Why:** I left the AI Settings status notice saying "AI runs in a separate container" after adding LM Studio/OpenAI-compatible support. That is only accurate for the proxy/bundled local path, and it can mislead admins testing an external provider.

**How to apply:**

- Phrase the invariant as "Sanctuary's AI proxy/data boundary is isolated from keys, signing, and the database."
- For external-provider modes, explicitly mention that the configured provider may run outside Sanctuary and should be trusted.
- Keep the sanitized-data guarantee precise: no private keys, no signing operations, no database access, and no addresses/transaction IDs sent to the model.

## Local provider setup must not inherit hosted-provider requirements

**Rule:** For local/LAN AI providers such as LM Studio, keep endpoint/profile save separate from model selection and credential entry. API keys and detected models are optional during provider setup; model-required actions should be gated only where a model is actually needed.

**Why:** After adding OpenAI-compatible support, the backend/profile model allowed empty credentials, but the Settings tab still disabled Save Configuration until `aiModel` was non-empty. That made a no-key LM Studio endpoint look like it required an API key or model selection before the profile could be saved.

**How to apply:**

- Validate Save Configuration against the minimum persisted profile fields, not downstream inference fields.
- Use provider-aware Detect for typed LAN endpoints and surface real connection/listing errors instead of collapsing them into an empty model list.
- Keep Test Connection and AI feature execution gated on endpoint + model because those paths actually call the model.
- Add regression coverage for no-key/no-model local provider saves and concrete RFC1918 LM Studio endpoints.

## Preserve view-local AI when it mutates useful view state

**Rule:** Do not collapse a view-local AI control into the global Console when the local control owns useful page state, such as filtering, sorting, or aggregating the transaction table. If Console later affects that view, it should reuse the same structured state contract instead of replacing the local control.

**Why:** The wallet AI search looked redundant once Sanctuary Console existed, but its important job is translating a natural-language prompt into `NaturalQueryResult` and applying that result to the transactions table. Removing it would lose a direct table-refinement workflow.

**How to apply:**

- Identify whether an AI entry point only chats or whether it changes local UI state before suggesting removal.
- Keep one canonical structured contract for shared behavior; Console can dispatch an `apply transaction filter` action later, backed by the same filter shape.
- Ensure clearing the local control clears the view state it created.

## Passive AI status checks must not run model inference

**Rule:** `/ai/status` and app-load capability probes must report persisted setup state plus Sanctuary proxy reachability only. Real provider/model probes belong behind explicit user actions such as Test Connection or an active Console/query request.

**Why:** A passive status check called `checkHealth()`, which synced config and sent a real test prompt to LM Studio. On large local models, simply opening the app could compete with or queue behind a Console planner request, then collapse the Console error into a generic "AI endpoint not available" failure.

**How to apply:**

- Keep status endpoints cheap and non-inferential.
- Put model calls behind explicit routes with clear UI intent and longer, provider-appropriate timeouts.
- Return structured upstream timeout/status details from proxy calls so local-provider failures are diagnosable.

## Align every timeout in long-running AI paths

**Rule:** When extending a local-model path for slower providers, update every timeout layer together: browser client, Express request timeout middleware, backend-to-proxy fetch, and proxy-to-provider fetch.

**Why:** I extended the Console client/proxy/gateway timeouts but missed the global Express request timeout. The Console replay completed planning and tool execution, but the HTTP request was cut off at 30 seconds and returned 408 just before synthesis completed.

**How to apply:**

- Grep for route timeout middleware whenever a UI/API call gets a longer client timeout.
- Add route-specific timeout tests for both direct turn submission and replay routes.
- Check live logs for `MW:TIMEOUT` before assuming an upstream model failure.

## Console planner output needs deterministic recovery

**Rule:** Treat local-model Console planner output as advisory and potentially malformed. Recover JSON from extra reasoning/prose, and add narrow deterministic fallback plans for obvious selected-scope read requests.

**Why:** A wallet-scoped prompt asking for transactions returned `model_response_not_json`, so the backend synthesized an answer with no tool results instead of querying the selected wallet.

**How to apply:**

- Parse for valid structured plan objects inside reasoning/code-fence output before declaring planner failure.
- When scope is explicit and the intent maps cleanly to one read-only tool, generate a fallback call that uses the selected scope ID rather than trusting prompt text.
- Keep fallback narrow and covered by tests so the Console does not invent broad or write-capable actions.

## Reasoning-model responses can omit assistant content

**Rule:** For structured planner calls to local OpenAI-compatible reasoning models, support `message.reasoning_content` as a recoverable raw planner response when `message.content` is empty. Do not enable that fallback for normal answer synthesis.

**Why:** LM Studio returned HTTP 200 with `message.content: ""`, `message.reasoning_content`, and `finish_reason: "length"` for a Console planner request. The proxy rejected the response before the planner parser/fallback could recover a safe tool plan.

**How to apply:**

- Keep reasoning-content fallback opt-in per call site.
- Enable it for bounded structured planning where downstream validation/fallback still owns the tool call.
- Leave it disabled for user-facing synthesis so hidden reasoning is not shown as a final answer.

## Prompt-history dedupe must cover retries

**Rule:** When adding Console history compression, apply dedupe to both the dialogue transcript and the saved prompt-history list. Retries/replays should not appear as repeated prompt-history rows.

**Why:** The dialogue history hid duplicate retries, but the prompt-history list still showed each retry as a separate past prompt.

**How to apply:**

- Dedupe prompt history by normalized prompt, selected scope, and sensitivity.
- Keep the newest matching prompt visible so replay/delete actions target the current prompt record.
- Add focused utility/component coverage for repeated retry prompt history.

## Share AI planning contracts across entry points

**Rule:** When two AI entry points are trying to infer the same user intent, route them through the same structured planning contract and add only a thin adapter for view-specific state.

**Why:** The transaction-page AI search kept using an older natural-query JSON prompt while Console used the newer `query_transactions` planner path. That drift caused the inline search to miss the same date-range behavior that already worked in Console.

**How to apply:**

- Prefer shared tool-call shapes such as `query_transactions` over parallel prompts with similar semantics.
- Keep view-specific adapters small and explicit, for example adapting a planned transaction query into a table filter.
- Make deterministic fallback evaluate only the user's original prompt, not injected labels, tool descriptions, or other planner context.

## Forward cookie-auth tokens on backend-mediated AI calls

**Rule:** Any backend route that forwards user-scoped AI work to the AI proxy must use the same access-token extraction path as `authenticate`, including both bearer headers and the `sanctuary_access` HttpOnly cookie.

**Why:** Browser-authenticated transaction AI search reached `/api/v1/ai/query` successfully, but the route forwarded only `Authorization` header tokens to the AI proxy. Cookie-authenticated sessions sent an empty bearer to `/internal/ai/wallet/:id/context`, causing 401s and a generic UI failure.

**How to apply:**

- Reuse the exported auth token extractor instead of hand-parsing `req.headers.authorization`.
- Cover both bearer and cookie-auth paths in API tests when a route proxies user-scoped internal data.
- Check internal endpoint logs for `userId=null` before blaming the external model provider.

## Disabled Network Sync Needs UI Control And Specific Errors

**Rule:** If a wallet feature can create testnet or signet wallets, the UI must expose the matching network sync enablement and sync failures must say when that network is off.

**Why:** Testnet wallet sync retried three times against an incomplete Electrum fallback because the node config had testnet disabled. The user had no obvious UI control to enable it and the failure did not say sync was off.

**How to apply:**

- Add explicit per-network sync toggles anywhere network-specific sync config is editable.
- Treat disabled network config as non-retryable, not as an Electrum transient.
- Surface the disabled-network message in both immediate sync feedback and persisted wallet failure status.

## API Schema Nullability Must Match Mappers

**Rule:** When an API schema accepts `null`, every downstream mapper/parser type and branch must treat `null` as a first-class value, not just `undefined`.

**Why:** The node-config PUT schema accepted nullable per-network fields from the UI, but the persistence mapper still called `.toString()` on nullable numeric fields. Turning on Testnet Sync with unchanged nullable connection fields returned "Failed to save node configuration."

**How to apply:**

- Define shared nullable input aliases for route mappers when the Zod schema allows null.
- Add route tests that send the UI's saved payload shape, including nullable optional fields.
- Prefer mapper-level defaulting for absent/null config values so frontend forms and persisted records stay compatible.

## Dashboard Network Tabs Must Be Network-Aware End To End

**Rule:** When a dashboard exposes selectable Bitcoin networks, route the selected network through query keys, API parameters, backend status resolvers, and empty/configured UI states together.

**Why:** The dashboard Testnet tab still called the mainnet `/bitcoin/status` path and hardcoded non-mainnet panels as "not configured." That made configured Testnet/Signet Electrum settings look absent, hid configured server rows, and sent the Node Config action to a stale route.

**How to apply:**

- Include selected network values in React Query keys and status API calls.
- Make backend status endpoints validate the requested network and resolve per-network node configuration.
- Test configured non-mainnet dashboard states and navigation targets alongside disabled/error states.

## Security Assessment Must Include Remote Alert Sources

**Rule:** Before calling a security task list complete, check local scans and the repository's open GitHub security alerts: CodeQL/code scanning, Dependabot, and secret scanning where available.

**Why:** A local npm audit/security assessment missed the user's three GitHub findings: two CodeQL alerts and one Dependabot vulnerability.

**How to apply:**

- Query `gh api repos/<owner>/<repo>/code-scanning/alerts?state=open` and `gh api repos/<owner>/<repo>/dependabot/alerts?state=open`.
- Record alert numbers, severities, locations, and links in the security assessment.
- Treat local tool output and GitHub's alert state as complementary; neither replaces the other.

## Destructive Cleanup Requires Explicit Scope

**Rule:** Before running commands or tests that delete files, state the exact cleanup scope and get permission unless the cleanup is limited to a self-created temporary directory the user has already approved.

**Why:** The offline installer work involved scripts and tests with `rm -rf` cleanup. The user explicitly corrected the workflow to ask before deleting anything.

**How to apply:**

- Prefer `mktemp`-scoped cleanup for tests and generated staging directories.
- Do not run broad cleanup commands or remove repo files without a fresh, one-off permission.
- Mention self-temp cleanup before running tests that create and remove their own temporary directories.

## Re-poll Before Declaring CI Stable

**Rule:** When Forgejo checks are still queued or a manual run is pending, do not describe the branch as stable from an earlier poll. Re-poll immediately before answering and name any remaining queued, running, or failed job.

**Why:** A later manual install run failed `Install Stack Smoke` after the previous poll showed no failures. Saying there were no failures was stale within minutes.

**How to apply:**

- Treat queued manual runs as unresolved until their final task list is checked.
- Separate required PR checks from optional/manual full-lane checks in status updates.
- If the user says the UI still shows a failure, trust that signal first and refresh the task list before explaining.

## Normalize Forgejo Concurrency By Branch

**Rule:** Core Forgejo workflows that share a runner workspace must use the same concurrency key for pull request, manual, and push runs on the same branch or ref.

**Why:** A manual install `all` run and the automatic pull-request install run used different keys (`PR number` versus branch ref), so they overlapped on the same runner workspace and the manual fresh install failed before the E2E body could run.

**How to apply:**

- Prefer `github.event.pull_request.head.ref || github.ref_name || github.ref` for branch-scoped workflow concurrency on this runner.
- Dispatch manual reruns only after confirming any older run on the same head has either completed or is queued behind the same key.
- Treat very fast Docker E2E failures during checkout/setup as runner-workspace races until timing proves the test body ran.

## Do Not Trust Forgejo Matrix Serialization

**Rule:** Docker-backed install or upgrade lanes that must run one at a time should be written as explicit sequential steps or jobs, not as a matrix relying on `max-parallel: 1`.

**Why:** The manual install `all` run started both upgrade-baseline matrix cells at the same second and both failed before the upgrade body could run. The workflow declared `max-parallel: 1`, but Forgejo still scheduled the matrix cells together.

**How to apply:**

- Use one job with sequential fixture steps for shared Docker/checkout install lanes.
- Keep a cleanup trap inside each fixture step so a failed fixture does not leave its compose project running.
- Reserve matrices for fast, isolated checks where simultaneous workspace access is harmless.

## Avoid Chmod Mutations In Shared Checkouts

**Rule:** CI jobs using `actions/checkout` with `clean: false` must not run broad `chmod +x` over tracked globs. Invoke scripts with `bash` or commit the intended executable bits instead.

**Why:** Install jobs changed executable bits on tracked shell files in the shared workspace. The next manual install checkout then failed within seconds before the E2E body could run.

**How to apply:**

- Treat mode-only diffs as workspace pollution when a Forgejo job fails during setup.
- Remove chmod setup steps once scripts are executable in git or called through `bash`.
- If a workflow needs generated files executable, chmod only generated paths under ignored scratch directories.

## Keep Manual Docker E2E Setup In One Job

**Rule:** When Forgejo fails a Docker-backed manual E2E job before the test body but the same command passes in the runner image, remove unnecessary preceding jobs and run prerequisite checks inside the Docker E2E job after its checkout.

**Why:** A targeted manual fresh-install run passed determine-scope and standalone unit tests, then failed before starting the Fresh Install E2E script. The same fresh-install command passed from a clean clone in the runner image, pointing to the workflow handoff rather than product behavior.

**How to apply:**

- Keep unit scripts as a gate, but colocate them with the manual Docker E2E job when the standalone unit job is only a prerequisite.
- Re-run the targeted manual suite first before re-running the broad `all` suite.
- Treat "passes in runner image, fails before body in Forgejo" as workflow orchestration evidence, not an app regression.

## Pin Forgejo Base Ref Fetches To Forgejo

**Rule:** PR-only CI steps that fetch the base branch must set `origin` to `${{ github.server_url }}/${{ github.repository }}.git` and run with `GIT_TERMINAL_PROMPT=0` before `git fetch`.

**Why:** Mirrored Forgejo repositories can retain GitHub metadata in event payloads and checkout state. A drift-check fetch of `origin/main` can fail against GitHub even though the PR is running on Forgejo.

**How to apply:**

- Use env variables for `BASE_REF` and `REPO_URL` instead of interpolating PR fields directly in shell.
- Rewrite `origin` immediately before the fetch in jobs that need the base ref.
- Treat GitHub credential prompts or fast fetch failures on Forgejo as stale-origin bugs first.

## Adapt Legacy Upgrade Sources To Containerized Runners

**Rule:** Upgrade tests that install older source refs must adapt legacy compose files for runner-specific path translation before invoking the old install script.

**Why:** Older tags mounted `SANCTUARY_SSL_DIR` directly. Inside Forgejo's containerized runner that path is not necessarily visible to the host Docker daemon, so certs are generated in one path while the frontend container receives an empty mount and fails its HTTPS healthcheck.

**How to apply:**

- Keep generated SSL material under run-scoped test roots.
- Pass both container-local and Docker-visible SSL paths through the harness.
- Patch only disposable source worktrees; never mutate the checked-in target compose file or the released tag.

## Use Docker-Visible Browser Hosts In Upgrade Smoke

**Rule:** Upgrade browser-visible smoke tests must default to the harness' Docker-visible host, not literal `localhost`, when running inside a containerized CI runner.

**Why:** Inside the runner container, `localhost` points at the runner container itself, while the application is published by the host Docker daemon. The stack can be healthy and API checks can pass, but browser-origin smoke fails with an empty response.

**How to apply:**

- Derive baseline upgrade browser hosts from the same default-install-test-host helper used for API traffic.
- Keep `localhost` as the default only when the host helper resolves to it.
- Add fixture-default unit tests for baseline behavior, not only the special browser-origin fixture.

## Prefer Checked-Out Base SHAs For Forgejo Drift Checks

**Rule:** PR drift checks should diff against the checked-out PR base SHA when checkout already has full history, instead of performing an extra authenticated fetch in a temp clone.

**Why:** Temp clones used for container-safe architecture work do not necessarily inherit Forgejo's checkout credentials. An extra fetch can prompt or fail even though the base commit is already available from a full checkout.

**How to apply:**

- Set `fetch-depth: 0` on architecture checkout when drift detection needs the PR base.
- Pass `${{ github.event.pull_request.base.sha }}` to the drift detector.
- Avoid resetting remotes or fetching from temp clones unless the base object is genuinely missing.

## Keep CI Quality Helpers And Local Checks Aligned

**Rule:** CI quality jobs should call the same repo helper used for local verification instead of duplicating long tool invocations inline.

**Why:** The lizard gate passed locally through the helper but the workflow still owned a separate install and invocation path. Duplicated command surfaces make runner-only failures harder to reproduce and easy to fix in only one place.

**How to apply:**

- Prefer small `scripts/quality/*` entrypoints for long tool commands.
- Skip unrelated quality stages explicitly in focused helper scripts.
- Verify the helper locally before pushing workflow changes that call it.

## Keep Root-Writing CI Installs Out Of Shared Checkouts

**Rule:** Forgejo jobs that run `npm ci` inside a containerized action should install in a disposable temp clone when the runner cleanup or later jobs touch the shared checkout.

**Why:** A containerized architecture repro succeeded through dependency installation but left root-owned `node_modules` in the host-mounted clone, causing cleanup to fail with permission errors. The same ownership pattern can make a successful job report failed during teardown.

**How to apply:**

- Clone the checked-out source into a `mktemp` directory under `RUNNER_TEMP` before dependency-heavy architecture/docs work.
- Run installs, generated-graph checks, typechecks, and docs builds inside that temp clone.
- Remove only the exact temp clone in an `always()` cleanup step, and copy artifacts back to the workspace only when a later action needs them.

## Run Duplication Gates From Clean Clones

**Rule:** CI duplicate-code scans should read from a clean tracked-source clone and write reports outside the shared checkout.

**Why:** jscpd can fail or drift when a Forgejo runner checkout contains stale generated coverage/report directories from earlier jobs. Writing reports back into the checkout also adds another mutable path for later jobs to trip over.

**How to apply:**

- Use a temp clone as the scan input for jscpd and similar whole-repo source scanners.
- Put scanner reports under an exact run-scoped temp path and upload from there.
- Keep generated coverage variants such as `coverage-*` excluded from duplicate detection.

## Serialize PR Quick Browser Lanes

**Rule:** Browser-based PR quick lanes that share a checkout, Playwright output directories, build artifacts, or localhost ports must take the same runner lock as full E2E lanes.

**Why:** Quick browser smoke and quick render regression can run at the same time on Forgejo. Both install dependencies, install browsers, build the frontend, and run Playwright against the same workspace and default ports.

**How to apply:**

- Put the lock around the whole install/build/test sequence, not only the final Playwright command.
- Keep Playwright caches outside the locked section when they are restored by Actions, but do not let workspace-mutating commands overlap.
- Prefer the existing repo lock helper and workspace lock directory instead of inventing per-job ad hoc locks.

## Avoid Setup Caches In Temp-Clone Jobs

**Rule:** When a workflow installs and tests inside a disposable temp clone, do not also enable setup-node dependency caching against the outer shared checkout.

**Why:** The temp clone is the isolation boundary. A cache action tied to the mutable outer checkout can fail before the repo command body starts, which makes local command reproduction pass while Forgejo still reports the job failed.

**How to apply:**

- Keep setup-node limited to installing the requested Node version for temp-clone jobs.
- Run `npm ci` inside the temp clone, then run the actual lint/typecheck/test command there.
- Create the runner temp parent with `mkdir -p` before `mktemp` so runners with missing `RUNNER_TEMP` directories do not fail in setup.
- Give temp-clone `npm ci` calls a cache under that same temp workspace, and serialize multi-package installs when Forgejo failures are not reproducible from the command body.
- Treat temp-clone cleanup as best-effort in CI jobs; a cleanup ownership mismatch should warn, not fail a job whose gate already passed.
- Disable install-time `npm ci` audit/fund network work in CI setup steps and keep vulnerability enforcement in the dedicated audit job.
- Keep Semgrep virtualenvs and reports out of shared checkouts on Forgejo; install and upload from run-scoped temp paths just like other whole-repo quality scanners.

## Reuse One CI Workspace Isolation Primitive

**Rule:** New Forgejo workflow isolation should use the repo's shared isolated-workspace helper instead of adding another hand-rolled temp clone.

**Why:** A one-off Architecture temp clone passed locally but still failed remotely without retrievable logs. The shared helper already checks out the exact source HEAD and gives us one place to improve clone, cleanup, and failure-preservation behavior.

**How to apply:**

- Use `scripts/ci/create-isolated-workspace.sh` or `scripts/ci/run-in-isolated-workspace.sh` for workflow jobs that need clean tracked source.
- Keep named workflow steps for long gates so the failing phase is visible.
- Clean isolated workspaces after success, but preserve them on failure when remote logs are missing or incomplete.
- Add the helper path to workflow triggers when a workflow relies on it.

## Keep Quality Scanner Entry Points Shared

**Rule:** Whole-repo quality scanners should have a repo-owned script entrypoint, and workflows should invoke that script through the shared isolated-workspace helper instead of embedding scanner setup in YAML.

**Why:** The jscpd job failed remotely while the same clean-clone command passed locally, and the previous workflow still had bespoke clone/run logic. Keeping the command in `scripts/quality/jscpd-only.sh` gives local and CI runs the same scanner behavior and leaves only one workspace-isolation path to harden.

**How to apply:**

- Put scanner cache/report setup in `scripts/quality/*` scripts, not workflow heredocs.
- Run Forgejo whole-repo scanners through `scripts/ci/run-in-isolated-workspace.sh --keep-on-failure` when remote logs may be incomplete.
- Keep local aggregate scripts, such as `scripts/quality.sh`, delegating to the same scanner entrypoints used by CI.

## Retry Native Tool Crashes At CI Boundaries

**Rule:** Bounded retries are appropriate around CI setup/build commands that can crash natively in the runner container, as long as the real validation still runs and a deterministic failure remains blocking.

**Why:** Architecture passed lint, drift, graph regeneration, and typecheck, then Docusaurus exited with `139` from a native segmentation fault. The same job had already recovered from a transient `npm ci` segfault because dependency setup used a three-attempt retry loop.

**How to apply:**

- Use retries around package install and docs/build commands that depend on Node/native toolchains in Forgejo containers.
- Include generated graph commands in the same native-tool retry boundary; stale generated output still has to pass the later `git diff --exit-code` check.
- Include ESLint command boundaries in the same retry pattern when logs show a native `139` after earlier lint phases pass without findings.
- When a frontend test fails while parsing a dependency under `node_modules`, retry the whole isolated workspace command so the retry gets a fresh install instead of reusing the suspect dependency tree.
- Keep retries bounded, visible in logs, and scoped to whole idempotent commands.
- Do not retry semantic checks by weakening assertions; rerun the same command and fail after the last attempt.
- Centralize retry behavior in `scripts/ci/retry-command.sh` when more than one workflow path needs the same transient-crash handling.

## Keep Docker Upgrade Fixtures In One Runner Job

**Rule:** Long Docker-backed upgrade fixtures should run sequentially inside one job unless the runner label explicitly guarantees identical Docker access for every matrix child.

**Why:** The baseline upgrade job passed, then each extended matrix child failed before test assertions because the child context could not reach Docker. A runner lock serialized command bodies, but it could not control which runner/container context Forgejo scheduled for each matrix child.

**How to apply:**

- Use one job plus a fixture loop for install upgrade fixtures that all need the same Docker daemon.
- Preserve fixture observability with log groups and artifact directories instead of splitting into matrix jobs on a heterogeneous runner pool.
- Treat install CI helper changes as upgrade-relevant so non-PR lanes exercise the helper paths that orchestrate upgrade fixtures.

## Wait For Docker Before Install E2E Bodies

**Rule:** Docker-backed install jobs should use one shared Docker readiness helper before starting install, stack, or upgrade E2E bodies.

**Why:** A focused manual upgrade dispatch failed before assertions because Docker was not reachable at the first CLI call in the baseline job container. Immediate checks make runner endpoint startup races look like installer failures.

**How to apply:**

- Call the shared readiness helper in each Docker-backed install workflow job.
- Let the helper probe supported endpoint shapes and persist the working `DOCKER_HOST` for later workflow steps.
- Keep the timeout bounded and fail with a clear Docker-boundary error if the endpoint never appears.
- Route changes to the Docker readiness helper through install upgrade coverage, because it gates baseline and extended upgrade tests.

## Keep Install E2E Off Compose Bake

**Rule:** Install E2E workflows should prefer the direct Compose build path and leave Buildx/Bake-specific coverage to the Docker Build workflow.

**Why:** A focused upgrade run reached the legacy source install, then Buildx/Bake failed while exporting an image layer with an invalid tar header. That failure exercises runner build-cache/export behavior, not installer semantics.

**How to apply:**

- Set install workflow `COMPOSE_BAKE=false` so installer tests do not depend on Compose Bake.
- Keep Docker Build CI as the place that validates buildx behavior.
- If install E2E fails during image export rather than app assertions, inspect whether the workflow accidentally reintroduced buildx-specific behavior.

## Fix Workflow Shell Findings Instead Of Moving Baselines

**Rule:** Do not keep updating Semgrep baseline line numbers for GitHub Actions shell-injection findings. Remove the risky workflow shape.

**Why:** The install test summary used `${{ ... }}` expressions directly inside a `run:` block, so normal workflow edits churned the Semgrep source fingerprint and made the gate look like a line-number maintenance problem.

**How to apply:**

- Pass `github`, `inputs`, `matrix`, and `needs` values through step `env:` before shell code uses them.
- Quote those environment variables in shell conditions and output commands.
- Remove stale baseline entries when the workflow no longer has the finding, rather than re-fingerprinting the old pattern.

## Keep Diagnostic Artifact Uploads Non-Blocking

**Rule:** Quality scanner report uploads should help diagnosis, not decide pass/fail after the scanner command has already enforced the gate.

**Why:** A Forgejo Code Quality run passed the earlier quality stages, then the jscpd job failed remotely while the same direct and isolated jscpd commands passed locally. The report upload sits after the real scanner gate and depends on the artifact service rather than repository correctness.

**How to apply:**

- Keep scanner commands blocking and unchanged; retry the whole scanner command only at an idempotent command boundary.
- Mark diagnostic artifact upload steps `continue-on-error: true` so report service failures do not fail Code Quality.
- Keep cleanup in `always()` steps so report paths do not accumulate on successful runs.

## Bound Quick E2E Lock Waits

**Rule:** Quick E2E jobs that acquire the shared runner lock need explicit job timeouts and a shorter lock wait than long full-suite/install jobs.

**Why:** A stale prior-head Test Suite run sat in Quick Browser Smoke long enough to block newer PR-head workflows. Without a job timeout, lock contention or a stuck browser setup can look like no progress instead of a bounded failure.

**How to apply:**

- Add `timeout-minutes` to quick browser/render jobs, not only the full E2E jobs.
- Set `SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS` for quick E2E jobs so lock contention fails with a clear boundary.
- Keep longer lock waits only for intentionally long install/upgrade paths that have their own job timeout.

## Scope Workflow Concurrency By Workflow

**Rule:** PR workflow concurrency groups should include the workflow name and cancel obsolete pull-request runs.

**Why:** A stale Test Suite run blocked unrelated Architecture, Docker Build, Install Tests, and Code Quality workflows because they all shared one branch-wide group with `cancel-in-progress: false`.

**How to apply:**

- Use `${{ github.workflow }}` in concurrency groups for independent workflows.
- Include `${{ github.event_name }}` when manual dispatches should not be canceled by PR updates.
- Use `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` so new PR pushes replace obsolete runs of the same workflow.

## Retry Semgrep Infrastructure, Not Findings

**Rule:** Semgrep CI retries should cover installation and scan infrastructure errors, while the baseline comparison remains the deterministic gate.

**Why:** Local Semgrep plus baseline passed with the current tree while Forgejo failed the Semgrep job before later quality stages. The likely failure class is registry/package/runner execution, not a new repository finding.

**How to apply:**

- Use the shared retry helper for Semgrep package installation.
- Retry `semgrep scan` only when Semgrep exits with an infrastructure status greater than `1`.
- Run `check-semgrep-baseline.mjs` once after a usable report is produced; do not retry or soften new/stale finding failures.

## Preserve Remote Evidence For Opaque Quick Jobs

**Rule:** When Forgejo only exposes job-level failure through the API, quick isolated-workspace jobs should preserve failed workspaces until the root cause is known.

**Why:** Quick Frontend passed locally with the same detected file list, but the remote job failed without API-accessible step logs. Deleting the isolated workspace on failure removed the most useful remaining evidence.

**How to apply:**

- Use `scripts/ci/run-in-isolated-workspace.sh --keep-on-failure` on opaque quick jobs while debugging remote-only failures.
- Keep the normal success cleanup path so passing jobs do not accumulate workspaces.
- Remove the preservation flag later only after the remote failure mode is understood and covered.

## Do Not Let Browser Cache Restore Gate E2E

**Rule:** Playwright browser cache restore is an optimization and should not be a blocking E2E gate.

**Why:** Quick Browser Smoke failed within seconds after Quick Frontend passed, before the browser install/build/test body could plausibly run. The cache restore step sits before the real validation and depends on runner cache service state.

**How to apply:**

- Mark `Cache Playwright browsers` steps `continue-on-error: true`.
- Keep the subsequent `npx playwright install --with-deps chromium` step blocking so browsers are still actually installed.
- Preserve failed quick browser/render isolated workspaces while diagnosing remote-only E2E failures.

## Avoid Setup Actions For Self-Contained Tool Venvs

**Rule:** If a quality job creates its own virtualenv and installs a pinned tool, prefer the runner's system interpreter over an extra setup action unless the version is semantically required.

**Why:** The Semgrep job failed within seconds on Forgejo, before the scan/install path could run. The `actions/setup-python` boundary was an avoidable remote action dependency because the job already creates an isolated venv and pins Semgrep.

**How to apply:**

- Use `python3`/`python` from the runner for self-contained venv bootstraps.
- Keep setup actions where the job needs a specific interpreter version for repository code semantics.
- Keep the pinned tool install and scanner/baseline gate unchanged after removing the setup action.

## Prefer Verified Runner Toolchains For Flaky Setup Boundaries

**Rule:** On self-hosted Forgejo lanes, use an already-provisioned runner toolchain with an explicit version check when setup actions are failing before the real validation starts.

**Why:** Architecture failed quickly on Forgejo while the complete architecture command sequence passed locally. The setup-node action was not adding cache behavior or semantic coverage in that job; it was just another remote setup boundary before the actual graph/site checks.

**How to apply:**

- Replace avoidable setup actions with `node --version` / `npm --version` and an explicit major-version assertion when the runner is provisioned with the required toolchain.
- Keep setup actions for jobs that must test multiple versions or cannot rely on the runner image.
- Do not remove the real validation commands; only remove the flaky setup boundary before them.

## Quick E2E Failures Need Durable Artifacts

**Rule:** Quick browser/render jobs that run in isolated workspaces must copy Playwright reports/results back to the original workspace before upload.

**Why:** Quick Browser Smoke failed remotely after Quick Frontend passed, but the isolated workspace cleanup and Forgejo task API left no useful failure artifact to inspect.

**How to apply:**

- Use a shared artifact collector instead of duplicating inline `cp` blocks per job.
- Install the collector as an `EXIT` trap inside the isolated workspace so failures still copy evidence.
- Mark diagnostic artifact uploads `continue-on-error`; report upload problems should not turn a passing test into a failing gate.

## Retry Playwright OS Dependency Installs

**Rule:** `npx playwright install --with-deps` is an external package-manager boundary and should use the shared CI retry helper.

**Why:** Quick Browser Smoke failed before the application build or Playwright test because Ubuntu package metadata changed mid-fetch during the Playwright dependency install.

**How to apply:**

- Wrap `npx playwright install --with-deps chromium` with `scripts/ci/retry-command.sh` in quick and full E2E jobs.
- Keep the Playwright install blocking; retries only cover transient package-manager and mirror-sync failures.
- Do not retry the Playwright assertions themselves unless the test has an explicit, understood transient dependency.

## Probe Browser Runtime Before Apt

**Rule:** Browser E2E jobs should verify whether cached/restored browsers can already launch before invoking OS package installation.

**Why:** Retrying Playwright's `--with-deps` path still kept apt mirror state on the critical path, even when the browser cache was already restored.

**How to apply:**

- Run `npx playwright install chromium` first so the browser binary is present from cache or download.
- Launch Chromium headlessly as the real dependency probe.
- Only run `npx playwright install-deps chromium` when the launch probe fails, and keep that dependency install retried.

## Serialize Small Related-Test Lanes On Forgejo

**Rule:** PR quick related-test lanes should favor deterministic worker settings over maximum parallelism when the related set is small.

**Why:** Quick Frontend completed all related tests, then failed because Vitest's fork pool emitted `EPIPE`; another attempt segfaulted in `tsc`. The issue was process-pool instability, not a test assertion.

**How to apply:**

- Use `--pool threads --maxWorkers=1 --no-file-parallelism` for small related-test subsets on Forgejo.
- Keep full coverage lanes parallelized where sharding is explicit and the job owns enough work to justify it.
- Treat worker crashes and EPIPE after passing assertions as CI execution architecture problems, not flaky test expectations.

## Build Shared Images Once In Compose

**Rule:** A Compose stack should not define the same local image tag as a build output for multiple services.

**Why:** Legacy upgrade runs exported `sanctuary-backend:local` from backend, worker, and migrate at the same time. Modern BuildKit/Bake can race or corrupt the image export, and the old installer then failed later with missing containers.

**How to apply:**

- Put the `build:` block on the service that owns the image, then let sibling services reuse the image with `pull_policy: never`.
- For upgrade tests against older tags, adapt disposable legacy worktrees before install instead of committing brittle line-number expectations or changing release history.
- Treat Docker build failures as hard setup failures once the duplicate-build race is removed.

## Redact Installer Output Before CI Logs

**Rule:** Install and upgrade harnesses must redact installer output before it reaches CI stdout or uploaded logs.

**Why:** Verbose installer output can include generated runtime secrets and private runner paths while still being useful for diagnosing setup failures.

**How to apply:**

- Pipe installer output through the shared redactor before `tee` writes logs.
- Keep redacted runtime env and service logs as artifacts; do not upload raw install logs.
- Add unit assertions around the logging path, not just artifact collection.

## Build Test Architecture Around Stable Contracts

**Rule:** Installer, CI, and E2E tests should assert durable behavior contracts through repo-owned helpers, not incidental line numbers, exact transcript fragments, or provider-specific workflow mechanics.

**Why:** Repeated Forgejo failures showed that brittle assertions and hidden CI setup behavior can make each fix break another lane. A mature test architecture keeps the provider boundary explicit, isolates state per run, and catches failures in small focused tests before spending time on long E2E reruns.

**How to apply:**

- Keep workflow YAML thin; put source selection, installer setup, toolchain checks, retries, redaction, and artifact collection in repo-owned scripts that have direct unit or contract tests.
- Assert behavior and structured outcomes instead of source line numbers, full logs, or fragile wording. Use stable markers, fixtures, return codes, generated files, and parsed JSON where possible.
- Treat Forgejo/GitHub Actions vocabulary as a compatibility syntax layer. External network calls, checkout origins, artifact actions, and release-source choices must be explicit adapter boundaries.
- When the user explicitly chooses a source, test that only that source is contacted and failure is reported directly. When fallback is allowed, test that one failed source does not block probing the other.
- Isolate temp directories, virtualenvs, caches, ports, containers, reports, and credentials per run. Never reuse fixed mutable `.tmp` state across CI jobs unless the test is specifically proving reuse.
- Split long E2E coverage behind faster harness tests that exercise the same decision logic. A slow install or upgrade rerun should confirm integration, not discover basic parser or control-flow mistakes.
- Keep provider-specific compatibility tests focused on observable contracts: no terminal prompts in CI, no GitHub fetch when Codeberg is explicit, redacted logs, deterministic artifacts, and stable required-check aggregation.
- If an E2E fix requires repeatedly updating expected line numbers, stop and replace the expectation with a semantic assertion before continuing.

## Host-Socket Docker Ports Need The Job Gateway

**Rule:** A CI job container that talks to a host Docker daemon through a Unix socket must reach published container ports through the job container's default gateway, not through `127.0.0.1`.

**Why:** Verify Vectors started Bitcoin Core successfully on Forgejo, but the verifier waited on loopback from inside the job container. The published RPC port belonged to the Docker host, so Bitcoin Core was healthy while the job-side readiness probe could not reach it.

**How to apply:**

- Centralize Docker published-host detection in the shared endpoint helper instead of hard-coding loopback in each workflow or test harness.
- Keep loopback for normal host execution, but use the container gateway when a job is clearly running inside a container with a Unix Docker endpoint.
- Add deterministic unit tests for host execution, TCP Docker endpoints, explicit `SANCTUARY_DOCKER_PUBLISHED_HOST`, and containerized Unix-socket execution.
- Give environment-detection helpers an explicit test override so the same unit test passes on developer hosts and inside Forgejo job containers.
- When a Docker service log shows healthy startup but the job cannot reach the published port, inspect the job-to-host network boundary before changing application code.

## Retry Empty External Verifier Failures Only At The Boundary

**Rule:** Cross-language verifier wrappers may retry subprocess failures that produce no stdout/stderr or terminate by signal, but they must not retry structured calculation errors returned by the verifier.

**Why:** Forgejo reached the real address verifier after the Docker gateway fix, then `bip_utils` occasionally exited without diagnostics during multisig derivation. The address implementations otherwise agreed, so the brittle point was process startup/runtime stability, not vector correctness.

**How to apply:**

- Keep retries narrow and local to the external process boundary.
- Preserve hard failures for JSON error responses, parse failures, or actual address disagreements.
- Include exit code or signal in the final error so a repeated failure remains diagnosable.
- Add regression tests that prove empty failures retry and structured verifier errors do not.
