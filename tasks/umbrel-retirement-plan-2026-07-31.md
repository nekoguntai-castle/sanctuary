# Umbrel and GHCR Distribution Retirement Plan

Date: 2026-07-31
Status: In progress
Source and CI authority: local Forgejo
Public source mirror and release endpoint: GitHub
Supersedes: Umbrel and GHCR portions of
`tasks/forgejo-github-mirror-codeberg-retirement-plan-2026-07-30.md`

## Outcome

Remove Umbrel as a supported Sanctuary platform, retire the separate
`sanctuary-umbrel` automation and repositories, and remove the reduced prebuilt
GHCR deployment path. Keep the canonical GitHub-source installer, locally built
Compose runtime, signed offline bundles, Forgejo test-only CI, and matching
Forgejo/GitHub Release objects.

This plan deliberately does **not** make the existing private GHCR packages
public. The supported `install.sh` path already resolves a GitHub release, clones
the tagged GitHub source, and builds `docker-compose.yml` locally. Offline bundles
also contain locally built images. Only Umbrel and the separately documented
`docker-compose.ghcr.yml` path require GHCR.

## Current State and Evidence

- Forgejo is the source and test-only CI authority; GitHub is a passive public
  mirror with GitHub Actions disabled.
- GitHub `nekoguntai-castle/sanctuary-umbrel` is public, unarchived, and has an
  active update workflow. Forgejo has a public, unarchived repository of the same
  name with Actions enabled, an `UMBREL_RELEASE_TOKEN` secret, and a Codeberg push
  mirror. No public Codeberg `sanctuary-umbrel` repository was found by API search,
  so the live mirror target must be resolved from Forgejo before removal.
- `sanctuary-frontend` and `sanctuary-backend` GHCR packages are private. Anonymous
  Umbrel or prebuilt-Compose pulls therefore do not form a healthy public channel.
- The canonical online installer and the signed offline-bundle flow do not pull
  GHCR images.
- The only tracked non-Umbrel GHCR consumer is the reduced
  `docker-compose.ghcr.yml` deployment, including its documented MCP profile.
- Existing Git tags and Forgejo/GitHub Release objects are independent of Umbrel
  and GHCR. They remain required for version discovery and source installation.
- Forgejo currently exposes v0.8.57 as latest while GitHub exposes v0.8.56 as
  latest. Reconcile or explicitly explain that release-object mismatch before
  changing the publisher so the retirement work does not conceal a pre-existing
  distribution defect.

## Canonical Post-Retirement Contract

| Concern | Canonical path | Retire |
| --- | --- | --- |
| Source and CI | Forgejo repository and test-only Forgejo Actions | Release publication or downstream mutation from CI |
| Public code | Forgejo `main` and tags mirrored to GitHub; GitHub Actions disabled | Codeberg source hosting |
| Online installation | GitHub latest-release lookup, tagged GitHub clone, local build through `install.sh` and `docker-compose.yml` | Umbrel and `docker-compose.ghcr.yml` |
| Offline installation | Signed, checksummed, per-platform offline bundle containing locally built images | Registry-dependent offline claims |
| Release publication | Trusted operator verifies Forgejo gates/tag parity and creates idempotent Forgejo/GitHub Release objects | GHCR build/push and Umbrel dispatch |
| MCP deployment | Main locally built Compose path (`./start.sh --with-mcp`) | GHCR Compose profile |
| Historical evidence | Existing tags, releases, audit reports, and closed plans | Mechanical rewriting of factual history |

## Scope Boundaries

In scope:

- Remove all active Umbrel product guidance, release automation, credentials, and
  external update infrastructure.
- Remove the GHCR prebuilt deployment and publication contract so package
  visibility is no longer a release blocker.
- Provide migration guidance for existing Umbrel/prebuilt-Compose users.
- Retire the external Umbrel repositories and packages in a staged, recoverable
  process.

Out of scope:

- Deleting Sanctuary Git tags or Forgejo/GitHub Release objects.
- Disabling local Docker builds or Docker-based validation in Forgejo CI.
- Removing the main Compose deployment, MCP support, or offline bundles.
- Rewriting historical audits, announcements, or completed plan narratives.
- Deleting anything during the implementation PRs; destructive host cleanup is a
  later, separately approved phase.

