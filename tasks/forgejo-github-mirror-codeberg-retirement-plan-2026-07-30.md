# Forgejo-to-GitHub Mirror and Codeberg Retirement Plan

Date: 2026-07-30
Status: In progress
Source of truth: local Forgejo
Public mirror and distribution endpoint: GitHub
CI authority: Forgejo Actions, testing only

## Execution Ledger

- target_branch: `main`
- task_branch: per-phase isolated `codex/implement-merge/*` branches
- worktree_path: isolated local temporary worktree (path intentionally omitted)
- created_by_loop: branch and isolated worktree
- converted_to_next_phase: 2026-07-30 HST after PR #562 merged
- cleanup_status: pending
- recovery_path: operator-owned external backup directory (path intentionally
  omitted)
- GitHub Actions disabled: 2026-07-30 HST
- GitHub Dependabot security updates disabled: 2026-07-30 HST
- approved public branch allowlist: `main` only; unfiltered mirroring is forbidden
- Forgejo v16.0.1 branch filters are comma-separated literal/glob branch names,
  not regexes. A `main` filter propagates only that branch plus all tags; tag
  additions and deletions are mirrored.
- queued Dependabot dynamic runs: cancellation returns GitHub HTTP 500; repository
  config removal and post-mirror recheck pending
- release distribution PR: Forgejo PR #564 merged as
  `b1555054e8e9f021151d4e3ecc0c697e4b59e6bf`
- post-merge release-distribution evidence: architecture, Docker scope, and full
  Test Suite passed; install runs 7273 and 7275 failed before Sanctuary code ran
  because their `ubuntu-latest` job image lacked the Docker CLI
- Forgejo test-only CI PR: #566 merged as
  `1e178457f9fa4649fa4ea40260913a8b3555e620`; its PR and post-merge
  architecture, Docker validation, install/upgrade, full test, quality, and vector
  runs passed. The obsolete repository secrets `CODEBERG_USER`,
  `CODEBERG_PACKAGE_TOKEN`, and `UMBREL_DISPATCH_TOKEN` were then removed;
  `SANCTUARY_CI_LOG_SINK_TOKEN` remains.
- GitHub passive metadata: description identifies the repository as a read-only
  Forgejo mirror; Issues, Projects, Wiki, and Discussions are disabled. Actions
  remains disabled and Pages remains absent. GitHub still returns HTTP 500 when
  asked to cancel its 67 stale queued Dependabot dynamic runs.
- Phase 4 README source was synchronized from the current generated README before
  host changes, preserving newer product and architecture documentation. The
  template now carries one raw-content placeholder and eight clone placeholders,
  regeneration for GitHub is deterministic, active install/Umbrel guidance is
  GitHub-only, the obsolete GitLab generator mode is rejected, and the
  superseded Codeberg image-hosting plan was removed.
  Focused verification passed: deterministic regeneration hash
  `c92e1f0db5f5ae500efeb3e38949d3f0d9d607b8`, README link tests 6/6, and the
  Docusaurus production build.
  Forgejo PR #568 merged as
  `1d816231539300ffb4ac33f62a1ad830e6ce68a6`; its exact PR tree matched the
  squash result, and post-merge architecture and full test runs passed.
- Phase 5 preflight verified the GitHub recovery bundle, approved Forgejo `main`
  as the replacement for the unrelated GitHub `main`, and found that all 150
  normalized GitHub tags are an exact subset of Forgejo's 165 tags with no
  shared-tag commit mismatch. GitHub Actions remains disabled, Pages remains
  absent, and automated security updates remain disabled.
- Mirror and release credentials are provisioned separately. The HTTPS mirror
  token is limited to this repository with Contents and Workflows write; the
  release token has Contents write and Administration read; and the classic GHCR
  token reports only `write:packages`. All three credentials are distinct.
- The preferred SSH mirror could not be installed because the GitHub organization
  has `deploy_keys_enabled_for_repositories: false`; GitHub rejected the
  repository deploy key without changing any ref. The approved
  repository-scoped HTTPS fallback is now active.
