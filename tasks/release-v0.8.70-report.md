# Release v0.8.70 — 2026-09-05

Stable tag `v0.8.70` at `eb135cbed7de8dd2a9660b82ca8a3368ec58dfdf`, validated as
`v0.8.70-rc9`. Published on Forgejo (release id 295) and GitHub (release id
383348250) with the 11-asset signed set. Receipt: `~/release-receipts/v0.8.70.json`.

## Publication gates

| Gate | Status | Evidence |
| --- | --- | --- |
| 1. GitHub Actions disabled | met | `actions/permissions` → `enabled: false` |
| 2. Tag parity (peeled) | met | Forgejo and GitHub `v0.8.70^{}` both `eb135cbed7…` |
| 3. Release objects on both providers | met | Forgejo 295, GitHub 383348250, neither draft/prerelease |
| 4. Source installer resolves the stable tag | met, read-only | `releases/latest` → `v0.8.70 assets=11`; cold anonymous clone at `v0.8.70` → `eb135cbed7`, `package.json` 0.8.70; published `install.sh` sha256 `d2f35489…` matches `SHA256SUMS`. Residual gap: no cold-cache local install was run (CI's Fresh Install E2E and Install Script E2E cover the same commit). |
| 5. Signed asset set byte-verified | met | `release:publish-assets` verified 11 assets on both providers; receipt written |

## Upgrade-path coverage and matrix refs

- Diff since `v0.8.69`: 30 commits, 487 files; the upgrade-relevant surface is the
  ownership/cleanup rework (`scripts/ownership`, `docker/compose`, `install.sh`,
  `start.sh`) plus `tests/install/**` (fixtures, assertions, unit tests) added
  alongside it. No Prisma migrations changed.
- Matrix source refs on rc9: `latest-stable` (v0.8.69) and `n-2` (v0.8.68),
  both green in Install Tests run 14777 (Upgrade Baseline, Upgrade Extended
  Fixtures, Upgrade Extended).
- Coverage added during the RC cycle, all in fix PRs #1016–#1024: legacy
  fixture witness for extended fixtures, compose-project container discovery,
  Docker 29 absence wording in replay cleanup, containerd image identity and
  provenance labels for the replay image, RC workspace/test-root handling,
  and the unowned-leftover retention rule for first-manifest inspection.

## RC cycle: 9 RCs, 9 fix PRs

| RC | Result | Fix |
| --- | --- | --- |
| rc1–rc7 | RC-only or operator-facing regressions from the ownership rework | #1016, #1017, #1018, #1019, #1021, #1022, #1023 |
| rc8 | all CI gates green; production deploy refused by first-manifest inspection on leftover same-project Docker resources (Tor volume from a disabled profile, `ai-internal` network renamed pre-v0.8.54) | #1024 |
| rc9 | all gates green (runs 14777/14778/14779); production canary accepted | — |

Post-tag tooling fix #1025: `promote-release.sh` assumed annotated RC tags
(peeled `^{}` ref); lightweight RC tags now promote when identical. The same PR
dated the `[0.8.70]` changelog heading from the tag (2026-09-05) and added its
comparison link, which the release-distribution test suite requires.

## Production canary (rc9, 192.168.5.100)

- Fleet of 15 wallets, all previously stale (last synced 2026-08-31). All-wallet
  sync: 15 requested, 15 success, 0 retrying, 0 action required. Stale repeat on
  one wallet: success, not stranded.
- Endpoints over 653 samples (345 post-terminal): 0 failures; p99 live 14 ms,
  ready 17 ms, metrics 18 ms. Worker peak 262 MB of 1 GiB, no restarts/OOM.
- Diagnostics v2 observed with address-history active and Redis lock agreement;
  terminal active total 0; all seven counter families and active-stage age
  present. No candidate work (durable reconciliation completed without a
  candidate stage), no silent hang.
- First probe attempt hit the post-deploy wallet-sync activation gate (all 15
  admissions rejected, single-wallet 503); the probe now retries admission.
  Receipt and raw evidence: `~/release-receipts/v0.8.70-rc9-canary/`.

## Host and process notes

- Prod host required Node 24 (new setup.sh prerequisite); installed 24.19.0 via
  nvm for user `azayaka`. Backup taken before the rc8 attempt
  (`20260905T083434Z-v0.8.69`); the rc9 upgrade ran through `install.sh` with
  `SKIP_GIT_CHECKOUT=true SANCTUARY_ASSUME_YES=true`. Host now runs rc9 images
  labelled `eb135cbed7` / `v0.8.70-rc9` (same commit and bytes as the stable tag).
- Stable tags do not rerun `install-test.yml`; the rc9 runs are the accepted
  evidence per `docs/reference/release-distribution.md`.
- Kept locally until the operator confirms: `~/release-assets/v0.8.70` (1.2 GB)
  and `~/release-assets/v0.8.70-rc9-rehearsal` (1.2 GB). Keep the receipt.
- Design follow-up for late-cycle RC cost remains open as #1020.
