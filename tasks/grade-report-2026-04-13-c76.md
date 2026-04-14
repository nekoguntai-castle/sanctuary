# Software Quality Report — 2026-04-13

**Overall Score**: 78/100 (implementation-adjusted; original validated baseline was 76/100)
**Grade**: C
**Confidence**: Low
**Mode**: full
**Commit**: `dd86dd2f`

---

## Hard-Fail Blockers

None. The explicit PEM-marker validation split into two groups:

- **Allowlisted fixtures** (7): deliberately-broken PEM blocks in `server/tests/unit/services/push/providers/{apns,fcm}.test.ts` and `gateway/tests/unit/services/push/{apns,fcm}.test.ts` — explicitly listed in `.gitleaks.toml`'s `paths` allowlist.
- **Allowlisted prose hit** (1): `tasks/grade-fix-plan.md` documents PEM sentinel strings by name and is now explicitly listed in `.gitleaks.toml`'s `paths` allowlist. It is not a real credential.

`gitleaks` is not installed locally, so only allowlist-unaware rg-style checks were available during local validation. `gitleaks-action` does run in CI (`.github/workflows/quality.yml`) but is `continue-on-error: true`, so CI never fails on this signal today.

---

## Domain Scores

| Domain                  | Score     | Notes (brief) |
|-------------------------|-----------|---------------|
| Correctness             | 20/20     | Tests + typecheck + lint pass; High suppression density; High completeness |
| Reliability             | 12/15     | Typed errors + central timeouts; many middleware-guaranteed `!`, plus a few real typing gaps |
| Maintainability         | 8/15      | lizard/jscpd unknown; largest file 2825 LOC (test); clean architecture |
| Security                | 11/15     | 0 high CVEs; no JS eval/DOM injection; mixed input validation; secrets verified clean |
| Performance             | 4/10      | Cursor pagination + recent streaming; some in-loop N+1 risk |
| Test Quality            | 13/15     | Thresholds 98–100% enforced; clear AAA structure; sleeps mostly intentional |
| Operational Readiness   | 10/10     | Docker + CI + health/metrics endpoints + observability + structured logger |
| **TOTAL**               | **78/100**|               |

---

## Trend

vs 2026-04-13 (`13efff91`): original validated report was **overall +7 (69→76), grade D→C**, confidence Low→Low. The implementation-adjusted score is now **78/100** after the first-pass lint gate landed.

- **Correctness +4** (14→18): `typecheck=fail → pass` (commit `350f67c1` excluded `scripts/verify-addresses/` from root typecheck; `fc086954` stabilized coverage emission).
- **Correctness +2 after implementation** (18→20): first-pass ESLint gate added and passing.
- All other domains unchanged numerically; the remaining 7 commits delivered qualitative reliability/security/performance improvements (REPEATABLE READ snapshot on tx export, DoS cap on `POST /addresses/generate`, streamed tx export, halved device-route queries) that aren't captured by the static signal set.
- Original heuristic deltas recorded in this report: `secrets` 7→8 (originally caused by `.gitleaks.toml` + `tasks/grade-fix-plan.md` PEM sentinel text — both false positives); `timeout_retry_count` 1264→1269 (+0.4%). After the implementation pass, `.gitleaks.toml` no longer contains a PEM sentinel string and grade task files are allowlisted. I could validate the commit history and the false-positive secret hits; I could not independently reproduce the exact timeout-count heuristic from repository files alone, and no local grade script was found in the repo.

---

## Evidence

### Mechanical (tool-backed)

| Signal | Value | Tool | Criterion |
|---|---|---|---|
| tests | pass | vitest (root) | 1.1 → +6 |
| typecheck | pass | tsc | 1.2 → +4 |
| lint | pass | ESLint flat config + root/server/gateway `lint` scripts + blocking CI lint job added during implementation | 1.3 → +3 |
| coverage | ≥98% (enforced) | vitest thresholds in config (root 100, server 98–99, gateway 98–100); do not rely on stale coverage-summary artifacts for this grade | 6.1 → +5 |
| security_high | 0 | `npm audit --audit-level=high` (17 total: 16 low, 1 moderate) | 4.1 → +5 |
| secrets (effective) | 0 real | explicit PEM-marker search now finds 8 markers: 7 allowlisted fixture hits and 1 allowlisted prose hit (`tasks/grade-fix-plan.md`) | 4.2 → +2 (unknown) |
| largest_file_lines | 2825 | `server/tests/unit/api/openapi.test.ts` | 3.3 → 0 |
| lizard_warning_count | unknown | lizard not installed | 3.1 → +2 |
| duplication_pct | unknown | jscpd not installed | 3.2 → +1 |
| deploy_artifact_count | 2 | Dockerfile + `.github/workflows/` (incl. new `quality.yml`) | 7.1 → +3 |
| health_endpoint_count | 169 grep hits | rg pattern match (NOT a route count) — real endpoints: `server/src/routes.ts` registers `/health`, `/metrics`, `/api/v1/health`; `gateway/src/index.ts` registers `/health`. The 169 figure includes docs, dashboards, workflows, and comments. | 7.2 → +2 |
| observability_lib_present | 1 | `server/package.json` includes OpenTelemetry + `prom-client`; `server/src/routes.ts` exposes `/metrics` | 7.3 → +2 |

