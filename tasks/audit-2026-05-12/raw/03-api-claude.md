# API Surface Audit — server/src/api/

## Coverage

**Files read (full or near-full): ~28 / 175**
**Files spot-checked via grep / structural reads: ~50**
**Files deliberately skipped: ~95 (mostly `openapi/schemas/*` and `openapi/paths/*` — OpenAPI spec docs, no runtime behavior; plus `schemas/*` zod definitions read indirectly via consumers)**

### Deep reads (full file)
- `auth.ts`, `auth/login.ts`, `auth/password.ts`, `auth/tokens.ts`, `auth/twoFactor/verify.ts`
- `admin.ts`, `admin/users.ts`, `admin/groups.ts`, `admin/version.ts`, `admin/proxyTest.ts`
- `wallets.ts`, `wallets/crud.ts`, `wallets/sharing.ts`, `wallets/import.ts`, `wallets/export.ts`
- `transactions/broadcasting.ts`
- `bitcoin.ts`, `bitcoin/transactions.ts`
- `payjoin.ts` (+ cross-checked `services/payjoin/sender.ts`)
- `ai-internal.ts`, `agent.ts`, `console.ts`, `node.ts`
- `transfers.ts`, `mobilePermissions.ts`, `push.ts`, `sync.ts`, `labels.ts`, `drafts.ts`
- `routes.ts` (parent registration)

### Sampled / grep-only
- `admin/{auditLogs, electrumServers, infrastructure, mcpKeys, monitoring, settings, supportPackage, backup, nodeConfig, policies, features}.ts`
- `auth/{sessions, profile, telegram, email, twoFactor/setup, twoFactor/management}.ts`
- `wallets/{policies, autopilot, analytics, approvals, telegram, devices, xpubValidation}.ts`
- `transactions/{addresses, broadcastIntent, coinSelection, creation, crossWallet, drafting, privacy, transactionDetail, utxos, walletTransactions/*}.ts`
- `devices/{accounts, accountConflicts, crud, models, sharing}.ts`
- `bitcoin/{network, fees, address, sync, networkParam}.ts`
- `ai/{features, index, models, status, systemResources}.ts`
- `health/*`, `openapi/{index, swaggerUI}.ts`, `intelligence.ts`, `price.ts`, `approvals.ts`, `mobileAgentDrafts.ts`

### Baseline scans run across full tree (175 files)
- `catch (error: any)` — zero hits (CLAUDE.md rule respected)
- `console.log/error/warn/info` — zero hits
- `@ts-ignore` — zero hits
- raw `JSON.parse` — 2 hits (`node.ts:145` Electrum response, `admin/version.ts:30` package.json) — both safe local data
- empty `catch {}` — 4 hits, all explanatory (no swallowing of unexpected errors)
- direct `prisma.*` usage — none found in `api/` (repository layer respected)

---

## Findings

### [HIGH] api/node.ts:60-211 — Authenticated SSRF via /node/test allows internal port probe
**Category:** Security
**What:** `POST /api/v1/node/test` is gated only by `authenticate` (no `requireAdmin`). Any logged-in user can supply arbitrary `host`/`port`/`protocol` and the server opens a raw TCP or TLS socket to that target, returning success/failure and timing. With `allowSelfSignedCertificate=true`, even self-signed internal TLS hosts can be probed.
**Why it matters:** A low-privileged authenticated user (e.g. registered via open registration on a small Umbrel instance) can enumerate the internal Docker network — postgres, redis, gateway, AI container, host services — discovering attack surface. Combined with a future RCE/SSRF chain this is a useful primitive. Comments in `admin/nodeConfig.ts` show the project considers Electrum-server config admin-only, so the asymmetry here is unintentional.
**Repro / trigger:** `curl -X POST /api/v1/node/test -H 'Cookie: sanctuary_access=…' -d '{"host":"postgres","port":5432,"protocol":"tcp"}'`
**Fix shape:** Add `requireAdmin` to `/test` (consistent with `/api/v1/admin/electrum-servers` admin gating), or restrict host to a known-allowed CIDR / non-private range.
**Confidence:** high

