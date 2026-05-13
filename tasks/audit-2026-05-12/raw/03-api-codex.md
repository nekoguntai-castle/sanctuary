## Coverage

- Files read: 66 of 175 TypeScript files under `server/src/api/`. I also read supporting middleware, services, repositories, and schemas where needed to confirm route-level behavior.
- Read deeply: `auth.ts`, `auth/login.ts`, `auth/password.ts`, `auth/sessions.ts`, `auth/tokens.ts`, `auth/twoFactor/**`; `wallets.ts` plus `wallets/approvals.ts`, `wallets/crud.ts`, `wallets/devices.ts`, `wallets/export.ts`, `wallets/import.ts`, `wallets/policies.ts`, `wallets/sharing.ts`; `transactions.ts` plus `transactions/addresses.ts`, `transactions/broadcasting.ts`, `transactions/broadcastIntent.ts`, `transactions/crossWallet.ts`, `transactions/drafting.ts`, `transactions/privacy.ts`, `transactions/requestValidation.ts`, `transactions/transactionDetail.ts`, `transactions/utxos.ts`, `transactions/walletTransactions/listTransactions.ts`, and `transactions/walletTransactions/pending.ts`; `bitcoin.ts` plus `bitcoin/address.ts`, `bitcoin/fees.ts`, `bitcoin/network.ts`, `bitcoin/sync.ts`, `bitcoin/transactions.ts`; all `devices/**`; `node.ts`, `payjoin.ts`, `push.ts`, `price.ts`, `sync.ts`, `labels.ts`, `drafts.ts`, `approvals.ts`, `agent.ts`, `ai-internal.ts`, `mobileAgentDrafts.ts`, and `mobilePermissions.ts`; admin files `admin.ts`, `admin/agents.ts`, `admin/backup.ts`, `admin/electrumServers.ts`, `admin/groups.ts`, `admin/infrastructure.ts`, `admin/mcpKeys.ts`, `admin/monitoring.ts`, `admin/nodeConfig.ts`, `admin/proxyTest.ts`, `admin/supportPackage.ts`, `admin/users.ts`, and `admin/version.ts`.
- Sampled: `admin/auditLogs.ts`, `admin/features.ts`, `admin/groupRoles.ts`, `admin/nodeConfigData.ts`, `admin/policies.ts`, `admin/requestValidation.ts`, `admin/settings.ts`; `ai/**`; `schemas/**`; `wallets/analytics.ts`, `wallets/autopilot.ts`, `wallets/telegram.ts`, `wallets/xpubValidation.ts`; `transactions/coinSelection.ts`, `transactions/creation.ts`, and remaining `transactions/walletTransactions/**`.
- Skipped: `openapi/**`, `health/**`, `console.ts`, `intelligence.ts`, `transfers.ts`, and documentation/schema generation internals not involved in executable route behavior.
- Clean notes: The read auth/login/session/token routes had expected authentication, rate-limit, cookie, and session-version checks. The read device routes used authentication and device access middleware where required, while the device model catalog appeared intentionally public. The read wallet CRUD/import/export/sharing/policy routes generally used wallet access middleware and repository/service ownership checks. The read admin routes generally used `authenticate` plus `requireAdmin`; `admin/version.ts` is intentionally public. The direct Prisma scan of `server/src/api/**/*.ts` found type-only Prisma imports but no direct Prisma client calls in API handlers.

### [critical] server/src/api/wallets/approvals.ts:59 — Approval vote requestId is not scoped to the wallet route
**Category:** IDOR / authorization
**What:** The vote endpoint authorizes only `:walletId` with `requireWalletAccess('approve')`, then calls `approvalService.castVote(requestId, userId, decision, reason)` using the unscoped `:requestId`. The service loads the approval request by ID and checks duplicate/self-approval, but it does not verify that the request belongs to the `walletId` or `draftId` from the route.
**Why it matters:** A user with approver access on one wallet can approve, reject, or veto an approval request for another wallet if they know or can guess the request ID, directly affecting financial authorization.
**Repro / trigger:** Log in as an approver on wallet A, then POST to `/api/v1/wallets/A/drafts/anything/approvals/<wallet-B-request-id>/vote` with `{"decision":"approve"}`.
**Fix shape:** Resolve the approval request with its draft and wallet, compare both to the route params before casting the vote, and ensure the voter is authorized for that request's actual wallet.
**Confidence:** high

### [critical] server/src/api/wallets/approvals.ts:102 — Owner override can force-approve a draft from another wallet
**Category:** IDOR / authorization
**What:** The owner override endpoint checks owner access on `:walletId`, then passes `draftId` and `walletId` to `approvalService.ownerOverride()`. The service queries pending approvals by `draftId` and updates them, but it does not verify that the draft belongs to the route wallet before approving the requests and marking the draft approved.
**Why it matters:** An owner of any wallet can force-approve pending approval requests for another wallet's draft if they know the draft ID.
**Repro / trigger:** Log in as owner of wallet A and POST `/api/v1/wallets/A/drafts/<wallet-B-draft-id>/override` with a reason.
**Fix shape:** Load the draft by ID, require `draft.walletId === route walletId`, and perform the override inside a transaction that scopes all approval updates by both draft and wallet.
**Confidence:** high

