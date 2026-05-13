# Phase C — api (merged)

**Source:** raw/03-api-claude.md + raw/03-api-codex.md
**Date:** 2026-05-12

## Coverage

- Claude: ~28 deep reads + ~50 grep samples of 175 files (skipped OpenAPI specs)
- Codex: 66 deep reads of 175 files (skipped OpenAPI specs, health, console, intelligence, transfers)
- Union coverage estimated: ~80+ files seen by at least one reviewer

Claude's baseline scans across the full 175-file tree also recorded:
- `catch (error: any)` — zero hits (CLAUDE.md rule respected)
- `console.log/error/warn/info` — zero hits
- `@ts-ignore` — zero hits
- raw `JSON.parse` — 2 hits (`node.ts:145`, `admin/version.ts:30`) — both safe local data
- empty `catch {}` — 4 hits, all explanatory
- direct `prisma.*` usage in `api/` — none (repository layer respected). Codex's independent direct-Prisma scan agrees.

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 0 | 3 | 3 | 0 |
| High | 2 | 3 | 4 | 1 |
| Medium | 4 | 2 | 6 | 0 |
| Low | 7 | 0 | 7 | 0 |

**Accepted:** 20 · **Rejected:** 0 · **Deferred:** 0

## Findings (accepted)

### [CRITICAL] server/src/api/wallets/approvals.ts:59 — Approval vote requestId is not scoped to the wallet route
**Category:** IDOR / authorization
**Status:** Accept
**Cross-pass:** Codex only — high signal (Claude missed this)
**What:** The vote endpoint authorizes only `:walletId` with `requireWalletAccess('approve')`, then calls `approvalService.castVote(requestId, userId, decision, reason)` using the unscoped `:requestId`. The service loads the approval request by ID and checks duplicate/self-approval, but it does not verify that the request belongs to the `walletId` or `draftId` from the route.
**Why it matters:** A user with approver access on one wallet can approve, reject, or veto an approval request for another wallet if they know or can guess the request ID, directly affecting financial authorization.
**Repro / trigger:** Log in as an approver on wallet A, then POST to `/api/v1/wallets/A/drafts/anything/approvals/<wallet-B-request-id>/vote` with `{"decision":"approve"}`.
**Fix shape:** Resolve the approval request with its draft and wallet, compare both to the route params before casting the vote, and ensure the voter is authorized for that request's actual wallet.
**Confidence:** high

### [CRITICAL] server/src/api/wallets/approvals.ts:102 — Owner override can force-approve a draft from another wallet
**Category:** IDOR / authorization
**Status:** Accept
**Cross-pass:** Codex only — high signal (Claude missed this)
**What:** The owner override endpoint checks owner access on `:walletId`, then passes `draftId` and `walletId` to `approvalService.ownerOverride()`. The service queries pending approvals by `draftId` and updates them, but it does not verify that the draft belongs to the route wallet before approving the requests and marking the draft approved.
**Why it matters:** An owner of any wallet can force-approve pending approval requests for another wallet's draft if they know the draft ID.
**Repro / trigger:** Log in as owner of wallet A and POST `/api/v1/wallets/A/drafts/<wallet-B-draft-id>/override` with a reason.
**Fix shape:** Load the draft by ID, require `draft.walletId === route walletId`, and perform the override inside a transaction that scopes all approval updates by both draft and wallet.
**Confidence:** high

### [CRITICAL] server/src/api/transactions/broadcastIntent.ts:176 — Signed PSBT policy checks only the first external output
**Category:** Financial policy bypass
**Status:** Accept
**Cross-pass:** Codex only — high signal (Claude missed this)
**What:** `resolveSignedPsbtRecipientAndAmount()` filters paid address outputs, then returns the first output not in the wallet address set. The PSBT broadcast handlers pass only that single recipient and amount into `assertPolicyAllowsBroadcast()`, unlike the raw-hex path, which rejects multiple external recipients.
**Why it matters:** A signed PSBT can include one small allowed external output first and additional larger or disallowed external outputs later, while policy enforcement evaluates only the first one. Direct financial-policy bypass on the multisig/vault chokepoint.
**Repro / trigger:** Submit a signed PSBT to `/api/v1/wallets/:walletId/psbt/broadcast` with two external outputs where output 1 satisfies policy and output 2 violates policy.
**Fix shape:** Make signed PSBT intent construction reject multiple external recipients until policies can model batches, or aggregate and evaluate every external output before broadcast.
**Confidence:** high