- Forgejo 16.0.1's push-mirror DELETE API removed that trial mirror's database
  row but left its Git remote/refspec in the bare repository. The exact orphaned
  remote and three older unmanaged credential-bearing remotes were removed
  server-side after configuration backups were captured and restricted to mode
  `600`. Bare-repository integrity and PR creation were restored. Do not use the
  API deletion path for GitHub rotation or Codeberg retirement.
- The repository-mirroring runbook merged in Forgejo PR #572 as
  `17071daf14b87f057d580605bcba280ceef66bc3`; its PR checks and post-merge
  architecture/docs build passed.
- The live GitHub mirror is `remote_mirror_RGMmQdWu7oE`, filtered to literal
  `main`, synchronized on commit, and reconciled every eight hours. Its first
  controlled sync replaced GitHub `main` with Forgejo
  `1ae420fc9998240581abb1466d1e11c816bd693c` and brought all 165 normalized tags
  into exact parity without creating a GitHub Actions run.
- The disposable tag `mirror-rehearsal-20260730-1903` propagated at the exact
  Forgejo commit and disappeared from GitHub after normal Forgejo deletion.
  Anonymous raw-content, archive, and releases endpoints all returned HTTP 200.

## Outcome

Sanctuary development, pull requests, protected-branch checks, and test execution
remain on the local Forgejo instance. GitHub becomes a one-way, passive public
mirror of approved public Forgejo branches and release tags. GitHub Actions,
Dependabot mutation, and the GitHub Pages workflow are disabled. GitHub hosts
public release objects and GHCR images, but their publication is performed by a
trusted operator release command after Forgejo CI passes, not by GitHub Actions
or a Forgejo CI publishing job.

Codeberg is removed from the active delivery path only after equivalent GitHub git,
release, and image endpoints have passed end-to-end checks. Its push mirror,
credentials, packages, releases, and repository are then retired at an explicit
destructive-action checkpoint.

## Confirmed Current State

- Local `origin` is the authoritative private Forgejo repository; its internal
  URL is intentionally omitted from public documentation.
- The checkout has no GitHub or Codeberg git remote.
- GitHub `nekoguntai-castle/sanctuary` exists and is public, but is stale:
  - Forgejo `main`: `82a5e59a43555ef30b489fb22e4701e79d1c8aa0`
  - GitHub `main`: `b9200d8e89fb3105d523ec16a794bc93d302cfbe`
  - Forgejo/GitHub branch counts: 8/1
  - Forgejo/GitHub tag-ref counts: 197/182
- The two current `main` histories have no merge base. The first GitHub sync is a
  force replacement, not a fast-forward update; the old GitHub history must be
  bundled before cutover.
- GitHub Actions is currently enabled with `allowed_actions: all`.
- GitHub currently has queued Dependabot dynamic workflow runs even though the git
  mirror is stale.
- GitHub `main` has no branch-protection rule. This avoids an immediate mirror
  conflict, but human write access must be restricted because the mirror force
  pushes the destination.
- GitHub Pages is configured with workflow deployment at
  `https://nekoguntai-castle.github.io/sanctuary/`.
- The latest GitHub Release is `v0.8.49`; current Forgejo tags extend through
  `v0.8.56`.
- Forgejo already has a healthy SSH push mirror to Codeberg with sync-on-commit and
  an eight-hour periodic interval. The GitHub mirror should reuse that proven
  authentication and scheduling pattern.
- Forgejo reads the seven workflows in `.github/workflows`; there is no
  `.forgejo/workflows` tree:
  `architecture.yml`, `docker-build.yml`, `install-test.yml`, `quality.yml`,
  `release-candidate.yml`, `test.yml`, and `verify-vectors.yml`.
- `install-test.yml` currently publishes stable multi-architecture images to
  Codeberg Packages and dispatches `sanctuary-umbrel`.
- `docker-compose.ghcr.yml`, despite its name, currently defaults to the Codeberg
  registry.
- Git tags alone do not create GitHub Release objects. The current
  `scripts/create-forge-release.sh` creates Forgejo and Codeberg releases only.