## Phase 0 — Freeze, Inventory, and Recovery Baseline

- [x] Freeze Umbrel updater changes and GHCR publication; do not change package
  visibility.
- [x] Reconcile Forgejo/GitHub v0.8.57 Release objects, or record an intentional
  exception with exact tag/asset evidence, before using release parity as a gate.
- [x] Capture exact JSON inventories for both GHCR packages: visibility, package
  IDs, version IDs, tags, digests, creation dates, and the final v0.8.57 platform
  manifests.
- [x] Resolve and record the exact Forgejo Umbrel push-mirror target rather than
  assuming a Codeberg owner or repository name.
- [x] Create verified clone bundles of the Forgejo and GitHub
  `sanctuary-umbrel` repositories, including all refs, and record their hashes in
  an operator-owned recovery manifest outside the repository.
- [x] Record external repository settings, workflow names, secret **names**,
  release/tag inventories, community-store URLs, and known consumer links without
  writing secret values to logs.
- [x] Search public documentation and repository references for consumers of the
  Umbrel URL and `docker-compose.ghcr.yml`; preserve results as migration evidence.

Exit criteria: every future destructive target has an exact immutable identifier
and a tested recovery artifact; no deletion or visibility change has occurred.

## Phase 1 — Main Repository Convergence PR

### Release pipeline

- [x] Simplify `scripts/release/publish-release.sh` to retain clean exact-tag
  validation, green Forgejo release-gate verification, disabled-GitHub-Actions
  verification, mirrored GitHub tag parity/repair, and idempotent Forgejo/GitHub
  Release creation.
- [x] Remove Buildx setup, Docker login/logout, GHCR build/reuse/push/digest
  verification, image evidence generation, and Umbrel dispatch from that command.
- [x] Remove `GHCR_USER`, `GHCR_TOKEN`, `UMBREL_DISPATCH_TOKEN`, `UMBREL_OWNER`, and
  `UMBREL_REPO` from its required configuration and secret-safety handling.
- [x] Remove `dispatch_umbrel()` from
  `scripts/release/release-operator-api.sh`; retain shared Forgejo/GitHub API and
  release-gate helpers.
- [x] Keep `scripts/create-forge-release.sh` and the existing operator command name
  unless a rename can preserve a clear compatibility alias.
- [x] Preserve legacy container-image entries as optional input to historical
  release-manifest verification, but remove container images and live registry
  access from the current stable-release requirements. Preserve checksums,
  signatures, source/offline artifacts, path-safety validation, SBOMs, and
  provenance where applicable.

### Runtime and tooling

- [x] Delete `docker-compose.ghcr.yml`.
- [x] Delete `scripts/ci/build-and-push-images.sh` and its dedicated test.
- [x] Remove GHCR-Compose assertions from install and migration contract tests
  while retaining equivalent coverage for `docker-compose.yml` and offline paths.
- [x] Update `package.json` test aggregation to remove the retired image-publisher
  test while retaining release-publication and artifact-verification suites.
- [x] Keep local Docker build validation. Keep provider-neutral Forgejo CI guards
  that forbid registry writes, release creation, and downstream dispatch; explicit
  retired-secret patterns may remain as negative anti-regression checks.

### Product and operator documentation

- [x] Remove the Umbrel TOC and installation section from `README.template.md`,
  regenerate `README.md`, and verify deterministic output.
- [x] Remove or rewrite active Umbrel/GHCR statements in `CONTRIBUTING.md`,
  `docs/README.md`, `docs/reference/ci-cd-strategy.md`,
  `docs/reference/release-distribution.md`,
  `docs/reference/repository-mirroring.md`, and
  `docs/reference/offline-bundles.md`.
- [x] Rewrite `docs/how-to/mcp-server.md` around the locally built Compose path.
- [x] Correct `docs/reference/frontend-architecture.md`: remove the nonexistent
  in-repository Umbrel package and describe `HashRouter` as static-hosting and
  reverse-proxy compatibility.