### [HIGH] server/src/api/node.ts:60-211 (test handler at :192) — Authenticated SSRF via /node/test allows internal port probe
**Category:** Security / SSRF / network pivot
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `POST /api/v1/node/test` is gated only by `authenticate` (no `requireAdmin`). Any logged-in user can supply arbitrary `host`/`port`/`protocol` and the server opens a raw TCP or TLS socket to that target, returning success/failure and timing. With `allowSelfSignedCertificate=true`, even self-signed internal TLS hosts can be probed. There is no private-address or localhost denylist.
**Why it matters:** A low-privileged authenticated user (e.g. registered via open registration on a small Umbrel instance) can enumerate the internal Docker network — postgres, redis, gateway, AI container, host services — including localhost, RFC1918 networks, and cloud metadata-style endpoints. Combined with a future RCE/SSRF chain this is a useful primitive. Comments in `admin/nodeConfig.ts` show the project considers Electrum-server config admin-only, so the asymmetry here is unintentional.
**Repro / trigger:** `curl -X POST /api/v1/node/test -H 'Cookie: sanctuary_access=…' -d '{"host":"postgres","port":5432,"protocol":"tcp"}'`; or POST with `{"nodeType":"electrum","host":"127.0.0.1","port":"5432","protocol":"tcp"}` and observe timing/error differentiation.
**Fix shape:** Add `requireAdmin` (or a dedicated node-management permission) to `/test`, consistent with `/api/v1/admin/electrum-servers` admin gating. Additionally apply SSRF controls: restrict host to a known-allowed CIDR / non-private range before opening sockets.
**Confidence:** high

### [HIGH] server/src/api/wallets/approvals.ts:38 — Approval list lookup ignores the wallet route parameter
**Category:** IDOR / information disclosure
**Status:** Accept
**Cross-pass:** Codex only
**What:** The approval-list endpoint authorizes view access to `:walletId`, but calls `approvalService.getApprovalsForDraft(draftId)` without checking that the draft belongs to that wallet. The service returns approval requests by draft ID only.
**Why it matters:** A user with view access to any wallet can read approval workflow metadata for another wallet's draft if they know the draft ID.
**Repro / trigger:** Log in with view access to wallet A and GET `/api/v1/wallets/A/drafts/<wallet-B-draft-id>/approvals`.
**Fix shape:** Resolve the draft under the authorized wallet before returning approval requests, or change the service/repository call to require both `walletId` and `draftId`.
**Confidence:** high

### [HIGH] server/src/api/transactions/broadcastIntent.ts:209 — Signed PSBT inputs are not proven to belong to the route wallet before broadcast
**Category:** Authorization / financial integrity
**Status:** Accept
**Cross-pass:** Codex only
**What:** `buildSignedPsbtBroadcastIntent()` parses PSBT inputs and returns them as UTXOs without querying wallet UTXOs or draft locks for the route wallet. The PSBT handler then calls `txService.broadcastAndSave()`, whose service broadcasts to the network before persistence tries to mark `walletId_txid_vout` spent.
**Why it matters:** An authenticated editor on one wallet can ask the backend to broadcast a signed PSBT spending inputs from outside that wallet; the irreversible network side effect happens before the wallet ownership mismatch is detected during persistence.
**Repro / trigger:** POST a valid signed PSBT spending non-wallet-A inputs to `/api/v1/wallets/A/psbt/broadcast`; the API builds an intent from the PSBT inputs and reaches network broadcast before the DB update can fail.
**Fix shape:** Mirror the raw-transaction path: deduplicate PSBT inputs, load matching UTXOs for the route wallet, require every input to belong to that wallet, and validate draft locks before broadcasting.
**Confidence:** high

### [HIGH] server/src/api/drafts.ts:52-58 — PATCH draft accepts arbitrary `status` string
**Category:** Logic / invariant violations + Validation
**Status:** Accept
**Cross-pass:** Claude only
**What:** `UpdateDraftBodySchema` declares `status: z.string().optional()` with no enum. The handler at line 161 forwards `status` verbatim to `draftService.updateDraft`. The broadcast pipeline (`transactions/broadcasting.ts:62`) gates on `ACTIONABLE_BROADCAST_DRAFT_STATUSES` and an `approvalStatus` enum, so if `draftService.updateDraft` accepts arbitrary status strings, an `edit`-role signer could PATCH a pending-approval draft to a status that bypasses the approval gate (e.g. `'approved'`, `'signed'`, `'final'`).
**Why it matters:** Approval workflow is the multisig / vault-policy chokepoint; trusting a client-supplied status field is a privilege boundary. The actual exploitability depends on `draftService.updateDraft` allow-listing statuses — but defense-in-depth at the route layer is missing and zod is the natural place for it.
**Repro / trigger:** `PATCH /api/v1/wallets/:walletId/drafts/:draftId` with `{"status":"approved"}` as a signer.
**Fix shape:** Replace `status: z.string().optional()` with `z.enum([...DRAFT_STATUS_VALUES])`. Also verify `draftService.updateDraft` rejects status transitions not on a known allow-list and never lets a non-approver set `approvalStatus = 'approved'`.
**Confidence:** medium (depends on draftService allow-listing)