### [HIGH] api/drafts.ts:52-58 — PATCH draft accepts arbitrary `status` string
**Category:** Logic/invariant violations + Validation
**What:** `UpdateDraftBodySchema` declares `status: z.string().optional()` with no enum. The handler at line 161 forwards `status` verbatim to `draftService.updateDraft`. The broadcast pipeline (`transactions/broadcasting.ts:62`) gates on `ACTIONABLE_BROADCAST_DRAFT_STATUSES` and an `approvalStatus` enum, so if `draftService.updateDraft` accepts arbitrary status strings, an `edit`-role signer could PATCH a pending-approval draft to a status that bypasses the approval gate (e.g. `'approved'`, `'signed'`, `'final'`).
**Why it matters:** Approval workflow is the multisig / vault-policy chokepoint; trusting a client-supplied status field is a privilege boundary. The actual exploitability depends on `draftService.updateDraft` allow-listing statuses — but defense-in-depth at the route layer is missing and zod is the natural place for it.
**Repro / trigger:** `PATCH /api/v1/wallets/:walletId/drafts/:draftId` with `{"status":"approved"}` as a signer.
**Fix shape:** Replace `status: z.string().optional()` with `z.enum([...DRAFT_STATUS_VALUES])`. Also verify `draftService.updateDraft` rejects status transitions not on a known allow-list and never lets a non-approver set `approvalStatus = 'approved'`.
**Confidence:** medium (depends on draftService allow-listing)

### [MEDIUM] api/payjoin.ts:41-62 — `psbt` and `payjoinUrl` typed as z.unknown() flow into outbound HTTP
**Category:** Validation / Security
**What:** `AttemptPayjoinBodySchema` declares `psbt: z.unknown()` and `payjoinUrl: z.unknown()` and only checks presence in `superRefine`. The handler then passes both verbatim into `attemptPayjoinSend(psbt, payjoinUrl, …)`. `services/payjoin/sender.ts:40` does run `validatePayjoinUrl(payjoinUrl)` (SSRF protection), but it relies on `payjoinUrl` being a string — passing `{"toString":…}` or a number is downstream-only undefined behavior.
**Why it matters:** Type confusion bugs in URL handling have repeatedly been SSRF/parse-discrepancy bug sources (e.g. `URL` ctor accepting odd inputs). The SSRF guard is the only defense for an authenticated outbound request that the user controls.
**Repro / trigger:** `POST /api/v1/payjoin/attempt` with `{"psbt": 123, "payjoinUrl": {"valueOf":"http://attacker"}}`.
**Fix shape:** Tighten schema to `psbt: z.string().min(1)` and `payjoinUrl: z.string().url()` (BIP78 endpoints are HTTPS URLs). Keep `validatePayjoinUrl` as the second layer.
**Confidence:** high

### [MEDIUM] api/transfers.ts:39-63 — Ownership-transfer body fields typed as z.unknown()
**Category:** Validation
**What:** `InitiateTransferBodySchema` types `resourceType`, `resourceId`, `toUserId`, `message`, `keepExistingUsers`, `expiresInDays` as `z.unknown()`. The handler casts and forwards them straight into `initiateTransfer(userId, input)`. Only `resourceType` gets value validation (`'wallet'|'device'`); `resourceId` and `toUserId` are not typed/length-checked at the route layer.
**Why it matters:** Ownership transfer is a high-impact state change (wallet/device ownership permanently moves). A defensive zod schema is the right place to reject `null`/objects/arrays before the service. Likely the service revalidates, but the route-layer ambiguity invites future regressions.
**Repro / trigger:** `POST /api/v1/transfers` with `{"resourceType":"wallet","resourceId":{"$ne":null},"toUserId":42}` — odd shapes reach the service.
**Fix shape:** `resourceId: z.string().min(1)`, `toUserId: z.string().min(1)`, `message: z.string().max(1000).optional()`, `keepExistingUsers: z.boolean().optional()`, `expiresInDays: z.number().int().positive().max(365).optional()`.
**Confidence:** high