### Judged findings (ISO 25010-anchored)

- **[1.4] Suppression density — High → +4**: 25 suppressions in the scoped app/source search (`server/src components hooks services utils shared src gateway/src`, generated Prisma files excluded) — reproducible via the command in the Additional validation pass below. Nearly all have justifying comments (Electrum format variance at `server/src/services/bitcoin/electrum/publicApi.ts:155`; dynamic-table backup access at `server/src/services/backupService/restore.ts:70`). At 25 across 100+ kloc this is comfortably under the `<10/kloc` threshold for the High band. ISO Functional Appropriateness.
- **[1.5] Functional completeness — High → +3**: Direct counts found 771 TS/TSX test/spec files under `server/`, `gateway/`, and `tests/`, 785 when `e2e/` is included, and 798 with a repo-wide `.test`/`.spec` filename match. Vitest executed 386 files in the root run; the product is a mature multi-service app (wallet/device/gateway/ai) with repository + route separation enforced. ISO Functional Completeness.
- **[2.1] Error handling quality — High (inherited) → +6**: Typed `ApiError` hierarchy, centralized `errorHandler.ts:19-50`, `createLogger` + `getErrorMessage` used consistently; isolated `as any` casts do not change the pattern. ISO Fault Tolerance.
- **[2.2] Timeouts & retries — High (inherited) → +4**: Central timeout config at `server/src/services/bitcoin/electrum/clientConfig.ts:22-28`. The exact `1269` retry/timeout count from the original report was not independently reproduced; a direct `rg` with the validation pattern found 494 app-source hits and 1596 project-wide hits depending on scope. ISO Availability.
- **[2.3] Crash-prone paths — Medium → +2**: Two distinct groups of non-null assertions in prod:
    1. **Middleware-guaranteed augmentations** — `req.user!`, `req.walletId!`, etc. appear frequently across authenticated routes but are safe-by-contract because upstream middleware (`authMiddleware`, `walletAccess`) fail-fast before the handler runs. These should not be counted as crash-prone.
    2. **Genuine typing gaps** — `listTransactions.ts:26` (`walletId!`) and `as any` casts in `transactionDetail.ts:85`. The earlier `walletImportService.ts` `existingDeviceId!` target was fixed during the implementation pass with an explicit narrowing branch. ISO Fault Tolerance.
- **[3.4] Architecture clarity — High → +3**: Clear `server/src/{api,services,repositories,middleware,utils}` split, `server/ARCHITECTURE.md` enforces repository pattern. ISO Modularity.
- **[3.5] Readability / naming — High → +2**: Standardized helpers (`createLogger`, `safeJsonParse`, `getErrorMessage`, `isPrismaError`), consistent TS naming. ISO Analyzability.
- **[4.3] Input validation quality — Medium → +1**: Zod-backed `validate({body: …})` middleware used on more routes after the implementation pass (address generation, AI model pull/delete, AI suggest/query, and device account creation); other mutation routes still rely on inline body checks, e.g. `server/src/api/devices/sharing.ts:39-42` and `server/src/api/wallets/devices.ts:35-38`. ISO Integrity.
- **[4.4] Safe system/API usage — High → +3**: No JS `eval`, `innerHTML`, or `dangerouslySetInnerHTML` in app source; `execSync` only in `migrationService.ts:203`; Redis `eval()` is Lua-only at `infrastructure/distributedLock.ts:214` and in the Redis rate limiter. Prisma tagged `$queryRaw`/`$executeRaw` exists for health checks, aggregation, and maintenance; I found no unsafe string-built raw SQL (`queryRawUnsafe`/`executeRawUnsafe`). ISO Integrity.
- **[5.1] Time Behaviour — Medium → +2**: Cursor pagination + block-height caching in `listTransactions.ts:25-67`; recent streaming export improvement; but dual sequential derivation loops in `addresses.ts:63-101`. ISO Time Behaviour.
- **[5.2] Data access patterns — Medium → +1**: `transactionRepository.ts:69-100` uses compound cursors; `mobilePermissionRepository.ts:112-133` avoids N+1 via join; still some sequential post-query enrichment in `addresses.ts:114-120`. ISO Resource Utilization.
- **[5.3] Blocking in hot paths — Medium → +1**: The exact `blocking_io_count=28` number from the original report was not reproduced. Direct source search found 11 synchronous FS/exec call sites in app source, mostly startup/config/provider/migration paths (`gateway/src/index.ts`, `server/src/api/admin/version.ts`, push providers, `migrationService.ts`); none obviously execute per-request in the main wallet/transaction hot paths. ISO Resource Utilization.
- **[6.2] Test structure — High → +4**: AAA pattern, `vi.hoisted()` for isolation, meaningful names (`addresses.test.ts:50-99`, `emailService.test.ts:72-90`). ISO Testability.
- **[6.3] Edge case coverage — Medium → +1**: Happy-path + some null/config branches covered; boundary/empty-result gaps noted. ISO Functional Completeness.
- **[6.4] No flaky patterns — High (inherited) → +3**: 91 sleep/timer sites across ~771 test files (<0.12/file); sampled sites (`hookRegistry.test.ts`, `cacheInvalidation.test.ts`) are intentional hook/cache timing, not polling. ISO Testability.
- **[7.4] Logging quality — High → +3**: Application modules consistently use `createLogger()` (`addresses.ts:21`, `electrum/methods.ts:27`, `auth/login.ts:30`); structured with module prefix + request ID. The loggers themselves (`server/src/utils/logger.ts:219`, `gateway/src/utils/logger.ts:37-52`) wrap `console.*` by design, and a handful of bootstrap/config files emit direct warnings — those are the intended exceptions, not regressions. ISO Availability.