### [MEDIUM] server/src/api/payjoin.ts:250 — Payjoin sender SSRF guard does not cover redirects or DNS rebinding
**Category:** SSRF
**Status:** Accept
**Cross-pass:** Codex only
**What:** The payjoin attempt route accepts `payjoinUrl` and passes it to `attemptPayjoinSend()`. The service validates the initial HTTPS URL and one DNS lookup before `fetch()`, but `fetch()` is called without redirect controls or binding the request to the validated address.
**Why it matters:** A public HTTPS host can redirect the backend to an internal URL, or DNS can change between validation and fetch, bypassing the private-IP checks. TOCTOU + redirect-follow is a classic SSRF bypass.
**Repro / trigger:** POST `/api/v1/payjoin/attempt` with a public `https://` payjoin URL whose response redirects to `https://127.0.0.1/...` or whose DNS answer changes after validation.
**Fix shape:** Disable automatic redirects or validate every redirect target, resolve and connect in a way that binds to the validated address, and repeat private-network checks immediately before each network hop.
**Confidence:** medium

### [MEDIUM] server/src/api/auth/twoFactor/verify.ts:63 — Backup code use is not atomic
**Category:** Concurrency / authentication
**Status:** Accept
**Cross-pass:** Codex only
**What:** The 2FA verify route reads the user's backup-code JSON, calls `verifyBackupCode()` to mark a matching code used in memory, then writes the updated JSON back with `userRepository.update()`. There is no compare-and-set condition or transaction that ensures the code was still unused at write time.
**Why it matters:** Two concurrent requests with the same valid temporary login token and backup code can both verify against the same original backup-code state and mint independent sessions.
**Repro / trigger:** Send two concurrent `/api/v1/auth/2fa/verify` requests with the same `tempToken` and unused backup code; both can pass before either update is visible to the other.
**Fix shape:** Consume backup codes with an atomic repository method, such as a transactional read with row lock or conditional update on the previous backup-code value, and only issue tokens after the consume operation succeeds.
**Confidence:** medium

### [MEDIUM] server/src/api/payjoin.ts:41-62 — `psbt` and `payjoinUrl` typed as z.unknown() flow into outbound HTTP
**Category:** Validation / Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** `AttemptPayjoinBodySchema` declares `psbt: z.unknown()` and `payjoinUrl: z.unknown()` and only checks presence in `superRefine`. The handler then passes both verbatim into `attemptPayjoinSend(psbt, payjoinUrl, …)`. `services/payjoin/sender.ts:40` does run `validatePayjoinUrl(payjoinUrl)` (SSRF protection), but it relies on `payjoinUrl` being a string — passing `{"toString":…}` or a number is downstream-only undefined behavior.
**Why it matters:** Type confusion bugs in URL handling have repeatedly been SSRF/parse-discrepancy bug sources (e.g. `URL` ctor accepting odd inputs). The SSRF guard is the only defense for an authenticated outbound request that the user controls. Pairs with the redirect/DNS-rebinding gap above.
**Repro / trigger:** `POST /api/v1/payjoin/attempt` with `{"psbt": 123, "payjoinUrl": {"valueOf":"http://attacker"}}`.
**Fix shape:** Tighten schema to `psbt: z.string().min(1)` and `payjoinUrl: z.string().url()` (BIP78 endpoints are HTTPS URLs). Keep `validatePayjoinUrl` as the second layer.
**Confidence:** high

