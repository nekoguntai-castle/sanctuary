# /grade Fix Plan — commit 13efff91 (revised)

Source: Codex verification + planning pass on the 2026-04-13 `/grade` audit, then a code-anchored review against actual source files. Every line number and code claim below was verified by reading the file at this commit.

Scope: only items that survived independent verification. Dropped items (`findByIdWithAccess` "no index", `readFileSync` in `version.ts`, `countEligibility` collapse) remain excluded.

---

## Tier 1 — Unblock the typecheck gate (lifts grade cap from D)

### 1.1 Make the verify-addresses standalone package typecheck itself — and verify it actually runs

**Reality check first.** Before treating this as "preserve a deliberate `bip32@^4` pin", note what's actually in the repo:

| File | `bip32` | `bitcoinjs-lib` | `@types/node` | `typescript` |
|---|---|---|---|---|
| `scripts/verify-addresses/package.json` (lines 12–24) | `^4.0.0` | `^7.0.1` | `^22.0.0` | `~6.0.2` |
| `scripts/verify-addresses/package-lock.json` (lockfileVersion 3, lines 10–22) | `^4.0.0` | `^6.1.5` | `^20.10.0` | `^5.3.0` |

Three of four deps drift by a major version. The lockfile was never refreshed after spec updates. The companion CI step at `.github/workflows/verify-vectors.yml:113-117` is literally:

```yaml
- name: Generate vectors with Bitcoin Core
  working-directory: scripts/verify-addresses
  run: |
    echo "Vector generation would run here"
    echo "This requires the verify-addresses infrastructure to be set up"
  continue-on-error: true
```

So the "standalone package" has never been wired up end-to-end. The fix is *repair*, not *preservation*.

**What to change:**

- `tsconfig.scripts.json` — add `"scripts/verify-addresses/**"` to the `exclude` array (lines 7–14 today, six entries: `node_modules`, `server`, `gateway`, `ai-proxy`, `tests`, `e2e`). The `include` block is at lines 3–6 and currently picks up everything under `scripts/`.
- `scripts/verify-addresses/package.json` — add a `"typecheck": "tsc --noEmit"` to the scripts block (lines 6–11). Since the package declares `typescript: ~6.0.2` (which **does** publish — `npm view typescript@~6.0.2 version` returns `6.0.2`), this works once deps are installed.
- `scripts/verify-addresses/package-lock.json` — regenerate: `npm --prefix scripts/verify-addresses install --package-lock-only`. Then commit the diff and explicitly inspect it: with three majors of drift, you're effectively choosing new versions, not refreshing a stale lock.
- **Verify the package actually runs**, not just typechecks: `cd scripts/verify-addresses && npm ci && npx tsx generate-vectors.ts --verify-only`. If `bip32@^4`'s factory API is incompatible with `bitcoinjs-lib@^7`, this will fail at runtime — fix it now or admit the standalone package is dead and delete it instead.
- `package.json` — at line 42 (`typecheck:scripts`), keep the root tsc invocation (now scoped to scripts *outside* `verify-addresses`) and add a follow-up step that runs the standalone package's typecheck: either chain via `&& npm --prefix scripts/verify-addresses run typecheck`, or split into a new `typecheck:scripts:all` script that runs both.
- `.github/workflows/verify-vectors.yml` — line 109 (`npm ci` in the regenerate job) currently has `continue-on-error: true` on line 110. Once the lockfile is fixed, remove `continue-on-error` from the install step. Line 117 has the same flag on the placeholder `echo` step; replace that with a real generation invocation (or delete the regenerate-vectors job entirely if you confirm the package is dead). The normal `verify-vectors` job at lines 29–78 only installs `server` deps and never touches the standalone package.

**Decision point:** if running `npx tsx generate-vectors.ts --verify-only` fails after the lockfile refresh, the cleanest fix is to **delete `scripts/verify-addresses/` and the `regenerate-vectors` workflow job**. The current state — broken lockfile, placeholder CI, typecheck failures — is worse than not having the package.

**Why this approach:** Stops blocking the grade gate while forcing an honest answer to "is this code alive?" Avoids enshrining a non-functional sub-package by adding a typecheck script over rotted deps.