### Missing

- `lizard` — not installed locally. Install: `pip install lizard`. Note: `.github/workflows/quality.yml` already runs lizard in CI, but with `continue-on-error: true`, so the signal is advisory. Local install closes the developer feedback loop; removing `continue-on-error` makes it enforceable.
- `jscpd` — not installed locally. Install: `npm install -g jscpd`. Note: `.jscpd.json` exists (threshold 5) and `quality.yml` runs `npx --yes jscpd@4 .` in CI, also `continue-on-error: true`.
- `gitleaks` — not installed locally. Install: `brew install gitleaks` or release download. Note: `gitleaks-action` runs in CI with `config-path: .gitleaks.toml`, also `continue-on-error: true`.
- Local coverage extractor for vitest — no standalone grade/coverage extractor script was found in this repo during validation; actual thresholds are enforced by `vitest.config.ts`, `server/vitest.config.ts`, and `gateway/vitest.config.ts`.
- **No longer missing: project linter** — implemented after the initial validation pass: `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `.github/workflows/quality.yml` lint job now exist. The first-pass rule set intentionally covers the highest-signal `CLAUDE.md` checks that are clean on current source (`console.log` in production source, `catch (error: any)`, empty `catch`, and `@ts-ignore`); broader rules such as raw `JSON.parse` are still future tightening work.

---

## Finding Validation Matrix

Every row below was checked against repository files or command output during this review pass.

| Finding | Validation result | Recommendation impact |
|---|---|---|
| Hard-fail blockers / secrets | Valid with correction: explicit PEM-marker search now finds 8 markers; 7 are allowlisted push-test fixtures and 1 is allowlisted prose in `tasks/grade-fix-plan.md`. No real credential was found by the fallback search. | Keep "no hard-fail blocker"; the grade task allowlist has been added to `.gitleaks.toml`. |
| Commit and trend window | Valid: `git rev-parse --short HEAD` is `dd86dd2f`, and `git log` shows `13efff91..dd86dd2f` includes the cited quality, DoS cap, export streaming, device-query, and REPEATABLE READ commits. | Keep trend context, but treat exact grade-score deltas as original-report metadata, not independently derived in this pass. |
| Tests | Valid: `npm run test:run` passed with 386 root Vitest files and 5483 tests. | Keep Correctness credit. |
| Typecheck | Valid: `npm run typecheck` passed. | Keep Correctness credit. |
| Lint | Implemented after the initial validation gap was confirmed: root `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `quality.yml` lint job now exist. | P1 lint gate is complete for the first-pass rule set; future tightening can add broader TypeScript policy rules after baseline cleanup. |
| Coverage | Valid as config thresholds: root 100%, server 98/99/99/99, gateway 100/98/100/100. Coverage-summary artifacts exist but may be stale/partial and should not be used as the grade source. | Keep threshold credit; do not cite stale coverage-summary totals. |
| Audit | Valid: `npm audit --audit-level=high` exits clean while reporting 17 total lower-severity advisories: 16 low in the transitive `elliptic` chain and 1 moderate `follow-redirects`. | P2: run the nonbreaking `npm audit fix` path for `follow-redirects`; review the low `elliptic` chain separately because audit reports the available fix path as `npm audit fix --force` with a breaking `vite-plugin-node-polyfills` downgrade. Not a high-severity blocker. |
| gitleaks/lizard/jscpd | Valid with correction: locally not installed; CI already runs all three in `.github/workflows/quality.yml`, all with `continue-on-error: true`; `.jscpd.json` exists. | P1: make them locally runnable and enforceable after baseline tuning. |
| Largest file | Valid: `server/tests/unit/api/openapi.test.ts` is 2825 LOC and is the largest non-generated TS/TSX file found in the scoped search. | P1: split by OpenAPI domain. |
| Health endpoint count | Corrected: 169 is a grep-hit count, not a route count. Real evidence includes `/health`, `/metrics`, `/api/v1/health` in `server/src/routes.ts` and `/health` in `gateway/src/index.ts`. | Keep ops credit but avoid calling 169 "routes." |
| Suppression density | Corrected: direct source search found 25 suppressions, not 24, excluding generated Prisma files. Most have explanatory comments. | Keep as a low-risk maintainability note; lint can enforce future policy. |
| Test-file count | Corrected: 771 TS/TSX test/spec files under `server/`, `gateway/`, and `tests/`; 785 when `e2e/` is included; 798 broader `.test`/`.spec` path matches. | Do not cite a single count without naming scope. |
| Error handling | Valid: `server/src/errors/errorHandler.ts` maps Prisma and `ApiError` subclasses centrally and uses `createLogger`. | Keep Reliability strength. |
| Timeouts/retries count | Partially validated: central Electrum timeout config exists; exact `1269` count was not reproduced from file search and the local generator script was not present. | Keep strength, but cite the config rather than the exact count. |
| Crash-prone paths | Corrected: many `req.user!`/`req.walletId!` uses are middleware-guaranteed; the wallet-import `existingDeviceId!` assertions were fixed during implementation; remaining real typing gaps are the wallet transaction list `walletId!` and `as any` casts in transaction detail/list serialization. | P2: fix remaining real typing gaps only. |
| Architecture clarity | Valid: `server/ARCHITECTURE.md` documents route/service/repository layering and Prisma boundaries; `server/package.json` has `check:prisma-imports`. | Preserve; no broad refactor recommended. |
| Input validation | Valid mixed state: `server/src/api/transactions/addresses.ts` uses Zod `validate({ body: GenerateAddressesBodySchema })`; `server/src/api/ai/models.ts`, `server/src/api/ai/features.ts`, and `server/src/api/devices/accounts.ts` were migrated during implementation; remaining inline body-check examples include `server/src/api/devices/sharing.ts` and `server/src/api/wallets/devices.ts`. | P1: continue normalizing mutation request bodies onto Zod. |
| Safe system/API usage | Corrected: no JS eval/DOM injection found in app source; Redis Lua `eval` and tagged Prisma raw SQL are present; no unsafe raw SQL helpers were found. | Keep Security credit; do not claim "Prisma ORM throughout." |
| Performance/data access | Valid: cursor pagination exists in `transactionRepository.ts`; wallet transaction listing uses cached block height; address generation and enrichment loops remain sequential. | Keep medium performance score and targeted Zod/cap/loop notes. |
| Blocking I/O | Corrected: direct app-source search found 11 sync FS/exec call sites, not the original `28`; they are startup/config/provider/migration paths rather than main request hot paths. | Track, but do not make this a P1. |
| Test quality / flaky patterns | Mostly valid: sampled timer uses in hook registry and cache invalidation are intentional async/fire-and-forget timing; exact sleep-count depends on search scope. | Keep as a strength; no broad test rewrite. |
| Logging quality | Valid with exception: application modules consistently use `createLogger`; logger implementations and bootstrap/config warnings intentionally call `console.*`. | Keep strength; lint should enforce no ad hoc `console.log` in app code. |

