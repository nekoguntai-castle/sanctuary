# Sanctuary — Lessons

Patterns to remember from CI corrections, surprising debugs, and reviews. Written terse so future-me can scan quickly. Each entry: rule, why, how to apply.

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
- After a mistaken approval, remove the matching line from `/home/nekoguntai/.codex/rules/default.rules` and verify no broad destructive rule remains.

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

**Why:** The user corrected the workflow after repeated `TMPDIR=/home/nekoguntai/sanctuary/.tmp-gh gh ...` commands required changing approvals for each PR/check/run variant.

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