- Active Codeberg dependencies include the installer, release/version API,
  About dialog, README, compose registry defaults, stable-image publishing,
  release tooling, Umbrel links/dispatch assumptions, tests, and operator docs.
- No local Codeberg git remote exists. Server-side Forgejo mirror settings and
  secret values require an authenticated inventory during implementation.

## Target-State Contract

| Concern | Canonical owner | GitHub behavior |
|---|---|---|
| Public `main`, approved public branches, and release tags | Forgejo | One-way push mirror; no direct development |
| Pull requests and branch checks | Forgejo | Not authoritative; no required checks |
| CI tests | Forgejo Actions | Disabled |
| Dependency update PRs | Forgejo-native process or manual | Disabled |
| Release approval | Operator after green Forgejo release gates | Receives release object |
| Container images | Operator release command | Public GHCR distribution |
| Release metadata | Forgejo plus GitHub | GitHub copy created through API |
| Architecture docs | Markdown in mirrored repository | No GitHub Pages deployment |
| Codeberg | None | Fully retired after rollback window |

The mirror is not bidirectional. GitHub commits, tags, release edits, issues, and
pull requests do not flow back to Forgejo. Repository metadata must clearly state
that Forgejo is authoritative and that direct GitHub contributions are not merged.

## Design Decisions

1. Keep workflows in `.github/workflows`.
   Forgejo intentionally consumes them and the repository contains many workflow
   tests and composite actions tied to that path. Moving them to `.forgejo` adds
   unrelated migration risk. Disable Actions at the GitHub repository level
   instead.
2. Prefer an SSH write deploy key for the Forgejo push mirror.
   This scopes git write authority to one GitHub repository and avoids sharing the
   release/package token with the mirror. Because Forgejo is private and GitHub is
   public, default to an allowlist containing `main` and only explicitly public
   branch patterns. If organization policy disables deploy keys, use a dedicated
   fine-grained token scoped only to this repository with Contents and Workflows
   write over HTTPS. Do not weaken organization-wide policy implicitly or reuse
   a release/package credential. The installed Forgejo version always mirrors
   tags; the trusted release command verifies tag parity and can idempotently
   repair a missing GitHub tag after the commit is mirrored. An unfiltered
   `git push --mirror` is allowed only after an explicit review approves exposing
   every current and future Forgejo branch.
3. Use separate release credentials.
   - A GitHub fine-grained token scoped only to this repository with Contents
     write and Administration read creates GitHub Release objects and verifies
     that Actions remains disabled before any tag mutation.
   - A dedicated classic PAT with `write:packages` publishes GHCR images, because
     GitHub Packages currently requires a classic PAT for external publishers.
   - Neither token is a GitHub Actions secret; store them in the operator secret
     store and inject only for the release command.
4. Interpret “Forgejo CI for testing only” strictly.
   Remove image publication and Umbrel notification from the Forgejo workflow.
   A trusted operator release command performs distribution only after it verifies
   the stable tag and green Forgejo release gates.
5. Retire GitHub Pages.
   Remove the GitHub-only deploy job and Pages-specific artifact step from
   `architecture.yml`, disable Pages, and update documentation to use repository
   Markdown. The Forgejo workflow continues to typecheck and build Docusaurus as a
   test.
6. Preserve immutable release tags.
   Never rewrite an already published stable tag to repair the mirror. Ref parity
   is checked before the first sync, and any unexpected divergence is resolved
   explicitly before enabling periodic/on-push mirroring.

## Implementation Plan

### Phase 0 — Inventory, freeze, and recovery evidence

- [x] Record the Forgejo repository ID, default branch, branch protection,
  required check names, push mirrors, Actions variables, and secret *names*.
- [x] Record the Codeberg repository, releases, package names/tags/digests, mirror
  status, and credential names without printing secret values.
- [x] Export recovery evidence:
  - a bare/mirror clone of Forgejo to an ignored temporary or backup location;
  - sorted Forgejo, GitHub, and Codeberg head/tag ref manifests;
  - current public release JSON and image manifest/digest records.