**Verify:**
```
npm ci
npm --prefix scripts/verify-addresses install --package-lock-only
npm --prefix scripts/verify-addresses ci
npm --prefix scripts/verify-addresses run typecheck
npm run typecheck:scripts
# Smoke-test that the script works at runtime, not just types:
cd scripts/verify-addresses && npx tsx generate-vectors.ts --verify-only
# Re-run the affected vector tests that the workflow already gates:
cd ../../server && npm run test -- \
  tests/unit/services/bitcoin/addressDerivation.verified.test.ts \
  tests/unit/services/scriptTypes/derivationPaths.test.ts \
  tests/unit/services/bitcoin/multisigKeyOrdering.test.ts \
  tests/unit/services/bitcoin/xpubValidation.test.ts \
  tests/unit/services/bitcoin/propertyBased.test.ts \
  tests/unit/services/bitcoin/descriptorChecksum.test.ts \
  tests/unit/services/bitcoin/psbt.verified.test.ts \
  tests/unit/services/bitcoin/psbt.property.test.ts
```

**Effort:** ~1.5–2 hr (the runtime smoke test plus possible deletion path adds time over the original 1 hr estimate).
**Risk:** medium. The dep drift is severe enough that the "refresh lockfile" step is really "choose new versions"; runtime breakage is plausible.

---

## Tier 2 — Real bugs / risks worth fixing

### 2.1 Stream the transaction export

**What to change:**

- `server/src/api/transactions/walletTransactions/exportTransactions.ts:42` — replace `findForExport` + the `.map` (lines 49–68) and the `res.json(exportData)` / `res.send(csv)` finishers (lines 76, 125) with a streamed response. Today: default CSV via `res.send(csv)`; `format=json` via `res.json(exportData)`.
- Add a paged internal helper near `server/src/repositories/transactionRepository.ts:414` (current `findForExport`). It must use `take` and a **composite keyset cursor that includes both `blockTime` and `createdAt`** — pending transactions have `blockTime=null` *and* the export emits `tx.createdAt.toISOString()` as their date (`exportTransactions.ts:54`), so a cursor on `blockTime` alone will skip or duplicate rows in the pending segment. Suggested ordering: `ORDER BY (blockTime IS NULL), blockTime ASC, createdAt ASC, id ASC`, with an opaque cursor carrying `(blockTime, createdAt, id)`. An equally clean alternative is to **split confirmed and pending into two streams** and concatenate them — simpler keyset, no null-handling gymnastics.
- **Drop the `transactionLabels` include from `findForExport`.** I verified the export at `exportTransactions.ts:63` only reads the scalar `tx.label` column (which exists on the Transaction model — `prisma/schema.prisma:347`). The `transactionLabels: { include: { label: true } }` join at `transactionRepository.ts:423-429` is dead — fetched on every export, never read. Removing it cuts per-row payload, simplifies streaming, and is a free win independent of pagination.
- Stream CSV by yielding the header then escaped rows. Stream JSON as `[` + comma-joined serialized objects + `]` — track an `isFirst` boolean for comma placement; a wrong comma kills the whole download.
- Use `Readable.from(asyncGenerator)` with `pipeline()`, or `res.write()` plus `await once(res, 'drain')` for backpressure. Stop on `req.aborted` / destroyed responses.
- Keep the frontend's `apiClient.download()` call at `src/api/transactions/transactions.ts:72-86` exactly as-is — that's why we stream rather than paginate.

**Why this approach:** Preserves the one-shot download contract while removing the unbounded server-memory risk. The composite cursor matters because `blockTime` is nullable for pending transactions and the export uses `createdAt` as the fallback date. Dropping the unused `transactionLabels` include is independently worth doing.

**Verify:**
```
cd server && npx vitest run \
  tests/unit/api/transactions-http-routes.test.ts \
  tests/unit/api/openapi.test.ts
# DB-backed (if available):
cd server && npm run test:integration -- tests/integration/flows/transactions.integration.test.ts
```

