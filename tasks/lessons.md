# Sanctuary — Lessons

Patterns to remember from CI corrections, surprising debugs, and reviews. Written terse so future-me can scan quickly. Each entry: rule, why, how to apply.

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