- [ ] Pause stable releases during the cutover window. Ordinary Forgejo PR work may
  continue until the final ref-parity window.
- [x] Review all Forgejo branches for secrets, operator-only content, and
  unfinished private work. Approve a public branch allowlist; do not assume that a
  private Forgejo feature branch may be published.
- [ ] Define the accepted rollback window before Codeberg deletion. Recommended:
  retain Codeberg read-only for seven days after the first successful GitHub-backed
  stable release.
- [x] Bundle the unrelated pre-mirror GitHub history before it is force-replaced.
- [ ] Restrict human write access on the GitHub repository as far as organization
  policy allows. Do not add protection that blocks the push mirror's required
  force updates.

Exit gate: recovery clone and manifests exist, live server-side settings are
documented, and no release is in flight.

### Phase 1 — Make GitHub passive before enabling the mirror

- [x] Disable GitHub Actions at repository level:
  `PUT /repos/nekoguntai-castle/sanctuary/actions/permissions` with
  `{"enabled": false}`.
- [x] Verify the corresponding GET returns `enabled: false`.
- [ ] Cancel currently queued GitHub workflow/Dependabot runs.
- [x] Disable Dependabot version updates and automated security fixes on GitHub.
  Keep vulnerability alerts only if read-only alerting is desired.
- [x] Remove `.github/dependabot.yml` through a Forgejo PR so mirrored configuration
  cannot open divergent GitHub PRs later.
- [x] Disable GitHub Pages deployment in the repository after replacing its
  documentation links. Disable the live Pages setting after this PR merges.
- [x] Set the GitHub description/README notice to identify it as a read-only mirror
  and direct development to Forgejo. Disable GitHub Issues, Discussions, Projects,
  and Wiki if none are intentionally retained.

Exit gate: GitHub Actions reports disabled; no dynamic/Dependabot work remains
queued; GitHub is clearly marked non-authoritative.

### Phase 2 — Prepare GitHub release and image distribution

- [x] Resolve mirror authentication: the preferred repository deploy-key path was
  rejected by GitHub organization policy, so provision a dedicated
  repository-scoped HTTPS mirror token instead.
- [x] In a disposable repository and against the exact v16.0.1 source, verify
  the installed Forgejo version's branch
  filter and tag behavior. Record whether `main` filtering still propagates
  annotated/lightweight tags and tag deletions.
- [x] Create the separate GitHub Release and GHCR credentials described above.
- [x] Update `scripts/ci/build-and-push-images.sh`:
  - default `IMAGE_REGISTRY` to `ghcr.io/nekoguntai-castle`;
  - remove Codeberg-specific cache comments and diagnostics;
  - preserve stable-tag validation, multi-architecture manifests, digests, and
    best-effort registry cache behavior.
- [x] Update `docker-compose.ghcr.yml` so every frontend/backend image defaults to
  `ghcr.io/nekoguntai-castle`, while preserving `IMAGE_REGISTRY` override support.
- [x] Replace the Codeberg target in `scripts/create-forge-release.sh` with GitHub:
  - continue creating the Forgejo release;
  - use GitHub's Releases API and the scoped release token;
  - remain idempotent when a release already exists;
  - fail the overall command if either required release target fails.
- [x] Add a release orchestration command under `scripts/release/` that:
  1. requires a clean checkout at an immutable stable tag;
  2. verifies the tag commit exists on Forgejo and the required Forgejo release
     gates are green;
  3. logs in to GHCR with `--password-stdin`;
  4. builds and pushes amd64/arm64 images and records their digests;
  5. runs the repository's release-artifact verifier;
  6. creates Forgejo and GitHub release objects;
  7. dispatches the local Forgejo `sanctuary-umbrel` update only after image
     digests are verified;
  8. logs out and removes temporary credential files on every exit path.
- [x] Change the external `sanctuary-umbrel` repository to consume public GHCR
  images/digests before the first GitHub-backed Sanctuary release.