**Effort:** 2–3 hr.
**Risk:** medium. Watch JSON comma correctness, CSV escaping parity with the current `escapeCSV` (lines 96–103), the nullable-`blockTime` cursor, mid-stream errors after headers (you can't change status code), and the frontend's 120s file-transfer timeout.

### 2.2 Add Zod schemas to AI / address handlers — and fix the address DoS while you're there

**The DoS finding:** `server/src/api/transactions/addresses.ts:215` reads:

```ts
for (let i = maxReceiveIndex + 1; i < maxReceiveIndex + 1 + count; i++) {
```

with the same loop again at line 238 for change addresses. There is **no upper bound on `count`** in the handler today. A request with `{ count: 1000000 }` derives 2 million addresses (each call goes through `addressDerivation.deriveAddressFromDescriptor`, which is CPU-bound) and then bulk-inserts them. This is a user-reachable DoS for any caller with `edit` access on the wallet. **The Zod schema must add `.max(N)`** (suggest 1000 — the existing default is 10).

The handler also has a **type coercion bug**: if a client sends `{"count": "5"}`, JavaScript evaluates `maxReceiveIndex + 1 + "5"` as a *string* (`"15"`), not a number. The loop bound becomes a string and the iteration logic falls apart. The fix is to **reject non-number input outright** with `z.number().int()` — *do not* use `z.coerce.number()` here. Coercion would silently accept `"5"` and paper over the real bug; rejection forces clients to send proper JSON numbers.

**What to change:**

- Add request schemas under the existing **`server/src/api/schemas/`** directory (alongside `admin.ts`, `auth.ts`, `common.ts`, `email.ts`). Create `server/src/api/schemas/ai.ts` and `server/src/api/schemas/transactions.ts` (or extend an existing file if there's overlap). **Do not** put request schemas under `server/src/api/openapi/schemas/` — that directory is for OpenAPI document generation, not request parsing.
- Wire schemas through the existing **`server/src/middleware/validate.ts`** middleware. It already supports `validate({ body, params, query })` and replaces `req.body` with the parsed value — every Zod handler in the codebase already uses this pattern. Don't roll a new validation entry point.
- `server/src/api/ai/features.ts:29` — `validate({ body: z.object({ transactionId: z.string().min(1) }) })`.
- `server/src/api/ai/features.ts:72` — `validate({ body: z.object({ query: z.string().min(1), walletId: z.string().min(1) }) })`.
- `server/src/api/ai/models.ts:51` and `:74` — `validate({ body: z.object({ model: z.string().min(1) }) })`. Both routes already have `requireAdmin` (lines 50 and 73), so the risk is low, but the schemas are still worth adding for consistency. **Keep DELETE body support** — Express does parse DELETE bodies; the `validate` middleware handles them identically; do not switch to query params.
- `server/src/api/transactions/addresses.ts:179` — the body is optional today (`const { count = 10 } = req.body`). Use `validate({ body: z.object({ count: z.number().int().min(0).max(1000).default(10) }).default({}) })` so a missing body still produces `{ count: 10 }`. **`.max(1000)` is the security fix** — without it the schema is decorative. **No `.coerce`** — rejecting `"5"` is the type-safety fix, not a regression.
- `server/src/api/openapi/schemas/transactions.ts:153` — currently `count: { type: 'integer', minimum: 1, default: 10 }`. Change `minimum` to `0` (matches the existing integration test at `server/tests/integration/flows/transactions.integration.test.ts:458-472`, which sends `{ count: 0 }` and expects 200 with comment "API allows count=0 (generates nothing)") and add `maximum: 1000` to mirror the Zod cap.

**On the `count: 0` policy:** the integration test enshrines `count: 0` as a valid no-op. That's a real product decision documented inline at line 462. The plan tightens OpenAPI to match the test rather than the other way around. Acceptable.

**Why this approach:** Adds real request contracts, plugs an actual DoS vector, and fixes a latent string-coercion bug. The OpenAPI/test/handler/Zod all line up afterward.

**Verify:**
```
cd server && npx vitest run \
  tests/unit/api/ai.test.ts \
  tests/unit/api/transactions-http-routes.test.ts \
  tests/unit/api/transactions-addresses-routes-extended.test.ts \
  tests/unit/api/openapi.test.ts
# And the count=0 contract:
cd server && npm run test:integration -- tests/integration/flows/transactions.integration.test.ts
```

**Effort:** 1.5–2 hr (the upper-bound + coercion fix is the bulk; the AI handlers are 5-line schemas).
**Risk:** low. Watch exact `INVALID_INPUT` error messages expected by tests and avoid `.strict()` if extra fields were previously ignored. The DoS fix may break callers passing `count > 1000` — search for any internal scripts that do that before merging.

### 2.3 Resource-access middleware: pick one of two approaches (not the one originally proposed)

**Verified facts before deciding:**

I read `server/src/middleware/resourceAccess.ts` (lines 59–89), `walletAccess.ts:31-46`, `deviceAccess.ts:29-42`, `services/accessControl.ts:119-253`, and `services/deviceAccess.ts:72-119`. The actual cost asymmetry is:

| Path | `checks.view` calls | `getRole` calls | DB queries per request |
|---|---|---|---|
| **Wallet** (cached) | `hasWalletAccess` → `getUserWalletRole` (cached, 30s TTL, key `${userId}:${walletId}`) | `getUserWalletRole` (same cache hit) | **1 cold DB query, then 0 + 1 cache hit per warm request** |
| **Device** (NOT cached) | `checkDeviceAccess` → `getUserDeviceRole` → `findDeviceUser` + `findGroupRoleByMembership` (no cache) | `getUserDeviceRole` again → 2 more queries | **4 DB queries per request, every request** |

The original plan said "merge the two calls into one" and rejected adding device caching as too risky. That's defensible but understates the gap: **the wallet path is already cheap, and the device path is the actual problem.** There are two viable fixes:

**Option A — Merge the calls (original plan).** Change the `ResourceAccessConfig` contract so `checks` are synchronous predicates over the role (`Record<TLevel, (role: TRole | null) => boolean>`), and only `getRole` hits the database. The middleware (`resourceAccess.ts:59-77`) makes one call to `getRole`, runs the predicate against the result, attaches the role, and continues. Wallet routes save one cache lookup; device routes drop from 4 DB queries to 2. Effort 1–2 hr. Risk: middleware contract change touches both wallet and device wiring; tests for `walletAccess.test.ts`, `deviceAccess.test.ts`, and the resource-access factory all need updates.

**Option B — Cache `getUserDeviceRole` like `getUserWalletRole`.** The wallet cache pattern at `accessControl.ts:119-158` is already proven, with invalidation hooks at `accessControl.ts:37-72`. Mirror it for devices: cache key `${userId}:${deviceId}`, 30s TTL, invalidate on device share/unshare/group-membership changes. Then *also* do Option A — together they drop device routes from 4 → 0 DB queries on warm requests. The original plan rejected this for "cache invalidation risk", but the wallet cache already solves the same problem with the same invariants (group membership, sharing). Effort 2–3 hr. Risk: you must wire invalidation into every code path that mutates `DeviceUser`, group membership for devices, or device sharing — `grep -rn "deviceRepository\..*\(create\|update\|delete\)" server/src/services` to find them all before merging.

**Recommendation:** **Option A is the right single-PR fix.** It's smaller, doesn't add new infrastructure, and gives the bulk of the win for device routes. Option B can be a follow-up if profiling shows device-route latency is still a concern.

**What to change for Option A:**

- `server/src/middleware/resourceAccess.ts:11-24` — change `ResourceAccessConfig` to be parameterized by **both** the level union and the typed role:
  - `ResourceAccessConfig<TLevel extends string, TRole>`
  - drop `checks: Record<TLevel, (id, userId) => Promise<boolean>>`
  - add `predicates: Record<TLevel, (role: TRole) => boolean>` (synchronous, role-typed)
  - typed `getRole: (id: string, userId: string) => Promise<TRole>` (no separate `| null` — `WalletRole` and `DeviceRole` already include `null` in their type definitions: `server/src/services/wallet/types.ts:13` defines `WalletRole = (typeof WALLET_ROLE_VALUES)[number] | null`, and `DeviceRole` follows the same pattern in `server/src/services/deviceAccess.ts`)
- `server/src/middleware/resourceAccess.ts:59-77` — call `getRole` once, run `predicates[level](role)`, return 403 if false, attach role to the request, call `next()`.
- `server/src/middleware/walletAccess.ts:31-46` — replace `checks: { view, edit, approve, owner }` with `predicates: { view: r => r !== null, edit: r => r !== null && EDIT_ROLES.includes(r), approve: r => r !== null && APPROVE_ROLES.includes(r), owner: r => r === 'owner' }`. **Important: import `EDIT_ROLES` and `APPROVE_ROLES` from `server/src/services/wallet/types.ts:39,42` — they are exported there.** The same constants in `server/src/services/accessControl.ts:18,21` are *not* exported (declared with bare `const`); using them would be a private-symbol import. Add a small drift-catching test that asserts the two definitions are equal so a future divergence in `accessControl.ts` is caught at test time.
  - **Even better**: don't reimplement the role logic at all in the middleware wiring — call the existing exported helpers from `accessControl.ts` (`hasWalletAccess`, `checkWalletEditAccess`, `checkWalletApproveAccess`, `checkWalletOwnerAccess`) but adapt them to the synchronous-predicate shape. They already encapsulate the `EDIT_ROLES.includes(role)` logic. The trade-off: each helper currently re-fetches the role inside, so you'd want a thin sync variant that takes a pre-fetched role. Pick the path that produces fewer indirection layers.
- `server/src/middleware/deviceAccess.ts:29-42` — same pattern: `predicates: { view: r => r !== null, owner: r => r === 'owner' }`.

**Why this approach over Option B:** smaller change, no new cache invalidation surface, and still saves 2 DB queries per device request. Option B is strictly better but bigger.

**Verify:**
```
cd server && npx vitest run \
  tests/unit/middleware/deviceAccess.test.ts \
  tests/unit/middleware/walletAccess.test.ts \
  tests/unit/services/deviceAccess.test.ts \
  tests/unit/services/accessControl.test.ts
```

**Effort:** 1–2 hr.
**Risk:** medium. Watch generic middleware behavior, status codes (still 401/403/500 in the same conditions), and that `walletRole` / `deviceRole` are still attached identically. The factory contract change ripples to both wrappers and any other consumer of `createResourceAccessMiddleware` — run `rg -n "createResourceAccessMiddleware" server/src` to confirm only walletAccess and deviceAccess use it. If you decide to also pursue Option B later, find every device-mutation site with `rg -n "deviceRepository\\..*(create|update|delete)" server/src/services` and wire cache invalidation into each.

---

## Tier 3 — Tooling and observability uplift

### 3.1 Install gitleaks / lizard / jscpd

Unchanged from the original plan — these are install-and-wire items with no code-correctness claims to verify.

- **What to change:**
  - Add quality scripts in root `package.json:9-46` (the `scripts` block ends at line 46). Add a new `.github/workflows/quality.yml`.
  - `gitleaks detect --source . --redact --no-banner` (CI-installed via release download or `gitleaks/gitleaks-action@v2`).
  - `python -m pip install lizard && lizard ...` — lizard is not native npm, install via pip in CI.
  - `npm install --save-dev jscpd` with a `.jscpd.json` exclusion list (must exclude `**/generated/**`, `**/coverage/**`, `**/dist/**`, `**/node_modules/**`, `server/tests/fixtures/**`).
  - Start nonblocking or scheduled (weekly cron) until baseline exclusions are tuned; promote to required check after one or two iterations.
- **Why:** Real measurements over rg-fallback false positives. Fixes the "Low confidence" line on every future `/grade` run.
- **Verify:** Run each tool command locally first, then dry-run the workflow on a PR. Expected CI cost: gitleaks <1m, lizard <1m, jscpd 1–3m.
- **Effort:** ~2 hr.
- **Risk:** low (nonblocking start). Watch fixture false positives (the same `-----BEGIN PRIVATE KEY-----` test fixtures gitleaks would also flag — needs an allowlist), and generated-code duplication noise.

### 3.2 Generate `coverage-summary.json` for server and gateway

**What to change:**

- `server/vitest.config.ts:23` — current value: `reporter: ['text', 'lcov', 'html'],`. Add `'json-summary'`: `reporter: ['text', 'lcov', 'html', 'json-summary']`. Note: the *previous* version of this plan said line 24, which is `reportsDirectory: './coverage'` — wrong line.
- `gateway/vitest.config.ts:22` — current value: `reporter: ['text', 'lcov', 'html'],`. Same change. Previous plan said line 23 — wrong line.
- **Do not** add `--reporter=json-summary` as a CLI flag; that's the wrong vitest flag. The correct CLI form (if needed) is `--coverage.reporter=json-summary`. Config-only is cleaner.
- Server has nontrivial coverage thresholds at `server/vitest.config.ts:45-52` (branches 98, functions 99, lines 99, statements 99) — adding a reporter doesn't affect them, but anyone touching this file should know they're there before nudging anything else.
- CI workflows that already look for `server/coverage/coverage-summary.json` and `gateway/coverage/coverage-summary.json` start working automatically once the file exists.

**Why:** One config change fixes local, CI, and the grade.sh signal. Anchored to the actual line numbers of the reporter array, not the directory line that follows it.

**Verify:**
```
cd server && npm run test:coverage && test -f coverage/coverage-summary.json
cd gateway && npm run test:coverage && test -f coverage/coverage-summary.json
```

**Effort:** ~15 min.
**Risk:** low.

---

## Recommended execution order

1. **PR 1 — Typecheck gate** (Tier 1.1). Standalone. Lifts the grade cap. **Includes the runtime smoke test of `verify-addresses` and a go/no-go on deleting it if it doesn't run.**
2. **PR 2 — Coverage summary config** (Tier 3.2). Can batch with PR 1 or follow immediately. 15 min.
3. **PR 3 — Address generation DoS fix + Zod schemas** (Tier 2.2). **Promote this above export streaming** — the unbounded `count` on `/addresses/generate` is a concrete, user-reachable DoS, and the fix is small. The AI handler schemas can go in the same PR or a follow-up; they're admin-only so the order doesn't matter.
4. **PR 4 — Transaction export streaming** (Tier 2.1). Standalone — touches API + repository contract.
5. **PR 5 — Resource-access middleware refactor** (Tier 2.3, Option A). Standalone — touches shared authz plumbing.
6. **PR 6 — Quality tooling** (Tier 3.1). Last, initially nonblocking until baselines are tuned.

---

## Changes from the previous version of this plan

- **Tier 1**: corrected line numbers (3 of 4 were wrong); reframed `bip32@^4` from "deliberate pin" to "stale lockfile across multiple major drifts"; added a runtime smoke test as a verify step; added an explicit "delete the package if it doesn't run" decision point. Fixed entry count for the `tsconfig.scripts.json` exclude array (six, not four).
- **Tier 2.1**: spelled out the composite cursor (`blockTime`, `createdAt`, `id`) — `createdAt` matters because pending rows export it as their date; offered the alternative of splitting confirmed and pending into two streams. **Identified `transactionLabels` include as dead code** — the export only reads scalar `tx.label`, so the join can be removed for a free perf/memory win independent of streaming.
- **Tier 2.2**: **added the `count` upper-bound DoS fix** as the most important item in the whole plan; documented the string-coercion bug at `addresses.ts:215`; promoted this PR above the export streaming. **Removed the `.coerce` suggestion** — rejecting `"5"` outright with `z.number().int()` *is* the type-safety fix; coercion would paper over the bug. Pointed at the existing `server/src/api/schemas/` directory and `server/src/middleware/validate.ts` middleware so this PR follows the established pattern instead of inventing a new one.
- **Tier 2.3**: presented Option A vs Option B with measured DB-query counts; recommended Option A; contract-level change spelled out as `ResourceAccessConfig<TLevel, TRole>` with synchronous predicates over a typed role (and noted that `WalletRole` / `DeviceRole` already include `null` in their type definitions, so no `| null` should be added). **Corrected the role-constant import source**: `EDIT_ROLES`/`APPROVE_ROLES` are private in `accessControl.ts` (bare `const`) but exported from `server/src/services/wallet/types.ts:39,42` — that's the right import path, plus a drift-catching test against the private copies. Replaced the `grep` blast-radius command with `rg`.
- **Tier 3.2**: corrected the line numbers (off by one in both files); kept the CLI-flag warning.