- [x] Update release messages in `scripts/bump-version.sh`, the stale Husky comment,
  and neutralize the Prisma example label without a schema migration.
- [x] Add a short migration guide for Umbrel and GHCR-Compose users: back up data,
  install the same or newer tag through the source installer, restore/verify, and
  only then remove the old deployment.
- [x] Add explicit supersession notes to active plans; preserve closed plans,
  audits, release announcements, feature timelines, and unrelated natural-language
  uses of “umbrella.”

### Tests and acceptance

- [x] Replace `tests/release/publish-release.test.sh` expectations with a release-
  only ordering contract: exact tag and green Forgejo gate, GitHub Actions disabled,
  and GitHub tag parity must precede release-object creation; dry-run performs no
  mutation; Docker, registry, and downstream dispatch are never invoked.
- [x] Update release-artifact tests to prove current releases need no registry
  access while legacy manifests remain locally verifiable.
- [x] Run focused shell, release, installer, Compose, README, docs-build, and CI
  policy tests, then the full project gates required by `CLAUDE.md`.
- [x] Run a classified search: active tracked files contain no accepted Umbrel,
  `sanctuary-umbrel`, `docker-compose.ghcr.yml`, GHCR publication, or Umbrel-token
  references. Only historical records and explicit anti-regression/retirement
  documentation may remain.

Exit criteria: the main repository can release, install, upgrade, run MCP, and
produce/verify offline artifacts with no Umbrel repository or registry dependency.

## Phase 2 — Release and Migration Rehearsal

- [ ] Rehearse the operator command against an RC or disposable release: it must
  verify the Forgejo gate and tag parity and create/update only Forgejo/GitHub
  Release objects.
- [ ] Prove no Docker daemon, Buildx builder, registry credential, GHCR request, or
  downstream workflow dispatch is used.
- [ ] Verify a clean online installation through GitHub source and a supported
  upgrade from the oldest maintained source-install baseline.
- [ ] Build, sign, attach, download, verify, and install each supported-platform
  offline bundle. If offline bundles remain a promised stable channel, make them a
  release gate; recent assetless releases are not sufficient evidence.
- [ ] Verify MCP via the main Compose path.
- [ ] Verify Forgejo/GitHub tag and Release parity and confirm GitHub Actions remains
  disabled with no run created by the rehearsal.

Exit criteria: a real release-shaped rehearsal succeeds after temporarily removing
GHCR and Umbrel variables from the operator environment.

## Phase 3 — External Umbrel Sunset

- [ ] Land a final `sanctuary-umbrel` notice before archiving. State that the app is
  unsupported, updates have ended, GHCR pulls are not a supported channel, and
  users must migrate to the source installer. Include backup/restore guidance and
  a fixed final-support date.
- [ ] Disable/remove the updater workflow and verify dispatch returns no successful
  mutation path.
- [ ] Disable the exact Forgejo push mirror after recording its target and config.
- [ ] Remove the repository from any community app-store URL/listing owned by the
  project. No entry was found in the official `getumbrel/umbrel-apps` repository,
  so an upstream official-store PR is not currently expected.
- [ ] Remove the Umbrel install section and metadata claims from the project-owned
  `nekoguntai/nekoguntai_html` Sanctuary install page, preserving its standalone
  source-install guidance. Deliver that separate repository through its own PR.
- [ ] Archive the GitHub repository and put the Forgejo repository into the closest
  supported read-only/archive state for a **30-day rollback and migration window**.
  Preserve the final tag, source, issues, and notice during this window.
- [ ] If a real Codeberg repository is resolved from the Forgejo mirror, freeze it
  with the same notice or disable the mirror before the broader Codeberg retirement.

Existing installations are not automatically uninstalled. Archiving stops active
maintenance and new automated updates but intentionally leaves migration guidance
available during the window.

Exit criteria: no new Umbrel install/update is advertised or automated; the last
state remains recoverable and users have an explicit supported migration route.

## Phase 4 — Credential Retirement

Perform only after Phase 2 succeeds and the updater is disabled:

