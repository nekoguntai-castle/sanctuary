# CI: let fresh installs build with the layer cache

Branch: `ci/cached-fresh-installs`. Follow-up to #1030 (upgrade lane), per the
"make the Upgrade Baseline lane faster" request.

## What was slow

Upgrade Baseline run 14893 (17m44s of lane time):

| phase | time | build mode |
| --- | --- | --- |
| source install (v0.8.70, "fresh") | 7m04s | `compose build --no-cache` 5m25s |
| candidate upgrade | 7m02s | `compose build --no-cache` 5m26s |

Install Script E2E run 14805: its one "fresh" install also built with
`--no-cache` (5m12s).

## Root cause

`install.sh` decides `IS_UPGRADE=true` from one fact: the runtime env file
exists (`Existing runtime env detected`). An upgrade forces
`setup.sh --upgrade`, which is `docker compose build --no-cache`.

The CI cleanup coordinator pre-created that file at prepare time with a single
marker line (`SANCTUARY_OWNERSHIP_ONLY=1`), for every lane. Nothing reads the
marker. Only coordinator-managed lanes need the file to exist before a subject
runs (their deployment definition binds the file identity and Compose gets
`--env-file`). Subject-managed lanes (install-script e2e, upgrade baseline,
extended upgrade fixtures) run an installer that creates the file itself.

So every "fresh" install in CI was classified as an upgrade and rebuilt from
scratch. A production first install builds with the cache; only the later
upgrade rebuilds. The lane deviated from production and paid ~5 minutes per
fresh install for it.

## Why not prebuilt source images

The source release's `setup.sh` is immutable and always runs `compose build`
(the only build skip is the offline-bundle install mode, which changes the
deployment's install mode and therefore what the upgrade lane tests). Loaded
images cannot short-circuit that build; a warm layer cache can. Both runner
hosts keep one: the Docker host has a persistent buildx container builder
(`buildx_buildkit_default_state` volume), the Podman 5.4 host keeps
intermediate layer images. The pinned source commit does not change between
releases, so its cached build should be near-instant on a warm host.

## Change

- `scripts/ownership/ci-cleanup-lifecycle.mjs`: subject-managed prepare only
  creates the runtime directory; the marker env file is created only on the
  coordinator-managed path (and the legacy witness fallback, which runs after
  the source install). Resume of a subject-managed lane never creates it.
- `tests/ownership/ci-cleanup-lifecycle.test.mjs`: new test pins both modes;
  subject-managed fixtures now write the env file the way the installer would.
- `tests/install/e2e/install-script.test.sh`: fails if `install.sh` reports
  `Existing runtime env detected` on the fresh install.
- `tests/install/e2e/upgrade-install.test.sh`: same assertion after the source
  install of an ownership-aware source (legacy sources use the repo-root
  `.env` flow and are unaffected).

The candidate upgrade phase still builds with `--no-cache`: that is the product
policy under test and the release `--verify-force-rebuild` gate depends on it.

## Expected effect

Source phase and install-script e2e drop from ~5.5 min of build to a cached
build; the CI timing notice will read `upgrade=false no_cache=false` for them.
Actual saving depends on the host's cache state and is read off the lane's
timing summary on the PR run.

## Verification (local)

- `node --test tests/ownership/*.test.mjs`: 482 pass, 3 skipped (pre-existing).
- `bash tests/install/unit/upgrade-helpers.test.sh`: 94 pass.
- `bash tests/install/unit/install-script.test.sh`: all pass.
- `node scripts/ownership/check-lifecycle-callsites.mjs`: registry complete.
- `bash scripts/quality/lizard-only.sh`: passed.

## PR run 14906 (2026-09-06): cache change validated, lane refused on kumo

| phase | 14893 (x300, Docker) | 14906 (kumo, Podman) |
| --- | --- | --- |
| source `compose build` | 5m25s `upgrade=true no_cache=true` | 1m16s `upgrade=false no_cache=false` |
| source phase total | 7m04s | 2m48s |
| candidate `compose build` | 5m26s no-cache | 3m18s no-cache |
| lane | 17m44s | 9m42s |

Harness passed every phase (`subjectExitStatus: 0`). The job failed because the
cleanup coordinator refused at planning: 19 resources, 1 refused with 3
results, failure classes protected/unlabeled/unregistered. Run 14886 (pre-PR
code, kumo) has the identical receipt; the lane has never passed on kumo.
Tracked as #1032 (Podman-host divergences reproduced locally: the
`ancestor=sha256:` filter matches nothing, dangling and labeled intermediate
images are hidden without `--all`, `localhost/` and `docker.io/library/` name
forms). This PR adds `refusedResources` to the coordinator's job-log summary so
the next kumo run names the refused resource.