### [MEDIUM] api/admin/users.ts:354-361 — Admin can self-demote with no guard, lockout risk
**Category:** Logic/invariant violations
**What:** `PUT /api/v1/admin/users/:userId` allows an admin to update `isAdmin` on any user including themselves. Self-delete is blocked (line 378) but self-demote is not. If the only admin demotes themselves the instance has no admin and cannot promote anyone back via the admin API.
**Why it matters:** Easy operational lockout (would have to recover via DB). Comparable instance-admin lockout on Forgejo is already in the project's lessons file.
**Repro / trigger:** Sole admin does `PUT /api/v1/admin/users/<own-id>` with `{"isAdmin": false}`.
**Fix shape:** In `handleUpdateUser`, if `updateData.isAdmin === false` and `userId === req.user?.userId`, count remaining admins; reject if it would drop to zero. Mirror the self-delete check.
**Confidence:** high

### [MEDIUM] api/wallets/crud.ts:24-25 — `quorum`/`totalSigners` typed as z.unknown()
**Category:** Validation
**What:** `CreateWalletBodySchema` types `quorum: z.unknown().optional()` and `totalSigners: z.unknown().optional()`. Multisig wallet creation forwards these to `walletService.createWallet`. Non-numeric values would be discovered downstream; a malformed value could cause weird wallet state if the service ever coerces with `Number()`.
**Why it matters:** Multisig quorum is security-critical — a wallet that round-trips a stringified or off-by-one quorum is a soft footgun.
**Repro / trigger:** Create multisig wallet with `quorum: "2"` or `quorum: 2.5`.
**Fix shape:** `quorum: z.number().int().positive().optional()`, `totalSigners: z.number().int().min(2).optional()`, plus a `superRefine` that enforces `quorum <= totalSigners` when both present and `type === 'multi_sig'`.
**Confidence:** high