### [high] server/src/api/wallets/approvals.ts:38 — Approval list lookup ignores the wallet route parameter
**Category:** IDOR / information disclosure
**What:** The approval-list endpoint authorizes view access to `:walletId`, but calls `approvalService.getApprovalsForDraft(draftId)` without checking that the draft belongs to that wallet. The service returns approval requests by draft ID only.
**Why it matters:** A user with view access to any wallet can read approval workflow metadata for another wallet's draft if they know the draft ID.
**Repro / trigger:** Log in with view access to wallet A and GET `/api/v1/wallets/A/drafts/<wallet-B-draft-id>/approvals`.
**Fix shape:** Resolve the draft under the authorized wallet before returning approval requests, or change the service/repository call to require both `walletId` and `draftId`.
**Confidence:** high

### [critical] server/src/api/transactions/broadcastIntent.ts:176 — Signed PSBT policy checks only the first external output
**Category:** Financial policy bypass
**What:** `resolveSignedPsbtRecipientAndAmount()` filters paid address outputs, then returns the first output not in the wallet address set. The PSBT broadcast handlers pass only that single recipient and amount into `assertPolicyAllowsBroadcast()`, unlike the raw-hex path, which rejects multiple external recipients.
**Why it matters:** A signed PSBT can include one small allowed external output first and additional larger or disallowed external outputs later, while policy enforcement evaluates only the first one.
**Repro / trigger:** Submit a signed PSBT to `/api/v1/wallets/:walletId/psbt/broadcast` with two external outputs where output 1 satisfies policy and output 2 violates policy.
**Fix shape:** Make signed PSBT intent construction reject multiple external recipients until policies can model batches, or aggregate and evaluate every external output before broadcast.
**Confidence:** high

### [high] server/src/api/transactions/broadcastIntent.ts:209 — Signed PSBT inputs are not proven to belong to the route wallet before broadcast
**Category:** Authorization / financial integrity
**What:** `buildSignedPsbtBroadcastIntent()` parses PSBT inputs and returns them as UTXOs without querying wallet UTXOs or draft locks for the route wallet. The PSBT handler then calls `txService.broadcastAndSave()`, whose service broadcasts to the network before persistence tries to mark `walletId_txid_vout` spent.
**Why it matters:** An authenticated editor on one wallet can ask the backend to broadcast a signed PSBT spending inputs from outside that wallet; the irreversible network side effect happens before the wallet ownership mismatch is detected during persistence.
**Repro / trigger:** POST a valid signed PSBT spending non-wallet-A inputs to `/api/v1/wallets/A/psbt/broadcast`; the API builds an intent from the PSBT inputs and reaches network broadcast before the DB update can fail.
**Fix shape:** Mirror the raw-transaction path: deduplicate PSBT inputs, load matching UTXOs for the route wallet, require every input to belong to that wallet, and validate draft locks before broadcasting.
**Confidence:** high

### [high] server/src/api/node.ts:192 — Authenticated node test endpoint is an internal TCP probe
**Category:** SSRF / network pivot
**What:** `/api/v1/node/test` requires only authentication, accepts caller-supplied `host`, `port`, and `protocol`, then opens a raw TCP or TLS socket to that destination. There is no admin guard and no private-address or localhost denylist.
**Why it matters:** Any authenticated user can scan or probe internal services reachable from the backend, including localhost, RFC1918 networks, Docker networks, or cloud metadata-style endpoints.
**Repro / trigger:** POST `/api/v1/node/test` with `{"nodeType":"electrum","host":"127.0.0.1","port":"5432","protocol":"tcp","allowSelfSignedCertificate":false}` and observe success, timeout, or connection-refused timing/message.
**Fix shape:** Restrict this endpoint to admins or a dedicated node-management permission, and apply SSRF controls for host/IP validation before opening sockets.
**Confidence:** high

### [medium] server/src/api/payjoin.ts:250 — Payjoin sender SSRF guard does not cover redirects or DNS rebinding
**Category:** SSRF
**What:** The payjoin attempt route accepts `payjoinUrl` and passes it to `attemptPayjoinSend()`. The service validates the initial HTTPS URL and one DNS lookup before `fetch()`, but `fetch()` is called without redirect controls or binding the request to the validated address.
**Why it matters:** A public HTTPS host can redirect the backend to an internal URL, or DNS can change between validation and fetch, bypassing the private-IP checks.
**Repro / trigger:** POST `/api/v1/payjoin/attempt` with a public `https://` payjoin URL whose response redirects to `https://127.0.0.1/...` or whose DNS answer changes after validation.
**Fix shape:** Disable automatic redirects or validate every redirect target, resolve and connect in a way that binds to the validated address, and repeat private-network checks immediately before each network hop.
**Confidence:** medium

### [medium] server/src/api/auth/twoFactor/verify.ts:63 — Backup code use is not atomic
**Category:** Concurrency / authentication
**What:** The 2FA verify route reads the user's backup-code JSON, calls `verifyBackupCode()` to mark a matching code used in memory, then writes the updated JSON back with `userRepository.update()`. There is no compare-and-set condition or transaction that ensures the code was still unused at write time.
**Why it matters:** Two concurrent requests with the same valid temporary login token and backup code can both verify against the same original backup-code state and mint independent sessions.
**Repro / trigger:** Send two concurrent `/api/v1/auth/2fa/verify` requests with the same `tempToken` and unused backup code; both can pass before either update is visible to the other.
**Fix shape:** Consume backup codes with an atomic repository method, such as a transactional read with row lock or conditional update on the previous backup-code value, and only issue tokens after the consume operation succeeds.
**Confidence:** medium
