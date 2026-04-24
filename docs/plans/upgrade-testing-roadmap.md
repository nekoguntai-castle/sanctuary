# Upgrade Testing Roadmap

Date: 2026-04-23 (Pacific/Honolulu)
Updated: 2026-04-24 for the 0.8.42 2FA/encryption-material regression and release-blocking upgrade matrix.

This roadmap is based on the current repository state, not on earlier assumptions. As of drafting:

- Open PR queue is empty at the latest session check.
- Work is happening on branch `upgrade-path-hardening`.

## Current Baseline

What exists today:

- [tests/install/e2e/upgrade-install.test.sh](/home/nekoguntai/sanctuary/tests/install/e2e/upgrade-install.test.sh) now performs a real older-ref-to-current upgrade.
- The script supports:
  - `--mode core` for the focused ref-to-ref upgrade lane
  - `--mode full` for the extended local recovery scenarios
- [install-test.yml](/home/nekoguntai/sanctuary/.github/workflows/install-test.yml) and [release-candidate.yml](/home/nekoguntai/sanctuary/.github/workflows/release-candidate.yml) run the core lane through a release-blocking matrix.
- The workflows now run a blocking upgrade matrix for release candidates and release tags:
  - `latest-stable / baseline`
  - `n-2 / baseline`
  - `latest-stable / browser-origin-ip`
  - `latest-stable / legacy-runtime-env`
- The core lane seeds and validates encrypted operational 2FA state:
  - encrypted admin TOTP login after upgrade
  - encrypted secondary 2FA user login after upgrade
  - legacy plaintext 2FA secret login after upgrade
  - backup-code login, normalized backup-code input, one-time-use marking, and replay rejection
  - rejection when `ENCRYPTION_KEY` or `ENCRYPTION_SALT` drift
  - host-side 2FA reset plus API re-enrollment
- [scripts/setup.sh](/home/nekoguntai/sanctuary/scripts/setup.sh) now preserves the legacy default `ENCRYPTION_SALT` when upgrading an existing env that already has `ENCRYPTION_KEY` but no salt.
- [scripts/reset-user-2fa.sh](/home/nekoguntai/sanctuary/scripts/reset-user-2fa.sh) provides a host-side recovery path for unrecoverable 2FA encryption-material loss.
- Upgrade helper layers now exist:
  - [tests/install/utils/upgrade-fixtures.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-fixtures.sh)
  - [tests/install/utils/upgrade-source-refs.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-source-refs.sh)
  - [tests/install/utils/upgrade-assertions.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-assertions.sh)
  - [tests/install/utils/collect-upgrade-artifacts.sh](/home/nekoguntai/sanctuary/tests/install/utils/collect-upgrade-artifacts.sh)

What is still missing:

- optional-profile workflow lane after runtime cost is measured
- WebSocket browser-origin upgrade smoke once the auth/browser helper shape is stable enough for an install E2E lane
- soak data from scheduled/manual runs across the new blocking matrix
- documented source-version support window for future releases

## In-Flight PR Coordination

No open PRs currently block the upgrade harness or install workflow files. Re-check `gh pr list` before stacking additional changes onto the release gate.

## Phase Plan

### Phase 1: Stabilize Upgrade Recovery Paths

Status: implemented for the 2FA/encryption-material regression; password-drift recovery remains covered by the extended `--mode full` local lane.

Purpose:

- make the extended upgrade suite reflect the real password-drift production failure and recovery path
- keep encryption-material recovery behavior explicit enough that 2FA failures cannot hide behind generic auth failures

Exact files:

- [scripts/setup.sh](/home/nekoguntai/sanctuary/scripts/setup.sh)
- [tests/install/e2e/upgrade-install.test.sh](/home/nekoguntai/sanctuary/tests/install/e2e/upgrade-install.test.sh)
- [tests/install/README.md](/home/nekoguntai/sanctuary/tests/install/README.md)

Fixture/workload to add:

- `legacy-encryption-material`
  - start from an env with `ENCRYPTION_KEY` but no `ENCRYPTION_SALT`
  - run current setup in upgrade mode
  - verify the env gets `ENCRYPTION_SALT=sanctuary-node-config`
  - verify pre-existing encrypted 2FA still decrypts and login succeeds
- `password-drift`
  - start from a successful source install
  - drift `POSTGRES_PASSWORD` in the runtime env
  - verify repair over the Compose bridge-network path, not localhost inside the postgres container

Workflow policy:

- manual/local only until stable
- no new CI job until the production fix and the extended suite both pass reliably

Exit criteria:

- `./tests/install/e2e/upgrade-install.test.sh --mode full --source-ref <stable-tag>` passes with password drift included
- The unit suite proves existing-key/missing-salt upgrades keep the legacy default salt; the core upgrade lane proves 2FA decrypts with preserved key and salt

### Phase 2: Add Reusable Upgrade Fixtures

Status: implemented as a shell helper layer in `tests/install/utils/upgrade-fixtures.sh`. Separate fixture files are deferred until fixture bodies become large enough to justify splitting them out.

Purpose:

- stop encoding every scenario directly inside one large shell script

Implemented files:

- [tests/install/utils/upgrade-fixtures.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-fixtures.sh)

Exact files to update:

- [tests/install/e2e/upgrade-install.test.sh](/home/nekoguntai/sanctuary/tests/install/e2e/upgrade-install.test.sh)
- [tests/install/README.md](/home/nekoguntai/sanctuary/tests/install/README.md)
- [tests/install/run-all-tests.sh](/home/nekoguntai/sanctuary/tests/install/run-all-tests.sh)

Fixture definitions:

- `baseline`
  - changed admin password
  - minimal persisted state proving secrets, auth, and migration continuity
- `browser-origin-ip`
  - non-default HTTPS port
  - IP-origin browser access through nginx
  - post-upgrade login/refresh through the frontend proxy
- `legacy-runtime-env`
  - repo-local `.env` fallback path instead of external runtime dir
  - validates upgrade behavior for older installs that have not migrated
- `optional-profiles`
  - monitoring and/or Tor enabled before upgrade
  - validates profile survival and non-default compose shape
- `seeded-app-state`
  - additional user/group
  - labels
  - node config / selected mutable settings
  - at least one user-visible persisted object beyond the default admin account

Exit criteria:

- the upgrade harness accepts `--fixture <name>`
- each fixture can be invoked locally without changing the harness body again

### Phase 3: Add Post-Upgrade Smoke Assertions That Match User Traffic

Status: implemented for login, `/auth/me`, `/auth/refresh`, CSRF-protected support-package generation, and worker health. WebSocket origin smoke remains a future hardening item.

Purpose:

- verify what users actually touch after an upgrade, not only container health and migration exit codes

Implemented files:

- [tests/install/utils/upgrade-assertions.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-assertions.sh)

Exact files to update:

- [tests/install/e2e/upgrade-install.test.sh](/home/nekoguntai/sanctuary/tests/install/e2e/upgrade-install.test.sh)
- [tests/install/run-all-tests.sh](/home/nekoguntai/sanctuary/tests/install/run-all-tests.sh)

Smoke coverage to add:

- browser login through nginx-backed `/api/v1/auth/login`
- `/api/v1/auth/me` and `/api/v1/auth/refresh`
- CSRF cookie and mutation path
- worker stays healthy after upgrade, not only backend
- support bundle generation path
- optional WebSocket handshake through the browser-visible origin once #117/#119 land

Exit criteria:

- upgrade success means user-visible auth and worker readiness are both proven, not inferred

### Phase 4: Expand Workflow Coverage To A Historical Upgrade Matrix

Status: implemented as a matrix inside the existing `upgrade-test` job in both install and release-candidate workflows. The first blocking matrix uses `latest-stable/baseline`, `n-2/baseline`, `latest-stable/browser-origin-ip`, and `latest-stable/legacy-runtime-env`.

Purpose:

- move from one happy-path source version to a managed compatibility matrix

Exact files to add:

- [tests/install/utils/upgrade-source-refs.sh](/home/nekoguntai/sanctuary/tests/install/utils/upgrade-source-refs.sh)
- [tests/install/utils/collect-upgrade-artifacts.sh](/home/nekoguntai/sanctuary/tests/install/utils/collect-upgrade-artifacts.sh)

Exact files to update:

- [tests/install/e2e/upgrade-install.test.sh](/home/nekoguntai/sanctuary/tests/install/e2e/upgrade-install.test.sh)
- [tests/install/README.md](/home/nekoguntai/sanctuary/tests/install/README.md)
- [tests/install/run-all-tests.sh](/home/nekoguntai/sanctuary/tests/install/run-all-tests.sh)
- [tests/install/unit/install-script.test.sh](/home/nekoguntai/sanctuary/tests/install/unit/install-script.test.sh)
- [install-test.yml](/home/nekoguntai/sanctuary/.github/workflows/install-test.yml)
- [release-candidate.yml](/home/nekoguntai/sanctuary/.github/workflows/release-candidate.yml)

Workflow implementation:

- keep one `upgrade-test` matrix job so release summaries can treat upgrade preservation as one required gate
- add a nightly schedule to [install-test.yml](/home/nekoguntai/sanctuary/.github/workflows/install-test.yml)
- upload failed-upgrade artifacts from every matrix lane

Initial matrix:

- source refs:
  - `latest-stable`
  - `n-1`
  - `n-2`
- fixtures:
  - `baseline`
  - `browser-origin-ip`
  - `legacy-runtime-env`

Execution policy:

- the whole matrix is release-blocking before cutting the next release
- future `n-3` and `optional-profiles` lanes should start nightly/manual until signal and runtime cost are understood

Exit criteria:

- failures tell us which source version and which deployment shape regressed

### Phase 5: Capture Upgrade Failure Evidence Automatically

Status: implemented with redacted runtime env, redacted install logs, redacted service logs, compose status, safe container inspect summaries, and run metadata.

Purpose:

- make upgrade failures diagnosable without interactive shell debugging

Exact files:

- [tests/install/utils/collect-upgrade-artifacts.sh](/home/nekoguntai/sanctuary/tests/install/utils/collect-upgrade-artifacts.sh)
- [install-test.yml](/home/nekoguntai/sanctuary/.github/workflows/install-test.yml)
- [release-candidate.yml](/home/nekoguntai/sanctuary/.github/workflows/release-candidate.yml)

Artifacts to collect:

- redacted install logs from the source and target checkout
- `docker compose ps`
- redacted `backend`, `worker`, `migrate`, and `postgres` logs
- redacted runtime env summary
- safe container inspect summaries without raw container env

Artifact naming:

- `upgrade-<job-name>-<source-ref>-<fixture>`

Exit criteria:

- any failed upgrade job leaves enough evidence to reproduce the issue without asking the operator to reconstruct the environment manually

### Phase 6: Promote Upgrade Gates Deliberately

Status: promoted for the next release due to the 0.8.42 2FA lockout class. Soak data from nightly/manual runs is still required before broadening the source-version and optional-profile matrix further.

Exact files:

- [docs/reference/release-gates.md](/home/nekoguntai/sanctuary/docs/reference/release-gates.md)
- [tests/install/README.md](/home/nekoguntai/sanctuary/tests/install/README.md)
- [release-candidate.yml](/home/nekoguntai/sanctuary/.github/workflows/release-candidate.yml)

Promotion policy:

- the current four-lane matrix is release-blocking
- future lanes become blocking only after nightly/manual signal is stable and CI runtime is acceptable

## Recommended Execution Order

1. Run focused unit/syntax/YAML/lizard checks for the helper and workflow changes.
2. Run at least one local `--mode core --fixture baseline` upgrade from a stable tag.
3. Run browser-origin and legacy-runtime-env fixture lanes locally if runtime allows before release tagging.
4. Let the release-candidate workflow run the full blocking matrix on the exact commit to be tagged.
5. Use nightly/manual signal to decide whether `n-3`, `optional-profiles`, and WebSocket browser-origin lanes should become blocking in a later release.