- [ ] Publish/backfill GHCR images needed by supported upgrades, at minimum the
  currently supported baseline and latest stable release. Make both packages
  public and verify anonymous pulls.
- [ ] Backfill missing GitHub Release objects from `v0.8.50` through the current
  stable tag, preserving tag, title, notes, prerelease status, and published
  assets where available.

Exit gate: GitHub's latest release matches Forgejo, GHCR serves both architectures
anonymously, and Umbrel can resolve the new digests while Codeberg remains intact.

### Phase 3 — Make Forgejo Actions test-only

- [x] In `.github/workflows/install-test.yml`, remove the `publish-images` and
  `notify-umbrel` jobs and all Codeberg secrets/login/logout behavior. Preserve
  stable-tag release-critical testing and its aggregate gate.
- [x] In `.github/workflows/docker-build.yml`, remove GitHub-only GHCR push
  behavior. Retain or convert jobs to build-only validation on Forgejo with no
  registry write credentials.
- [x] In `.github/workflows/architecture.yml`, remove the GitHub Pages artifact and
  deploy job. Preserve graph drift, docs typecheck, and site-build validation.
- [x] Preserve the Forgejo required status contexts exactly:
  `PR Required Checks`, `Full Test Summary`, and
  `Code Quality Required Checks`.
- [x] Remove dead GitHub-only `merge_group` assumptions from operational docs, but
  change workflow triggers only if Forgejo/actionlint compatibility tests show the
  cleanup is safe.
- [x] Add a workflow policy test that fails if CI references write credentials,
  `docker login`, image pushes, release creation, Pages deployment, or downstream
  dispatch. Allow diagnostic artifact upload to Forgejo itself.

Exit gate: all seven Forgejo workflows are validation-only, required checks retain
their exact names, and repository tests enforce the no-publish policy.

### Phase 4 — Switch active product and documentation references

- [x] Simplify `install.sh` to GitHub-only online distribution:
  - GitHub clone/raw/release endpoints become canonical;
  - remove Codeberg source detection, fallback, `--source codeberg`, and
    Codeberg-specific tag-repair messages;
  - keep offline installation behavior unchanged;
  - provide a clear failure when GitHub is unreachable rather than silently using
    another forge.
- [x] Update `server/src/api/admin/version.ts` to query the GitHub latest-release
  endpoint and link to GitHub Releases; update its tests for success, timeout,
  malformed response, cache, and fallback behavior.
- [x] Update `components/Layout/AboutModal.tsx` and its tests to use GitHub
  repository and release links.
- [x] Treat `README.template.md` as canonical, update it first, then regenerate
  `README.md` with `scripts/generate-readme.sh github`. Replace every Codeberg
  clone/install/Umbrel link and remove obsolete source-selection guidance.
- [x] Update `CONTRIBUTING.md`, `CLAUDE.md`,
  `docs/reference/ci-cd-strategy.md`, architecture docs, release docs, and operator
  scripts to describe Forgejo-authoritative CI plus GitHub mirroring/distribution.
  (`CLAUDE.md` is not present on the target branch; all existing active files
  were audited.)
- [x] Update `scripts/bump-version.sh` instructions to use the operator release
  command and GitHub/Forgejo release objects.
- [x] Update `scripts/ci/measure-wallclock.sh` provider classification and any
  remaining active Codeberg labels/comments.
- [x] Remove the superseded
  `docs/plans/codeberg-image-hosting-migration.md` from the active plan set.
  Historical task archives may retain factual history, but must not be linked as
  current operational guidance.
- [x] Update all affected behavioral tests, including:
  - `tests/install/unit/install-script.test.sh`
  - `server/tests/unit/api/admin-version-routes.test.ts`
  - `server/tests/unit/api/admin/admin.audit-version-electrum.contracts.ts`
  - `server/tests/unit/api/adminRoutes/adminRoutes.audit-version.contracts.ts`
  - `tests/components/Dashboard/UpdateBanner.test.tsx`
  - About dialog tests
  - release/image workflow policy tests

Deliver this phase as one or more Forgejo PRs, with the distribution preparation
merged before user-facing defaults change.