- [ ] Remove `UMBREL_DISPATCH_TOKEN` and GHCR publisher variables from the local
  operator secret file and any release host environment.
- [ ] Delete/revoke the Forgejo `sanctuary-umbrel` `UMBREL_RELEASE_TOKEN` secret and
  its backing token.
- [ ] Revoke the GitHub package publisher token if it has no other verified use.
- [ ] Do not add package-deletion authority to the long-lived publisher token.
  Obtain short-lived exact cleanup authority only in Phase 6 if deletion is
  approved.
- [ ] Confirm Sanctuary Forgejo Actions retains only test/logging secrets and no
  release, package, mirror, or downstream-dispatch credential.
- [ ] Re-run the release rehearsal and secret-name inventory after revocation.

Exit criteria: neither repository nor release host possesses authority to update
Umbrel or publish Sanctuary container packages.

## Phase 5 — Codeberg Retirement Gate

The existing Codeberg plan must no longer wait for public GHCR or Umbrel success.
Its replacement distribution gate is:

- [ ] Forgejo-to-GitHub `main` and tag mirroring is exact and repeatable.
- [ ] GitHub Actions remains disabled and Forgejo test-only CI remains green.
- [ ] GitHub source install, supported upgrade, latest-version discovery, and
  Forgejo/GitHub Release parity pass without Codeberg, GHCR, or Umbrel.
- [ ] Offline bundles pass if they remain part of the supported distribution
  contract.

Once these checks pass, retire Codeberg according to the existing exact-target,
backup-first plan. The Umbrel mirror must not keep Codeberg alive as a hidden
dependency.

## Phase 6 — Destructive Cleanup (Separate Approval)

After the 30-day window, present a read-only manifest and request exact, one-off
permission for each destructive target. Do not use wildcard or broad cleanup
approval.

Recommended deletion set:

1. GitHub Packages `nekoguntai-castle/sanctuary-frontend`.
2. GitHub Packages `nekoguntai-castle/sanctuary-backend`.
3. Forgejo repository `nekoguntai-castle/sanctuary-umbrel`.
4. GitHub repository `nekoguntai-castle/sanctuary-umbrel`.
5. The exact Codeberg Umbrel repository, only if Phase 0 resolves one.

Before deletion:

- [ ] Re-verify clone bundles and package/release manifests from a separate temp
  directory.
- [ ] Confirm no active tracked file, documentation page, app-store entry, compose
  file, deployment, or credential refers to the target.
- [ ] Confirm the source installer, current release, supported upgrade, offline
  bundle, and MCP path remain green.
- [ ] Record GitHub package namespace ownership and restoration constraints.
- [ ] Ask for approval using the exact owner/name or numeric IDs shown in the final
  manifest.

After deletion:

- [ ] Confirm package endpoints and Umbrel repository URLs are absent.
- [ ] Confirm GitHub latest release, source archives, raw content, installer, and
  Forgejo/GitHub mirror parity still work.
- [ ] Confirm no Git tag or Sanctuary Release object was removed.
- [ ] Store the retirement manifest and recovery hashes in the operator runbook.

Default recommendation: archive for the 30-day notice period, then delete only if
“altogether” includes removal of public historical repositories. Permanent archive
is the safer alternative if preserving old links and migration instructions matters
more than total removal.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing Umbrel users lose updates or pull private images | Publish a final notice, document backup/restore migration, and retain a read-only window before deletion. |
| Manual `docker-compose.ghcr.yml` users are overlooked | Treat it as a supported divergent path, publish migration instructions, and search public references before removal. |
| Deleting a package breaks an unknown consumer | Keep packages private/frozen during the window, capture package inventory, and require exact approval after source-install validation. |
| Removing image requirements weakens release evidence | Keep signed checksums, offline image tar verification, SBOM/provenance, and exact Forgejo/GitHub release/tag checks. |
| Credentials are revoked too early | Revoke only after code lands and a no-secret release rehearsal passes. |
| Old plans appear to prescribe Umbrel/GHCR | Add supersession notes to active plans; preserve history rather than rewriting it. |
| External deletion loses recovery information | Verify clone bundles, refs, metadata manifests, and hashes before asking for permission. |
| Codeberg remains a hidden Umbrel mirror dependency | Resolve the actual mirror target and disable it before the main Codeberg exit gate. |