---

## Top Risks

1. **CI quality signals are still advisory except lint.** The new lint job is blocking, but `gitleaks`, `lizard`, and `jscpd` still run in `.github/workflows/quality.yml` with `continue-on-error: true`. A regression in any of those three would merge silently until a human reads the workflow log.
2. **Largest file 2825 LOC** (`server/tests/unit/api/openapi.test.ts`) — test god-file, hurts analyzability; split by OpenAPI domain.
3. **Inconsistent input validation at mutation boundaries** — `server/src/api/ai/models.ts`, `server/src/api/ai/features.ts`, and `server/src/api/devices/accounts.ts` are now on the preferred Zod `validate({ body: ... })` pattern, but other handlers still read `req.body` and validate inline, e.g. `server/src/api/devices/sharing.ts:39-42` and `server/src/api/wallets/devices.ts:35-38`. A handler missing validation is a latent CWE-20.
4. **Genuine typing gaps** remain in `listTransactions.ts:26` and `transactionDetail.ts:85` (`as any` and non-null assertions on repository/serialization results, distinct from middleware-guaranteed `req.user!`). The wallet-import `existingDeviceId!` assertions were fixed during the implementation pass.
5. **Broader lint tightening remains.** The first-pass ESLint gate catches seeded violations for `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`; it does not yet enforce every `CLAUDE.md` rule such as raw `JSON.parse` because existing call sites need a separate baseline/fix pass.

**Not top risks** (but worth tracking):

- `follow-redirects <=1.15.11` — moderate, not high. `npm audit --audit-level=high` exits clean. Routine dependency maintenance via `npm audit fix`; do not escalate unless severity climbs.

---

## Fastest Improvements

Ordered by priority, not cost. The first two items are the ones that change the static-analysis story from "advisory" to "enforced".

### Done — Add a repo-owned lint gate
- Added `eslint.config.js` (flat config) at the repo root with a focused first-pass rule set for production source: no `console.log`, no `catch (error: any)`, no empty `catch`, and no `@ts-ignore`.
- Added `lint` scripts to root, `server/`, and `gateway/` `package.json`.
- Added a blocking `lint` job to `.github/workflows/quality.yml`.
- Correctness 1.3: `+1 → +3` (**+2 points**).