### [MEDIUM] server/src/api/transfers.ts:39-63 — Ownership-transfer body fields typed as z.unknown()
**Category:** Validation
**Status:** Accept
**Cross-pass:** Claude only
**What:** `InitiateTransferBodySchema` types `resourceType`, `resourceId`, `toUserId`, `message`, `keepExistingUsers`, `expiresInDays` as `z.unknown()`. The handler casts and forwards them straight into `initiateTransfer(userId, input)`. Only `resourceType` gets value validation (`'wallet'|'device'`); `resourceId` and `toUserId` are not typed/length-checked at the route layer.
**Why it matters:** Ownership transfer is a high-impact state change (wallet/device ownership permanently moves). A defensive zod schema is the right place to reject `null`/objects/arrays before the service. Likely the service revalidates, but the route-layer ambiguity invites future regressions.
**Repro / trigger:** `POST /api/v1/transfers` with `{"resourceType":"wallet","resourceId":{"$ne":null},"toUserId":42}` — odd shapes reach the service.
**Fix shape:** `resourceId: z.string().min(1)`, `toUserId: z.string().min(1)`, `message: z.string().max(1000).optional()`, `keepExistingUsers: z.boolean().optional()`, `expiresInDays: z.number().int().positive().max(365).optional()`.
**Confidence:** high

### [MEDIUM] server/src/api/admin/users.ts:354-361 — Admin can self-demote with no guard, lockout risk
**Category:** Logic / invariant violations
**Status:** Accept
**Cross-pass:** Claude only
**What:** `PUT /api/v1/admin/users/:userId` allows an admin to update `isAdmin` on any user including themselves. Self-delete is blocked (line 378) but self-demote is not. If the only admin demotes themselves the instance has no admin and cannot promote anyone back via the admin API.
**Why it matters:** Easy operational lockout (would have to recover via DB). Comparable instance-admin lockout on Forgejo is already in the project's lessons file.
**Repro / trigger:** Sole admin does `PUT /api/v1/admin/users/<own-id>` with `{"isAdmin": false}`.
**Fix shape:** In `handleUpdateUser`, if `updateData.isAdmin === false` and `userId === req.user?.userId`, count remaining admins; reject if it would drop to zero. Mirror the self-delete check.
**Confidence:** high

### [MEDIUM] server/src/api/wallets/crud.ts:24-25 — `quorum`/`totalSigners` typed as z.unknown()
**Category:** Validation
**Status:** Accept
**Cross-pass:** Claude only
**What:** `CreateWalletBodySchema` types `quorum: z.unknown().optional()` and `totalSigners: z.unknown().optional()`. Multisig wallet creation forwards these to `walletService.createWallet`. Non-numeric values would be discovered downstream; a malformed value could cause weird wallet state if the service ever coerces with `Number()`.
**Why it matters:** Multisig quorum is security-critical — a wallet that round-trips a stringified or off-by-one quorum is a soft footgun.
**Repro / trigger:** Create multisig wallet with `quorum: "2"` or `quorum: 2.5`.
**Fix shape:** `quorum: z.number().int().positive().optional()`, `totalSigners: z.number().int().min(2).optional()`, plus a `superRefine` that enforces `quorum <= totalSigners` when both present and `type === 'multi_sig'`.
**Confidence:** high