## Final Acceptance Criteria

- [ ] Sanctuary has one canonical online deployment: GitHub-tagged source built
  locally with the main Compose stack.
- [ ] The release command needs no registry or Umbrel credential and performs no
  registry or downstream-repository mutation.
- [ ] Forgejo remains test-only CI authority; GitHub remains a passive mirror with
  Actions disabled.
- [ ] MCP and offline installs remain supported without GHCR.
- [ ] Active product/docs/test paths contain no Umbrel or prebuilt-GHCR support;
  retained references are explicitly historical, anti-regression, or retirement
  records.
- [ ] Existing tags and Forgejo/GitHub Release objects remain intact.
- [ ] Umbrel automation and credentials are gone.
- [ ] External repositories and packages are either archived during the window or
  deleted under exact one-off approval after it.
- [ ] Codeberg retirement no longer depends on publicizing GHCR or completing an
  Umbrel update.

## Decision Record

- Chosen: retire the prebuilt GHCR path with Umbrel rather than make private
  packages public.
- Chosen: preserve the operator release command as release-object publication.
- Chosen: preserve historical Git and release evidence.
- Recommended default: 30-day read-only sunset, followed by exact-target deletion
  if total removal is still desired.
- Rejected: immediate deletion before notice, inventory, rehearsal, and backup.
- Rejected: retaining `docker-compose.ghcr.yml` as an undocumented or unsupported
  path.
- Rejected: keeping package-publisher and downstream-dispatch credentials “just in
  case.”

## Verification Notes

Planning was read-only apart from these planning documents. Evidence was collected
from current `origin/main` at `ecd16a42877bc8e696c25932d2ad4ec493b05dd2`,
tracked-file searches, installer/release scripts and tests, and read-only Forgejo,
GitHub, and Codeberg API checks. No repository, package, workflow, secret, mirror,
release, or tag was changed.

Implementation Phase 0 completed on 2026-07-31. The sanitized recovery set is
stored outside the repository at
`~/.local/share/sanctuary/recovery/umbrel-retirement-20260731-v1`; both all-ref
bundles and 33 metadata/manifest artifacts pass `git bundle verify` and
`sha256sum -c`. Forgejo and GitHub both expose v0.8.57 Release objects. The exact
Umbrel Codeberg mirror target is
`https://codeberg.org/nekoguntai-castle/sanctuary-umbrel.git`; it currently fails
with HTTP 403 and the public repository returns 404. Public GitHub code search
found no external Sanctuary GHCR consumer, one project-owned website reference to
the Umbrel repository, and no official `getumbrel/umbrel-apps` listing.
The recovery set was also scanned against every configured migration/release token
value and for credential-bearing URLs; neither was present.

Phase 1 local verification completed on 2026-07-31: root application/test/script
TypeScript and server TypeScript passed; the complete root Vitest suite passed 519
files and the complete server Vitest suite passed 477 files with 33 intentionally
skipped; release-distribution, workflow-policy, installer (101/101), migration
Compose, README-link, source/MCP Compose, and shell/Node syntax checks passed; and
the Docusaurus production build completed. `shellcheck` was unavailable to the
integrating checkout, so behavioral tests and `bash -n` are the recorded local
shell evidence pending CI's normal shell-analysis lane.

The post-implementation review also corrected same-host Compose migration
isolation, retained strict validation for optional historical container evidence,
required encryption-key restoration before the new backend starts, rejected stale
existing Release metadata, and added a detached signature over the complete
offline archive. The focused release-distribution, workflow-policy, installer,
migration-Compose, and offline-bundle suites all passed after those corrections;
the README remained deterministic and the documentation production build passed.

GitHub repository archiving preserves code and repository data in a read-only,
reversible state, which is why it is the first external-host action:
https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories

GitHub package deletion and restoration have separate constraints and can affect
dependents; treat package removal as its own exact-target operation:
https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package