### P1 — Make the existing CI quality signals enforceable + runnable locally (~30 min + tuning)
- Install `gitleaks`, `lizard`, `jscpd` locally (Nix/Homebrew/pip/npm). Add `scripts/quality.sh` that runs the same commands as the CI jobs so developers get the signal pre-push.
- **Keep the `.gitleaks.toml` grade-task allowlist** that was added during the implementation pass: `tasks/grade-fix-plan.md` and `tasks/grade-report-2026-04-13-c76.md`. `.gitleaks.toml` itself no longer carries a literal PEM sentinel in comments, so it does not need a broad self-allowlist.
- Baseline the current lizard/jscpd output, document any intentional deltas, then remove `continue-on-error: true` from each job in `quality.yml` **per-job, not as a batch**.
- Security 4.2: `+2 → +4` (**+2 points**), contingent on the allowlist update above. Maintainability 3.1/3.2: judged `+3 → measured`, expected **+2 to +4 points** if baselines are clean, **0 to −1** if they reveal real violations (in which case the fix work is absorbed into this P1).

### P1 — Split `server/tests/unit/api/openapi.test.ts` (2825 LOC) (~1 hr)
- Partition by OpenAPI route domain (wallets, transactions, devices, auth, admin). Preserve every existing assertion verbatim.
- Maintainability 3.3: `0 → +2` (**+2 points**).

### P1 — Continue normalizing request-body validation on Zod (~2 hr across ~5 routes)
- Use `server/src/api/transactions/addresses.ts` + `server/src/api/schemas/transactions.ts` as the template (`validate({ body: Schema })` middleware, cap bounds in the schema).
- `server/src/api/ai/models.ts` `POST /pull-model` and `DELETE /delete-model`, `server/src/api/ai/features.ts`, and `server/src/api/devices/accounts.ts` were migrated during the implementation pass. Continue with remaining inline body-check offenders such as `server/src/api/devices/sharing.ts` and `server/src/api/wallets/devices.ts`, then sweep any other `if (!foo) return 400` patterns in mutation handlers.
- Security 4.3: `+1 → +3` (**+2 points**).

### P2 — Address the genuine typing gaps (~1–2 hr)
- `resolution.existingDeviceId!` in `server/src/services/walletImport/walletImportService.ts` was replaced with a proper narrowing branch during implementation.
- Replace the `!` at `server/src/api/transactions/walletTransactions/listTransactions.ts:26` with middleware-typed request shape.
- Replace `as any` casts at `server/src/api/transactions/transactionDetail.ts:85` with a proper repository return type.
- Leaves middleware-guaranteed `req.user!`/`req.walletId!` as-is (those are safe-by-contract).
- Does not move the numeric Reliability score on its own but materially reduces crash-prone surface.

### P2 — Routine dependency maintenance
- Run the nonbreaking `npm audit fix` path for the moderate `follow-redirects <=1.15.11` advisory. No score impact at the high-severity gate, but keeps the advisory list tidy.
- Review the low-severity `elliptic` transitive chain separately. Current `npm audit --audit-level=high` output reports a `npm audit fix --force` path that would install `vite-plugin-node-polyfills@0.2.0` as a breaking change, so do not force that under this quality-report cleanup.

Combined low-effort ceiling from P1 items: **≈ 86 (B)**, assuming lizard/jscpd baselines are clean.

### Execution order & dependencies

The four P1 items can largely run in parallel, but there is one sequencing rule and one short-circuit:

1. **Install tools locally first** (`gitleaks`, `lizard`, `jscpd`). Do this before anything else — it unblocks a pre-push `scripts/quality.sh` and lets you baseline without round-tripping through CI. ~10 min.
2. **Baseline the three existing CI jobs in a separate branch** before touching `continue-on-error`. If `lizard` or `jscpd` report pre-existing violations, triage them into either "fix now" or "document + add exclusion", then flip `continue-on-error: false` per-job only when each one is clean. Do NOT flip all three at once.
3. **The first-pass lint gate has landed.** Use it as the guardrail for the remaining `openapi.test.ts` split and Zod sweep work.
4. **Zod normalization sweep (P1 #4)** can now add a regression-prevention rule to `eslint.config.js` — e.g., an `no-restricted-syntax` rule flagging any function that references `req.body` without a nearby `validate({ body: … })` import, or a simpler taxonomy check that forbids destructuring `req.body` in handler function bodies. The rule should NOT try to force `validate({ body })` onto bodyless mutation handlers; it should trigger only when `req.body` is actually read.
5. **P2 typing-gap work (item #5)** can slot in any time; it's a small, isolated patch.

### Acceptance criteria per P1 item

| Item | Done when |
|---|---|
| Lint gate | Done locally: `npm run lint` exists in root + server + gateway, `.github/workflows/quality.yml` has a blocking `lint` job, and the rules fail on seeded violations for `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`. |
| CI signals enforceable | `scripts/quality.sh` runs all three tools against the repo; `quality.yml`'s `gitleaks`, `lizard`, `jscpd` jobs have `continue-on-error: false`; each job is green on `main`. |
| openapi.test.ts split | No test file under `server/tests/unit/api/` exceeds 1000 LOC; total assertion count unchanged (verified by snapshot of `describe`/`it` counts before + after). |
| Zod normalization | Every handler in `server/src/api/**` that reads `req.body` (directly or via destructure such as `const { x } = req.body`) is gated by a `validate({ body: Schema })` middleware on its route registration. Handlers with no request body (e.g. `DELETE /resource/:id`, action endpoints keyed only by URL/query params) are explicitly out of scope and do not need `validate({ body })`. The two original AI model offenders have been migrated; verify the remaining sweep by (a) reading each mutation handler that references `req.body` against its route registration, and (b) confirming remaining inline body guards have been replaced or intentionally documented. |

### Target state after P1 (projected)

The "After P1" ranges below assume P1 is run to the mid-case Maintainability band *at minimum* — that is, Execution Order item 2 ("triage lizard/jscpd violations into 'fix now' or 'document + add exclusion'") is part of P1 scope, not a follow-up. A true worst-case outcome would regress Maintainability by 1 point on net and is explicitly not the plan target; if it happens, P1 does more refactor work until it reaches mid-case.

| Domain | Current | After P1 (mid → best) | Delta | Driver |
|---|---|---|---|---|
| Correctness | 20/20 | 20/20 | 0 | First-pass lint gate already landed |
| Reliability | 12/15 | 12/15 | 0 | Unchanged (P2 typing gaps don't move the band) |
| Maintainability | 8/15 | 13 → 15/15 | +5 to +7 | See per-criterion breakdown below |
| Security | 11/15 | 13 → 15/15 | +2 to +4 | gitleaks measured (4.2) `+0 to +2`; Zod normalization (4.3) `+2` |
| Performance | 4/10 | 4/10 | 0 | No P1 item targets Performance (see rationale below) |
| Test Quality | 13/15 | 13/15 | 0 | No P1 item targets Test Quality |
| Operational Readiness | 10/10 | 10/10 | 0 | At cap |
| **TOTAL** | **78/100 (C)** | **85 → 89/100 (B)** | **+7 to +11** | Realistic mid-estimate: **~86 (B)** |

Arithmetic check (rounded, no handwaving):

- Mid-case total: 20 + 12 + 13 + 13 + 4 + 13 + 10 = **85**
- Best-case total: 20 + 12 + 15 + 15 + 4 + 13 + 10 = **89**
- Mid-estimate (lizard mid + gitleaks clean + Zod done): 20 + 12 + 13 + 14 + 4 + 13 + 10 = **86**

**Maintainability range breakdown** — 3.1 and 3.2 are currently `unknown`, and the measured band depends on what the tools find. Only mid-case and best-case are carried into the range above; worst-case is off-plan (see the paragraph above the table):

| Criterion | Current | Worst-case measured (off-plan) | Mid-case measured | Best-case measured |
|---|---|---|---|---|
| 3.1 Cyclomatic complexity (lizard warnings) | +2 (unknown) | +0 (`>15`) | +3 (`1–5`) | +5 (`0`) |
| 3.2 Duplication (jscpd %) | +1 (unknown) | 0 (`>5%`) | +3 (`<3%`) | +3 (`<3%`) |
| 3.3 Largest file (after split) | 0 | +2 | +2 | +2 |
| 3.4 + 3.5 (unchanged) | +5 | +5 | +5 | +5 |
| **Domain total** | **8** | **7** | **13** | **15** |

**Security range assumption** — the `+2` on 4.2 still depends on an actual `gitleaks` run, but the known grade-task false positives have been pre-allowlisted and the literal PEM sentinel was removed from `.gitleaks.toml` comments. If `gitleaks` still reports any non-allowlisted finding after tool installation, the strict rule `≥1 → 0 AND HARD-FAIL` should apply until the finding is fixed or proven false positive with a narrow allowlist.

**Performance rationale** — 4/10 is low but not an oversight. The recent landed commits (streamed tx export with REPEATABLE READ, capped `POST /addresses/generate`, halved device-route queries) already raised the qualitative ceiling; the next move is real measurement (request-path profiling, query-log sampling, p99 latency observation against the `/metrics` Prometheus surface), not speculative rewrites. That's a separate initiative from this audit and belongs in its own plan.

### Out of scope for this plan

Deliberately not recommended from this evidence pass:

- **Exact original heuristic counts** (`timeout_retry_count=1269`, `blocking_io_count=28`, `test_file_count=818`). Direct searches returned different numbers depending on scope, and no local generator script was found. The correct response is "name the scope next time", not "chase the heuristic".
- **Middleware-guaranteed `req.user!`/`req.walletId!` assertions**. Safe-by-contract; rewriting them adds noise without reducing crash surface. Leave them alone.
- **`follow-redirects` advisory**. Routine nonbreaking `npm audit fix`; not a P1.
- **Low `elliptic` transitive chain**. Current audit output says the available force-fix path is breaking; review separately instead of forcing it during this plan.
- **Frontend architecture or styling rewrites**. Out of the quality-audit scope and not supported by the validated findings in this report.

---

## Summary

The repo climbed from **D (69) → C (76)** on the back of the typecheck fix (`350f67c1`); the recent performance/security commits (streamed exports, DoS cap, REPEATABLE READ snapshot) reinforce the existing Reliability score even though the static signals don't move. The biggest lever to reach B is **making the static-analysis story enforced instead of advisory**: add a repo-owned ESLint gate (currently absent entirely), and remove `continue-on-error: true` from the `gitleaks`/`lizard`/`jscpd` jobs in `quality.yml` after baselining. After that, the highest-yield code work is splitting the 2825-line test god-file and finishing the Zod migration for POST-route validation.

---

## Review Notes

<!-- Add comments/decisions below this line -->

### Validated recommendation pass — 2026-04-13

Validation was done against repository files, not inferred from the report text. Commands run:

- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; output still reports 17 advisories total: 16 low and 1 moderate (`follow-redirects`).
- `command -v gitleaks`, `command -v lizard`, and `command -v jscpd` — all returned not found in this environment.
- `rg --files -g 'eslint.config.*' -g '.eslintrc*'` — no local ESLint config found before the later implementation pass.
- `wc -l server/tests/unit/api/openapi.test.ts` — 2825 lines.

#### Recommendations to carry forward

| Priority | Recommendation | Validated evidence | Notes |
|---|---|---|---|
| Done | Add a repo-owned lint gate: root `eslint.config.*`, `lint` npm script, and a CI job that runs it. | The original validation found no config/script; the implementation pass added `eslint.config.js`, root/server/gateway `lint` scripts, and a blocking `.github/workflows/quality.yml` lint job. | First-pass rules cover production-source `console.log`, `catch (error: any)`, empty `catch`, and `@ts-ignore`; broader rules remain future tightening. |
| P1 | Keep the gitleaks/lizard/jscpd recommendation, but word it as “make the CI signals enforceable and available locally,” not “install them in CI.” | `.github/workflows/quality.yml` already installs/runs `lizard`, runs `gitleaks/gitleaks-action`, and runs `npx --yes jscpd@4 .`; each job is `continue-on-error: true`. Local `command -v` checks for all three tools returned not found. `.jscpd.json` already exists with threshold 5 and exclusions. | Next step should be baseline/tune, add local scripts/docs, then remove `continue-on-error` once noise is understood. |
| P1 | Split `server/tests/unit/api/openapi.test.ts` by OpenAPI route/domain while preserving current assertions. | `server/tests/unit/api/openapi.test.ts` is 2825 LOC. Excluding generated/dist/node_modules files, it is the largest TS/TSX file found; the next largest files are also tests. | This is maintainability work, not a correctness blocker. |
| P1 | Continue normalizing request-body validation onto Zod for mutation endpoints, starting with small inline checks. | `server/src/api/transactions/addresses.ts` uses `validate({ body: GenerateAddressesBodySchema })`; `server/src/api/schemas/transactions.ts` caps `count` at 1000. `server/src/api/ai/models.ts`, `server/src/api/ai/features.ts`, and `server/src/api/devices/accounts.ts` have now been migrated; remaining examples include `server/src/api/devices/sharing.ts` and `server/src/api/wallets/devices.ts`. | Use the address-generation schema pattern as the template. |
| P2 | Reword the “crash-prone paths” finding before using it as a work item. | `rg` shows many `req.user!` and `req.walletId!` non-null assertions across authenticated/wallet-access routes, so “a few non-null assertions in prod” is not literally true. The specific `as any` hotspots in `server/src/api/transactions/walletTransactions/listTransactions.ts` and `server/src/api/transactions/transactionDetail.ts` are real. | Separate middleware-guaranteed request augmentations from unresolved repository/serialization typing gaps. |
| P2 | Keep the moderate `follow-redirects` audit item, but do not call it a high-severity security blocker. | `npm audit --audit-level=high` exits successfully; audit output still lists `follow-redirects <=1.15.11` as moderate and fixable with `npm audit fix`. | Treat as routine dependency maintenance unless a higher-severity advisory appears. |

#### Report wording corrections applied above

- The initial report corrected `quality.yml` to gitleaks/lizard/jscpd only; the later implementation pass added lint.
- Test-file counts now name their search scope instead of relying on a single broad heuristic.
- `169` is described as a health grep-hit count, not a route count.
- Logging quality now distinguishes application-module `createLogger()` use from intentional `console.*` inside logger/bootstrap/config code.
- Secret-scan wording now distinguishes the 7 allowlisted PEM fixture markers from the 1 allowlisted prose marker.

### Follow-up validation pass — 2026-04-13

Re-ran the executable checks and targeted evidence searches after updating the recommendations:

- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; still reports 17 lower-severity advisories: 16 low and 1 moderate (`follow-redirects`).
- `rg -n -o -- '-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----' ...` — now finds 7 allowlisted fixture PEM markers and 1 allowlisted prose marker after removing the literal PEM sentinel from `.gitleaks.toml` comments.
- `rg -n '\b(readFileSync|writeFileSync|appendFileSync|existsSync|statSync|readdirSync|execSync|spawnSync|execFileSync|mkdirSync|rmSync)\s*\(' ...` — found 11 app-source sync FS/exec call sites, not the original `blocking_io_count=28`.
- `rg --files -g 'eslint.config.*' -g '.eslintrc*'` and `rg -n '"lint"' -g 'package.json'` — found no project lint config or lint script before the later implementation pass.

### Additional validation pass — 2026-04-13

Re-checked the remaining file/tool/count claims against the repo after the user requested another review pass:

- `rg --files | rg '(^|/)grade(\.sh|$)|grade-tool|grade-report|grade-fix-plan'` — found only the task files; no local `grade.sh` or grade-tool script exists in the repo. Report wording now calls exact `timeout_retry_count`, `blocking_io_count`, and `test_file_count` values original heuristics rather than local facts.
- `rg -n '@ts-(ignore|expect-error)|eslint-disable' server/src components hooks services utils shared src gateway/src --glob '!server/src/generated/**' | wc -l` — found 25 suppressions in the scoped source search.
- `rg --files server gateway tests | rg '\.(test|spec)\.(ts|tsx)$' | wc -l` — found 771 test/spec files; adding `e2e/` found 785; repo-wide `.test`/`.spec` filename matching found 798.
- `rg -n 'thresholds:|branches:|functions:|lines:|statements:' vitest.config.ts server/vitest.config.ts gateway/vitest.config.ts` — confirmed root/server/gateway coverage thresholds.
- `npm run typecheck` — passed.
- `npm run test:run` — passed: 386 test files, 5483 tests.
- `npm audit --audit-level=high` — passed for the high-severity gate; still reports 17 lower-severity advisories: 16 low in the `elliptic` transitive chain and 1 moderate `follow-redirects`. The audit output says the low-chain force-fix path would be breaking, so it is not recommended as part of this cleanup.

### Implementation pass — 2026-04-13

Started implementing the validated recommendations with the lowest-risk guardrail and code-hardening slice:

- Added root `npm run quality` and `scripts/quality.sh` so the existing gitleaks/lizard/jscpd CI checks can be run locally with the same intent before making them strict in CI.
- Updated `.gitleaks.toml` to avoid a literal PEM sentinel in its own comments and to narrowly allowlist grade-report task files that document secret-scan false positives.
- Migrated `server/src/api/ai/models.ts` model-name body checks from inline guards to the shared Zod `validate({ body })` middleware, preserving the route's existing `INVALID_INPUT` error code through a new optional `code` setting in `server/src/middleware/validate.ts`.
- Migrated `server/src/api/ai/features.ts` and `server/src/api/devices/accounts.ts` from inline request-body guards to `validate({ body })` middleware while keeping the existing tested error-message expectations.
- Removed the unsafe `existingDeviceId!` assertions from `server/src/services/walletImport/walletImportService.ts` by explicitly narrowing the resolved existing device id before using it.

Verification after implementation:

- `bash -n scripts/quality.sh` — passed.
- `npm run quality` — exits `127` in this environment because `gitleaks` and `lizard` are not installed locally; the script reports the missing tools and install hints as intended.
- `npm run typecheck` — passed.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npx vitest run server/tests/unit/api/ai.test.ts server/tests/unit/services/walletImport.validation.test.ts server/tests/unit/services/walletImport.imports.test.ts --config server/vitest.config.ts` — passed: 98 tests.
- `npx vitest run server/tests/unit/api/ai.test.ts server/tests/unit/api/devices.test.ts --config server/vitest.config.ts` — passed: 132 tests.
- `npx vitest run server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts --config server/vitest.config.ts` — passed: 39 tests.
- `npm run test:run` from `server/` — all assertions passed (`344` files passed, `22` skipped; `8760` tests passed, `503` skipped), but Vitest exited nonzero because of two teardown-time dynamic-import errors from `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts`. The focused rerun of that file passed, so this is tracked as a suite teardown flake rather than a failure in the edited code.

### ESLint implementation pass — 2026-04-13

Implemented the next recommended guardrail:

- Added root `eslint.config.js` using ESLint 9, `typescript-eslint`, and `eslint-plugin-react-hooks`.
- Added root `lint`, `lint:app`, `lint:server`, and `lint:gateway` scripts; added delegating `lint` scripts in `server/package.json` and `gateway/package.json`.
- Added a blocking `lint` job to `.github/workflows/quality.yml`.
- Fixed the real empty-catch findings the new gate surfaced by adding debug-level structured logging or explicit expected-failure handling in app/server/gateway production source.
- Kept the first-pass rule set intentionally narrow so the gate is enforceable now: no `console.log` in production source, no `catch (error: any)`, no empty `catch`, and no `@ts-ignore`.

Verification after ESLint implementation:

- `npm run lint` — passed.
- `cd server && npm run lint` — passed.
- `cd gateway && npm run lint` — passed.
- `npm run typecheck` — passed.
- `npx tsc --noEmit -p server/tsconfig.json` — passed.
- `npx tsc --noEmit -p gateway/tsconfig.json` — passed.
- `npm run test:run` — passed: 386 files, 5483 tests.
- `cd gateway && npm run test:run` — passed: 19 files, 510 tests.

Not completed in this pass:

- The CI `continue-on-error: true` flags were not flipped because the local `gitleaks` and `lizard` baselines cannot be run until those tools are installed.
- The full Zod normalization sweep remains pending; the next verified inline examples are `server/src/api/devices/sharing.ts` and `server/src/api/wallets/devices.ts`.
- The `openapi.test.ts` split remains pending.