### [LOW] server/src/api/labels.ts:137-189 — Transaction/address label write routes use only `authenticate`, push access check to service
**Category:** Defense in depth / Documentation drift
**Status:** Accept
**Cross-pass:** Claude only
**What:** The file header comments claim "WRITE (POST, PUT, DELETE): Only owner or signer roles" but `POST/PUT/DELETE /transactions/:transactionId/labels` and `/addresses/:addressId/labels` only call `requireAuthenticatedUser(req).userId` and rely on `labelService.{addTransactionLabels,…}` to enforce wallet-role access. The wallet-level CRUD routes use `requireWalletAccess('edit')` middleware; this is inconsistent.
**Why it matters:** If a service implementation is ever refactored and the implicit access check is dropped, the route becomes a silent IDOR (any authenticated user labels another user's transactions). Visible at code-review time would be much harder if the convention isn't enforced at the route layer.
**Repro / trigger:** Service-level regression test would catch it; route reviewer cannot.
**Fix shape:** Move access check to a `requireTransactionWalletAccess` / `requireAddressWalletAccess` middleware applied at the route layer, mirroring `requireWalletAccess`.
**Confidence:** medium

### [LOW] server/src/api/push.ts:280-294 — Internal /push/by-user/:userId returns raw FCM/APNs tokens
**Category:** Security (data exposure)
**Status:** Accept
**Cross-pass:** Claude only
**What:** The internal endpoint (HMAC-gated by `verifyGatewayRequest`) returns `pushToken: d.token` directly. If the gateway HMAC secret is ever exposed, attackers gain the ability to retrieve push tokens for any user by ID and send arbitrary push notifications via FCM/APNs.
**Why it matters:** Push tokens are quasi-secret. Defense in depth (e.g. returning only an internal device ID and having the gateway look up the token from its own copy) limits blast radius.
**Repro / trigger:** Anyone with the gateway HMAC key can call this and harvest tokens.
**Fix shape:** Have backend send notifications via gateway by emitting an event with `deviceId`, and have gateway resolve `deviceId → token` from its own cache. Or rotate HMAC frequently and treat token-list as sensitive-audit-logged.
**Confidence:** low (acceptable trade-off for current architecture)

### [LOW] server/src/api/ai-internal.ts:113-140 — pull-progress accepts unknown numeric inputs and computes percent
**Category:** Validation / Logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** `PullProgressBodySchema` declares `completed`, `total`, `model`, `status`, etc. all as `z.unknown()`. `const percent = total > 0 ? Math.round((completed / total) * 100) : 0;` runs unconditionally. If `total` is a string (`"100"`), `total > 0` is true but `completed / total` may be NaN; the broadcast then carries `percent: NaN`.
**Why it matters:** Minor UX corruption to WebSocket subscribers (progress bar shows NaN%) and possible JSON serialization quirks. Endpoint is internal-network-only so impact is small.
**Repro / trigger:** AI container sends progress with stringified numbers.
**Fix shape:** `completed: z.number().nonnegative().optional()`, `total: z.number().nonnegative().optional()`. Or coerce explicitly.
**Confidence:** high

### [LOW] server/src/api/admin/proxyTest.ts:104-131 — Body promise has no explicit request destroy on abort
**Category:** Resource leaks
**Status:** Accept
**Cross-pass:** Claude only
**What:** `https.get` returns a `req` object; on `controller.abort()` the request is canceled by signal, but the surrounding promise wraps `req.on('error', reject)` only. If `setTimeout` fires after the response stream has started, the body chunks may have already been buffered into `data` without explicit `req.destroy()` cleanup beyond the abort signal.
**Why it matters:** Likely no real leak (abort signal closes the socket), but the pattern is fragile. Bigger concern is that the outer try/catch swallows the abort and returns success without exit-IP — operator may misread.
**Repro / trigger:** Slow torproject.org response while timer fires.
**Fix shape:** Add explicit `req.destroy()` in the finally, and log distinct outcome ("exit IP check timed out") when the abort triggers.
**Confidence:** low

### [LOW] server/src/api/bitcoin/transactions.ts:81-88 — GET /bitcoin/transaction/:txid is unauthenticated
**Category:** Info / by-design
**Status:** Accept
**Cross-pass:** Claude only
**What:** Route returns blockchain-public data (anyone with mempool.space could fetch it). Mounted under the bitcoin router which doesn't apply `authenticate` at parent (only individual routes do).
**Why it matters:** Not a vulnerability per se, but the asymmetry (`/broadcast` authenticated, `/transaction/:txid` not) is easy to misread and could become a regression vector if a future PR adds a "with wallet context" param without re-checking auth.
**Repro / trigger:** N/A.
**Fix shape:** Either document explicitly that this is public, or apply `authenticate` for consistency (cost is one round-trip cookie validation).
**Confidence:** low

### [LOW] server/src/api/auth/login.ts:30 — Module-level router shared across createLoginRouter() invocations
**Category:** Logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** `const router = Router();` is declared at module level, then `createLoginRouter(...)` mutates it and returns it. If `createLoginRouter` is ever called twice (testing, hot reload, multi-tenant), routes are double-mounted.
**Why it matters:** Latent footgun. The Verify/Email/Password factories in the same auth dir create a router inside the factory; login is the inconsistent one.
**Repro / trigger:** Two calls to `createLoginRouter`.
**Fix shape:** Move `const router = Router()` inside `createLoginRouter`. Same pattern check on `password.ts` (line 21 — same issue).
**Confidence:** high

### [LOW] server/src/api/admin/users.ts:155-157 — `updateData.isAdmin = input.isAdmin === true` accepts only boolean true
**Category:** Validation
**Status:** Accept
**Cross-pass:** Claude only
**What:** If `input.isAdmin === false` is sent explicitly, the line still works (false). But this implicit coercion means truthy non-boolean values (`"yes"`, `1`) become `false` silently. Could mask client bugs.
**Why it matters:** Minor; admin-only route.
**Repro / trigger:** Admin client sends `isAdmin: "true"`.
**Fix shape:** Schema-level `isAdmin: z.boolean().optional()` (likely already is via `UpdateUserSchema`).
**Confidence:** medium

## Considered & rejected

_(none — no findings disproved by code on review)_

## Deferred

_(none — no findings overlap known tracked tech debt in MEMORY.md)_