Exit gate: active source, install, release, image, UI, and documentation paths use
GitHub/GHCR; no supported user flow depends on Codeberg.

### Phase 5 — Enable and verify the Forgejo-to-GitHub mirror

- [x] Before the first force sync, compare every conflicting GitHub branch/tag
  with Forgejo and explicitly approve Forgejo as winner. Preserve unique GitHub
  content in the recovery backup if any exists.
- [x] Add the Forgejo push mirror using either the preferred GitHub SSH deploy key
  or the approved repository-scoped HTTPS mirror token. Apply the exact `main`
  allowlist, enable sync-on-push, and retain an eight-hour periodic
  reconciliation backstop.
- [x] Force the initial synchronization.
- [x] Compare sorted `git ls-remote --heads` output against the approved public
  branch set and all `--tags` between Forgejo and GitHub, dereferencing annotated
  tags consistently.
- [x] Confirm existing Forgejo non-`main` branches do *not* appear on GitHub.
  Push a disposable tag, verify it appears, then remove it through normal Forgejo
  operations and verify deletion propagation.
- [ ] Merge a harmless Forgejo PR and verify:
  - GitHub receives the exact commit;
  - no GitHub Actions run is created;
  - no GitHub Dependabot PR/run is created;
  - Forgejo remains the only place that reports required test checks.
- [x] Verify GitHub raw content, clone, archive, and release endpoints work
  anonymously.

Exit gate: public-branch/tag parity is exact, private branches remain absent,
on-push and periodic sync work, tag deletions propagate as intended, and GitHub
executes no automation.

### Phase 6 — End-to-end release rehearsal

- [ ] Cut an RC tag on Forgejo and prove Forgejo-only RC/install validation.
- [ ] Confirm the tag mirrors to GitHub without starting GitHub Actions.
- [ ] Run the operator release command in dry-run mode against the RC, with
  registry/release mutations disabled.
- [ ] For the next stable release, run the real operator command and verify:
  - required Forgejo gates were green before publication;
  - GitHub and Forgejo release objects reference the same tag/commit;
  - GHCR frontend/backend manifests contain linux/amd64 and linux/arm64;
  - installer and admin update check discover the GitHub release;
  - a clean online install and a supported-version upgrade pull only GHCR;
  - Umbrel receives and applies the verified GHCR digests.

Exit gate: one stable release completes without GitHub Actions or Codeberg.

### Phase 7 — Remove Codeberg

This phase is destructive and requires exact, one-off approval at execution time.

- [ ] Disable and remove the Forgejo-to-Codeberg push mirror through the
  repository-settings UI (which removes both the database row and Git remote),
  not Forgejo 16.0.1's incomplete DELETE API.
- [ ] Delete Codeberg secret entries from Forgejo and the operator secret store:
  `CODEBERG_URL`, `CODEBERG_OWNER`, `CODEBERG_REPO`, `CODEBERG_TOKEN`,
  `CODEBERG_USER`, and `CODEBERG_PACKAGE_TOKEN`.
- [ ] Revoke the corresponding Codeberg access/package tokens.
- [ ] Remove Codeberg package images only after GHCR digest and install/upgrade
  evidence has been retained.
- [ ] Remove Codeberg release objects and repository according to the approved
  rollback window. Preserve a final ref/release/package manifest in the recovery
  record before deletion.
- [ ] Confirm the external `sanctuary-umbrel` repository and any host automation
  contain no Codeberg URL, token, package, or dispatch dependency.
- [ ] Search active tracked files and external configuration for `codeberg` and
  accept only explicitly classified historical records.

Exit gate: Codeberg has no live mirror, credentials, packages, releases,
repository, installer path, UI link, or downstream dependency.

## Verification Matrix

### Repository and workflow checks

- `git diff --check`
- `bash -n install.sh scripts/create-forge-release.sh
  scripts/ci/build-and-push-images.sh <new-release-command>`
- `bash tests/ci/check-workflow-composition.test.sh`
- `node tests/ci/check-github-action-runtimes.test.mjs`
- `actionlint` or the repository's existing workflow validation command
- New test proving Forgejo workflow files contain no publishing/deploy credentials
  or mutation steps