### [LOW] api/labels.ts:137-189 — Transaction/address label write routes use only `authenticate`, push access check to service
**Category:** Defense in depth / Documentation drift
**What:** The file header comments claim "WRITE (POST, PUT, DELETE): Only owner or signer roles" but `POST/PUT/DELETE /transactions/:transactionId/labels` and `/addresses/:addressId/labels` only call `requireAuthenticatedUser(req).userId` and rely on `labelService.{addTransactionLabels,…}` to enforce wallet-role access. The wallet-level CRUD routes use `requireWalletAccess('edit')` middleware; this is inconsistent.
**Why it matters:** If a service implementation is ever refactored and the implicit access check is dropped, the route becomes a silent IDOR (any authenticated user labels another user's transactions). Visible at code-review time would be much harder if the convention isn't enforced at the route layer.
**Repro / trigger:** Service-level regression test would catch it; route reviewer cannot.
**Fix shape:** Move access check to a `requireTransactionWalletAccess` / `requireAddressWalletAccess` middleware applied at the route layer, mirroring `requireWalletAccess`.
**Confidence:** medium

### [LOW] api/push.ts:280-294 — Internal /push/by-user/:userId returns raw FCM/APNs tokens
**Category:** Security (data exposure)
**What:** The internal endpoint (HMAC-gated by `verifyGatewayRequest`) returns `pushToken: d.token` directly. If the gateway HMAC secret is ever exposed, attackers gain the ability to retrieve push tokens for any user by ID and send arbitrary push notifications via FCM/APNs.
**Why it matters:** Push tokens are quasi-secret. Defense in depth (e.g. returning only an internal device ID and having the gateway look up the token from its own copy) limits blast radius.
**Repro / trigger:** Anyone with the gateway HMAC key can call this and harvest tokens.
**Fix shape:** Have backend send notifications via gateway by emitting an event with `deviceId`, and have gateway resolve `deviceId → token` from its own cache. Or rotate HMAC frequently and treat token-list as sensitive-audit-logged.
**Confidence:** low (acceptable trade-off for current architecture)

### [LOW] api/ai-internal.ts:113-140 — pull-progress accepts unknown numeric inputs and computes percent
**Category:** Validation / Logic
**What:** `PullProgressBodySchema` declares `completed`, `total`, `model`, `status`, etc. all as `z.unknown()`. `const percent = total > 0 ? Math.round((completed / total) * 100) : 0;` runs unconditionally. If `total` is a string (`"100"`), `total > 0` is true but `completed / total` may be NaN; the broadcast then carries `percent: NaN`.
**Why it matters:** Minor UX corruption to WebSocket subscribers (progress bar shows NaN%) and possible JSON serialization quirks. Endpoint is internal-network-only so impact is small.
**Repro / trigger:** AI container sends progress with stringified numbers.
**Fix shape:** `completed: z.number().nonnegative().optional()`, `total: z.number().nonnegative().optional()`. Or coerce explicitly.
**Confidence:** high

### [LOW] api/admin/proxyTest.ts:104-131 — Body promise has no explicit request destroy on abort
**Category:** Resource leaks
**What:** `https.get` returns a `req` object; on `controller.abort()` the request is canceled by signal, but the surrounding promise wraps `req.on('error', reject)` only. If `setTimeout` fires after the response stream has started, the body chunks may have already been buffered into `data` without explicit `req.destroy()` cleanup beyond the abort signal.
**Why it matters:** Likely no real leak (abort signal closes the socket), but the pattern is fragile. Bigger concern is that the outer try/catch swallows the abort and returns success without exit-IP — operator may misread.
**Repro / trigger:** Slow torproject.org response while timer fires.
**Fix shape:** Add explicit `req.destroy()` in the finally, and log distinct outcome ("exit IP check timed out") when the abort triggers.
**Confidence:** low

### [LOW] api/bitcoin/transactions.ts:81-88 — GET /bitcoin/transaction/:txid is unauthenticated
**Category:** Info / by-design
**What:** Route returns blockchain-public data (anyone with mempool.space could fetch it). Mounted under the bitcoin router which doesn't apply `authenticate` at parent (only individual routes do).
**Why it matters:** Not a vulnerability per se, but the asymmetry (`/broadcast` authenticated, `/transaction/:txid` not) is easy to misread and could become a regression vector if a future PR adds a "with wallet context" param without re-checking auth.
**Repro / trigger:** N/A.
**Fix shape:** Either document explicitly that this is public, or apply `authenticate` for consistency (cost is one round-trip cookie validation).
**Confidence:** low

### [LOW] api/auth/login.ts:30 — Module-level router shared across createLoginRouter() invocations
**Category:** Logic
**What:** `const router = Router();` is declared at module level, then `createLoginRouter(...)` mutates it and returns it. If `createLoginRouter` is ever called twice (testing, hot reload, multi-tenant), routes are double-mounted.
**Why it matters:** Latent footgun. The Verify/Email/Password factories in the same auth dir create a router inside the factory; login is the inconsistent one.
**Repro / trigger:** Two calls to `createLoginRouter`.
**Fix shape:** Move `const router = Router()` inside `createLoginRouter`. Same pattern check on `password.ts` (line 21 — same issue).
**Confidence:** high

### [LOW] api/admin/users.ts:155-157 — `updateData.isAdmin = input.isAdmin === true` accepts only boolean true
**Category:** Validation
**What:** If `input.isAdmin === false` is sent explicitly, the line still works (false). But this implicit coercion means truthy non-boolean values (`"yes"`, `1`) become `false` silently. Could mask client bugs.
**Why it matters:** Minor; admin-only route.
**Repro / trigger:** Admin client sends `isAdmin: "true"`.
**Fix shape:** Schema-level `isAdmin: z.boolean().optional()` (likely already is via `UpdateUserSchema`).
**Confidence:** medium
