# Handoff: finish PR #1010, then cut v0.8.70-rc1, deploy to prod, promote

> **Progress update 2026-09-04 (session 01Ay2eEBo22tpgkry31p2RzU):**
> Step 1 done: #1010 merged as `fb0c7607c0`, main push CI green, branch and
> worktree removed. Step 2 done: PR #1011 (`chore: prepare release v0.8.70`)
> merged as `61850cdf88`; **`v0.8.70-rc1` tagged at `61850cdf88`** and its
> RC/install lanes are running. Release worktree
> `/home/nekoguntai/sanctuary-release-20260904072149-1087903` is retained until
> the RC verdict (release Step 6). Along the way: npm's advisory endpoint
> stalled for hours (issue #1012; the audit gate now retries per target with a
> 60 s fetch timeout and audits all lockfiles concurrently), a cleanup-supervisor
> test flake was filed as #1013, and two new high advisories in transitive
> `toml@3.0.0` were triaged and waived with build evidence (#1014).
> **rc1 verdict: FAILED** on two RC-only lanes (replay image version stamp,
> fresh-install test root; issue #1015). Fix PR #1016 is open; on merge, tag
> `v0.8.70-rc2` at its merge commit and re-run the gates.
> #1016 merged as `e9fde679d6`; `v0.8.70-rc2` (`e9fde679d6`) **failed** on four more
> RC-only regressions (replay image identity under the containerd store, RC
> fresh-install job budget vs the shared e2e lock, install-stack subject
> PROJECT_ROOT, and `start.sh --rebuild` being a silent no-op on an active
> unchanged deployment). All four are fixed with tests in PR #1017, merged as
> `8dfa83269a`; `v0.8.70-rc3` (`8dfa83269a`) failed only on the replay image's fully qualified
> tag under the containerd store; fix #1018 merged as `bb6e381ae9`. `v0.8.70-rc4` (`bb6e381ae9`) failed on the historical rc10 image's label set and
> on a starved runner lock left by a cancelled job; fix #1019 merged as
> `a58ffec712`. `v0.8.70-rc5` (`a58ffec712`) failed on the rc10 image's provenance labels (fix
> #1021 merged as `43751b2861`) and on runner `1e36ce6b`, which hangs every
> Docker-backed job since 15:12 UTC (#1015). Runner restarted; `v0.8.70-rc6` (`43751b2861`) got the replay image build and the
> RC fresh install green, then failed on the replay's own cleanup (no error
> detail) and on the combined install job's 45-minute budget on a slow host; fix
> #1022 merged as `7f5ef72cab`. `v0.8.70-rc7` (`7f5ef72cab`) got the replay images, both fresh installs, the install
> script, the rebuild, and every upgrade phase green, then failed on four more RC-only
> or operator-facing defects (Docker 29 absence wording in replay cleanup, literal-name
> container discovery, `start.sh` probing the published port, extended fixtures missing
> the legacy witness); fix #1023 merged as `be71af07ce`. **`v0.8.70-rc8` at `be71af07ce` is the ACCEPTED candidate**: release-candidate
> run 14760, install-test run 14758, and the podman canary 14759 are all green
> (2026-09-05). Pre-release stops here. Issue #1015 is closed; design follow-up is
> #1020. The release worktree stays for the eventual `/release` run's Step 6. Never
> cancel a running e2e job; push nothing while lanes run.
> **2026-09-05 canary attempt: rc8 REJECTED at deploy.** `install.sh` on the prod host refused
> the upgrade: the first-manifest inspection rejects leftover same-project resources
> (`sanctuary_tor_hidden_service` volume, Tor disabled; `sanctuary_ai-internal` network,
> renamed pre-v0.8.54). Fix PR #1024 merged as `eb135cbed7`; **`v0.8.70` SHIPPED 2026-09-05 at `eb135cbed7`** (validated as rc9; canary accepted; Release objects and 11 signed assets published on Forgejo and GitHub; receipt `~/release-receipts/v0.8.70.json`). Promote-script fix and changelog date correction landed as #1025.
> Host prep already done: backup `20260905T083434Z-v0.8.69`, checkout at the RC tag,
> Node 24.19.0 via nvm (`. ~/.nvm/nvm.sh; nvm use 24.19.0` before install.sh), canary
> scripts in `~/release-receipts/` (`canary-selftest.mjs`, `canary-probe.mjs`).
> Deploy command: `SKIP_GIT_CHECKOUT=true SANCTUARY_ASSUME_YES=true bash install.sh`
> (prod checkout already on `v0.8.70-rc9`). Then Step 4 with
> `--prepared-version 0.8.70 --commit eb135cbed7de8dd2a9660b82ca8a3368ec58dfdf`.

Written 2026-09-03 by the implement-merge session that delivered
`docs/plans/dashboard-network-status-card-redesign.md`. Everything below is
re-verifiable from Forgejo and git; treat it as a starting inventory, not truth.

## State at handoff

- `origin/main` = `525369c8a5` (PR #1008). Plan PRs merged and verified:
  #1007 → `2cab474b56`, #1008 → `525369c8a5`. Both had green main push CI.
  Their branches are deleted.
- Local checkout `/home/nekoguntai/sanctuary` is on `main` at `525369c8a5`, clean
  except untracked `tasks/pr-1002-cleanup-agent-handoff.md` (not ours) and this
  handoff + `tasks/changelog-0.8.70-draft.md`.
- Deployment directory `/home/nekoguntai/sanctuary-main` was recreated as a
  detached worktree at `525369c8a5` because the ownership store binds the local
  `sanctuary` stack to that path. Local stack was rebuilt from it and is healthy
  at revision `525369c8a5`. **Do not remove that worktree.** User does not use
  the local instance; ignore its `pool_empty` fallback state.
- **PR #1010 is OPEN**, branch `codex/implement-merge/ci-verify-vectors-podman-copy-1009`,
  head `2320c70e5a`, checked out in worktree
  `/home/nekoguntai/sanctuary/.claude/worktrees/agent-a32159d4af6901e42`.
  Contents: diagnostic-breadcrumb improvement (refs #1009), browser-e2e group
  registration for `tests/e2e/node-status-card-responsive.spec.ts`, plan
  closeout docs. Code Quality required check green; `Test Suite / Full Test
  Summary` and `Test Suite / PR Required Checks` were pending at handoff.
  The verify-vectors `npm ci` retry was deliberately dropped (workflow file is
  provenance-pinned; see memory `verify-vectors-workflow-is-provenance-pinned`)
  and issue #1009 stays open with that note.
- Prod instance `https://192.168.5.100:8443`: reachable, runs old code
  (health `version: 0.0.0`, status has no `operational`, 3-server pool,
  answered by Fulcrum). **SSH not possible with local keys** for
  nekoguntai/sanctuary/root; user was asked to authorize
  `~/.ssh/id_ed25519.pub`. Deploy path on that host is unknown until SSH works
  (expect a checkout + `./scripts/setup.sh --upgrade` or `./start.sh --rebuild`;
  confirm before acting).

## Step 1 — finish PR #1010 (serial merge discipline)

```bash
S=/path/to/scratch; # or inline the two helpers below
# Forgejo env: read FORGEJO_URL/FORGEJO_TOKEN from the forgejo-mcp entry in
# ~/.claude.json (or ~/.config/sanctuary/forge-tokens.env); API base:
API="$FORGEJO_URL/api/v1/repos/nekoguntai-castle/sanctuary"; AUTH="Authorization: token $FORGEJO_TOKEN"
curl -fsS -H "$AUTH" "$API/pulls/1010" | jq '{mergeable, merged, head: .head.sha}'
curl -fsS -H "$AUTH" "$API/commits/<head>/statuses?limit=80" | jq -r '.[] | [.status,.context]|@tsv' | sort -u
```
Required contexts: `Code Quality / Code Quality Required Checks`,
`Test Suite / Full Test Summary`, `Test Suite / PR Required Checks`. When all
three are `success` and origin/main is still `525369c8a5`:
```bash
jq -n --arg head <head> '{Do:"squash", MergeTitleField:"ci: name post-verification runner faults, register the node-status e2e spec, close out the dashboard plan (#1010)", MergeMessageField:"", delete_branch_after_merge:false, head_commit_id:$head}' \
 | curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" --data-binary @- "$API/pulls/1010/merge"
MERGE_SHA=$(curl -fsS -H "$AUTH" "$API/pulls/1010" | jq -r .merge_commit_sha)
git fetch origin main && git cat-file -e $MERGE_SHA && git merge-base --is-ancestor $MERGE_SHA origin/main && echo MERGED
```
Then wait for the 5 `push` workflow runs on `$MERGE_SHA`
(`$API/actions/runs?head_sha=$MERGE_SHA&limit=50`, status `success`), then:
```bash
git worktree remove --force /home/nekoguntai/sanctuary/.claude/worktrees/agent-a32159d4af6901e42
git push origin --delete codex/implement-merge/ci-verify-vectors-podman-copy-1009
git branch -D codex/implement-merge/ci-verify-vectors-podman-copy-1009
git worktree prune
```
If a required check fails: fix on the branch (pre-commit hooks are advisory but
read them), never merge through red, never retrigger without an issue reference.

## Step 2 — RC: run `/pre-release patch`

- Version: `0.8.69` → `0.8.70`; last stable tag `v0.8.69`; RC tag will be
  `v0.8.70-rc1` (allocate after `git fetch --tags`).
- Changelog: `tasks/changelog-0.8.70-draft.md` holds a curated `[0.8.70]`
  section; move the existing `## [Unreleased]` bullets into it and leave
  `[Unreleased]` empty with the three headings. Heading must be
  `## [0.8.70] - YYYY-MM-DD`.
- Step 1.5 upgrade audit: diff `v0.8.69..main` touches `docker-compose.yml`,
  `docker/*/Dockerfile`, `gateway/Dockerfile`, `llm-egress-proxy/Dockerfile`,
  `install.sh`, `scripts/setup.sh` (ownership/deployment-generation work,
  #989–#1005) plus `tests/install/**` (27 files) — confirm those install tests
  cover the new setup/start/upgrade paths (`optional-profiles`, container-health
  assertions) before pushing; no prisma migrations changed.
- Do NOT run install/upgrade/compose lanes locally; CI owns them.
- Expect ~2.5 h for `release-candidate.yml` + `install-test.yml` on the RC tag.

## Step 3 — deploy RC to prod and canary (needs user)

- Requires SSH to 192.168.5.100 (blocked at handoff). Confirm the host's
  checkout/upgrade mechanism before touching it; back up first
  (`scripts/create-upgrade-backup.sh` exists).
- After deploy: `GET https://192.168.5.100:8443/api/v1/bitcoin/status?network=mainnet`
  must include `operational` with `configuredMode`, `route`, and `pool`; the
  dashboard card should show the strategy badge and `N of M online`.
- Canary receipt (`sanctuary.release-candidate-canary.v2`, see
  `docs/how-to/release-candidate-canary.md`) is an operator ceremony on ≥12
  wallets; keep receipt + raw evidence outside the checkout under
  `~/release-receipts/`.

## Step 4 — stable: `/release --prepared-version 0.8.70 --commit <validated sha>`

Promotion needs the canary receipt, offline signing key
(`~/.config/sanctuary/sanctuary-offline-release-private.pem`), and
`~/.config/sanctuary/forge-tokens.env`. Follow `docs/reference/release-distribution.md`.

## Gotchas learned this session (also in memory)

- Any `package-lock.json` change breaks `tests/ci/hardwareCompatibilityReport.test.ts`.
- `.github/workflows/verify-vectors.yml` is in the address-vector provenance manifest.
- The 1 % pixel tolerance can silently keep a stale PNG baseline; use
  `--update-snapshots all` and inspect the image.
- Large-file gate: production files > 1000 lines fail `check-large-files.mjs`.
- `Verify Bitcoin Vectors` is not a required check; the podman-copy timeout is
  tracked in #1009.