- `rg -n -i 'codeberg'` with any historical-only matches documented

### Behavioral checks

- Installer unit suite, including GitHub success/error, existing checkout, tag
  refresh, offline mode, malformed release response, and network failure
- Focused admin version-route suites
- About dialog and Update Banner suites
- Release tooling unit/integration tests with mocked Forgejo, GitHub, GHCR, and
  Umbrel boundaries
- `tests/release/verify-release-artifacts.test.mjs`
- A clean Docker install and a supported upgrade using GHCR

### External-state checks

- GitHub Actions permissions GET returns `enabled: false`.
- GitHub has no workflow run for commits created after mirror enablement.
- GitHub Dependabot version/security updates are disabled and no queued dynamic
  runs remain.
- GitHub heads exactly match the approved public branch set and intended tags
  match Forgejo exactly.
- GitHub latest release tag and target commit match Forgejo.
- Anonymous GHCR pulls work; manifests and recorded digests match both
  architectures.
- Forgejo required checks pass and retain exact protected-branch context names.
- Forgejo lists only the GitHub push mirror.
- Codeberg credentials fail after revocation and no active service references it.

## Rollback

Before Phase 7, rollback is a normal Forgejo revert:

1. Disable the GitHub push mirror.
2. Revert user-facing GitHub/GHCR defaults to the still-live Codeberg endpoints.
3. Restore the prior Forgejo image-publish/release path from version control only
   if its credentials remain valid.
4. Re-run Forgejo test and install/upgrade gates.

After Codeberg tokens/packages/repository are deleted, immediate rollback to
Codeberg is no longer available. Recovery would require recreating the remote,
packages, releases, and credentials from retained evidence. Therefore Phase 7
must not begin until the stable-release rehearsal passes and the rollback window
expires.

## Risks and Controls

- **Mirror force push overwrites unrelated GitHub history.** Bundle the current
  GitHub repository and compare refs before first sync; prohibit direct GitHub
  development afterward.
- **Private Forgejo work becomes public.** Use a reviewed branch allowlist and test
  both positive and negative branch-filter behavior before production sync.
- **Mirrored workflows unexpectedly execute.** Disable GitHub Actions before
  adding the mirror and verify with a disposable mirrored commit.
- **Dependabot mutates the passive mirror independently.** Disable it and remove
  its configuration before mirror cutover.
- **Git tag parity is mistaken for release parity.** Backfill and verify GitHub
  Release objects separately.
- **Codeberg removal breaks installs.** Publish and anonymously pull GHCR images,
  then test fresh install and upgrade before retiring packages.
- **GitHub Pages silently freezes.** Remove the deployment and public links
  deliberately rather than leaving a stale site.
- **Release credentials have excessive scope.** Separate mirror, release, and
  package credentials; scope each to one repository/purpose and keep them outside
  Actions.
- **Forgejo check names drift during workflow cleanup.** Treat the three aggregate
  context names as compatibility contracts and test them.
- **Umbrel lags the registry switch.** Update and rehearse the external repository
  before changing Sanctuary defaults.

## Official Operational References

- Forgejo repository mirrors:
  https://forgejo.org/docs/latest/user/repo-mirror/
- GitHub repository Actions settings:
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- GitHub Actions permissions REST API:
  https://docs.github.com/en/rest/actions/permissions
- GitHub Container Registry authentication:
  https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry

## Definition of Done

- Forgejo is the only development, PR, and CI test authority.
- GitHub is an exact, automatically refreshed one-way mirror of the approved
  public branches and release tags.
- GitHub Actions, Dependabot mutation, and GitHub Pages deployment are disabled.
- Forgejo workflows perform testing/validation only.
- GitHub Releases and public GHCR replace Codeberg distribution.
- A stable release and supported upgrade pass end to end using GitHub/GHCR.
- Codeberg has no live repository, mirror, secrets, tokens, packages, releases, or
  active project/downstream references.
