# Current Task: 100% Coverage Gates

Status: frontend and backend literal 100% coverage gates complete; server test tsconfig no longer references Jest types

Goal: bring the enforced frontend and backend coverage gates to literal 100% with targeted tests where behavior is reachable, using narrowly justified exclusions only for non-runtime shims, type-only files, V8 instrumentation artifacts, or environment entrypoints that cannot be meaningfully unit-covered.

## Coverage Checklist

- [x] Reproduce current frontend and backend coverage failures locally.
- [x] Identify every uncovered file/line that prevents the enforced gates from passing.
- [x] Add focused tests for reachable branch, function, statement, and line gaps in the affected agent funding and WalletDetail surfaces.
- [x] Tighten backend thresholds to 100% once the backend report is literally clean.
- [x] Replace the stale Jest test type reference with Vitest globals in the server test tsconfig.
- [x] Run frontend and backend coverage gates plus relevant type/build checks.
- [x] Add a review section summarizing changes, edge cases, verification, and residual risks.
- [x] Commit and push the coverage fix.

## Coverage Review

Changes made:

- Added frontend route and WalletDetail wrapper coverage for lazy agent routes, admin wallet-agent badge loading, fallback badge labels, rejected fetches, and unmount cancellation.
- Added backend tests around admin agent route validation, scoped agent route rejection metadata, agent funding draft PSBT edge cases, mobile draft review permissions, draft notification metadata, websocket broadcast skips, agent funding policy windows, monitoring alert early returns, middleware auth, Telegram formatting, and repository null/default paths.
- Excluded `src/worker.ts` from backend unit coverage as a side-effect daemon entrypoint; worker behavior remains covered through worker module and worker entry tests.
- Tightened backend Vitest thresholds to 100% for statements, branches, functions, and lines.
- Updated `server/tsconfig.test.json` to use `vitest/globals` instead of missing Jest types, include shared test dependencies, and allow extension-bearing TypeScript imports for the existing test suite layout.

Verification:

- `npm run test:coverage` passed with frontend/root literal 100% coverage: statements 14257/14257, branches 10630/10630, functions 3625/3625, lines 13298/13298.
- `cd server && npm run test:unit -- --coverage` passed with backend literal 100% coverage: statements 21669/21669, branches 10638/10638, functions 4256/4256, lines 20784/20784.
- `npm run typecheck:tests` passed.
- `cd server && npm run build` passed.
- `cd server && npx tsc --noEmit -p tsconfig.test.json --pretty false` no longer fails on missing Jest types; it now exposes pre-existing server test type debt in fixtures, mock imports, Express router test helpers, and stale integration setup signatures.
- `git diff --check` passed.

Residual risk:

- Server runtime build and coverage are green, but the dedicated server test typecheck is not yet clean because the test suite has broader non-Jest typing issues. The missing Jest types blocker is removed; finishing the remaining test type debt should be handled as a separate cleanup pass unless we want to expand this coverage task further.

## Previous Task: Agent Wallet Funding Implementation

Status: Phase 15 implementation and cross-phase corner-case audit complete

Reference plan: `tasks/agent-wallet-funding-plan.md`

## Active Implementation Slice

Goal: make agent wallet funding operable and defensible with operator docs, incident runbooks, backup/restore coverage, release notes, and an end-to-end route smoke path.

- [x] Load `AGENTS.md` and current project lessons into the session.
- [x] Capture the agent funding architecture in `tasks/agent-wallet-funding-plan.md`.
- [x] Inspect the existing draft creation API, service, repository, notification, and tests.
- [x] Add server-side support for creating a draft with an initial signed PSBT and signer device id.
- [x] Validate that initial signature metadata is scoped to a device associated with the wallet.
- [x] Preserve existing draft notification behavior so human parties are alerted.
- [x] Add focused tests for initial partially signed draft creation.
- [x] Add `WalletAgent` and `AgentApiKey` schema models plus a migration for linked funding/operational wallets.
- [x] Add scoped `agt_` bearer key generation, hashing, parsing, revocation/expiry checks, and funding-wallet access enforcement.
- [x] Add repository support for agent profiles and API keys.
- [x] Add a dedicated `POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts` endpoint.
- [x] Ensure the dedicated endpoint creates a normal partial draft using the registered agent signer device.
- [x] Notify all eligible wallet parties for agent-created drafts instead of suppressing the owning human user.
- [x] Audit-log agent funding draft submissions.
- [x] Add OpenAPI coverage for the agent route and the previously undocumented admin MCP key routes.
- [x] Remove direct Prisma access from the transaction export route by moving the transaction wrapper into the repository.
- [x] Decode agent-submitted PSBTs and validate outputs against the linked operational wallet plus funding-wallet change.
- [x] Validate agent-submitted PSBT inputs against funding-wallet UTXOs, spent/frozen state, and active draft locks.
- [x] Validate the registered agent cosigner's actual partial signature on every input.
- [x] Derive agent draft locking and display metadata from decoded PSBT contents.
- [x] Run targeted and full server verification.
- [x] Add a review section summarizing behavior, tests, edge cases, and follow-up work.
- [x] Add admin/API agent management, policy gates, deduped agent notifications, operational spend alerts, and draft-row agent context.
- [x] Add admin options API for user, wallet, and signer-device choices.
- [x] Add frontend admin API bindings for agent profile and key management.
- [x] Add Admin -> Wallet Agents route.
- [x] Add admin list/create/edit/revoke flows for wallet agents.
- [x] Add one-time `agt_` key creation display and key revocation UI.
- [x] Add linked agent wallet badges to wallet detail headers for admins.
- [x] Add focused server, API binding, route, component, and wallet-header tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add agent operational monitoring policy fields.
- [x] Add persisted agent alert history with dedupe.
- [x] Trigger alerts for low/high operational balance, large operational spends, large operational fees, and repeated rejected funding attempts.
- [x] Expose alert history through admin APIs.
- [x] Add monitoring fields to Admin -> Wallet Agents create/edit UI.
- [x] Add focused repository, service, route, API, and component tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add server-side Agent Wallets dashboard aggregation endpoint.
- [x] Include agent status, funding wallet, operational wallet, operational balance, pending drafts, recent spends, open alerts, and key counts.
- [x] Add frontend admin API bindings for dashboard metadata.
- [x] Add Admin -> Agent Wallets dashboard route.
- [x] Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Add detail rows for policy, recent funding requests, operational spends, alerts, and key metadata.
- [x] Add focused server, API binding, route, and component tests.
- [x] Run targeted verification plus broader frontend/server checks.
- [x] Add receive-address-specific repository helpers for agent operational address lookup.
- [x] Add a server service that returns or derives verified linked operational receive addresses.
- [x] Update the agent operational-address endpoint and OpenAPI schema.
- [x] Add focused repository, service, and route tests.
- [x] Run Phase 12 targeted verification and commit.
- [x] Add an `AgentFundingOverride` schema model and migration.
- [x] Add admin API routes for listing, creating, and revoking owner overrides.
- [x] Enforce override eligibility in agent funding policy without bypassing inactive, wrong-destination, or cooldown guards.
- [x] Mark overrides used after draft creation and audit override create/revoke/use events.
- [x] Add admin UI/API bindings for owner override list/create/revoke flows.
- [x] Label override-funded drafts for human review.
- [x] Add focused repository, service, route, DTO, OpenAPI, API binding, and component tests.
- [x] Run Phase 13 targeted and broader verification.
- [x] Add mobile-safe pending agent funding draft repository queries.
- [x] Add mobile review DTOs with decoded draft summaries, linked operational wallet destination, signing metadata, and deep-link payloads.
- [x] Add authenticated mobile endpoints for listing, detail review, approve intent, comment, reject, and signed PSBT submission.
- [x] Enforce mobile wallet permissions before exposing draft details or accepting signatures.
- [x] Route mobile signed PSBT submissions through the existing draft update/signature path.
- [x] Add audit events for mobile approve, comment, reject, and sign actions.
- [x] Add OpenAPI coverage and focused route, service, repository, and route-registration tests.
- [x] Run Phase 14 targeted verification.
- [x] Add operator docs for registering agents, issuing keys, submitting funding drafts, human review, owner overrides, monitoring, and restore checks.
- [x] Add agent wallet funding incident runbooks for suspected `agt_` key compromise, agent signer compromise, and operational wallet compromise.
- [x] Add release notes explaining the single-sig operational wallet boundary and human-review security model.
- [x] Include agent profiles, API key hashes/prefixes, funding attempts, alerts, and owner overrides in backup/restore table ordering.
- [x] Add backup-service tests for agent metadata export and ordering.
- [x] Add an end-to-end route smoke path for admin creates agent -> creates key -> agent submits signed PSBT -> human sees mobile review metadata.
- [x] Run Phase 15 targeted verification.

## Next Slices

- [x] Add admin/API management flows for registering agents and issuing/revoking `agt_` keys.
- [x] Decode and validate destination outputs against the linked operational wallet.
- [x] Validate that the submitted signed PSBT really contains the registered agent cosigner's partial signature.
- [x] Validate the PSBT spends only funding-wallet UTXOs and does not duplicate an active draft that locks the same UTXOs.
- [x] Enforce agent funding policies and rate limits.
- [x] Improve draft row and Telegram copy for agent funding requests.
- [x] Add notification dedupe for repeated agent submissions.
- [x] Add operational wallet monitoring alerts.
- [x] Phase 8: Decisions and safety hardening.
  - [x] Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - [x] Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with a per-agent PostgreSQL advisory lock.
  - [x] Record accepted and rejected agent funding attempts with reason codes.

## Future Implementation Roadmap

Detailed roadmap: `tasks/agent-wallet-funding-plan.md#future-work-roadmap`

Recommended order:

- [x] Phase 8: Decisions and safety hardening.
  - Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with the per-agent PostgreSQL advisory lock.
  - Record rejected agent funding attempts with reason codes.
- [x] Phase 9: Admin agent management UI.
  - Add admin list/create/edit/revoke flows for agents.
  - Add one-time `agt_` key creation display and key revocation UI.
  - Add linked wallet labels in wallet detail views.
- [x] Phase 10: Operational monitoring and alert rules.
  - Add refill/balance/large-spend/large-fee/repeated-failure alert policy.
  - Store alert history and dedupe threshold alerts.
- [x] Phase 11: Agent Wallets dashboard.
  - Show agent status, funding wallet, operational balance, pending drafts, recent spends, and alerts.
  - Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Phase 12: Operational address generation.
  - Generate next operational receive address when Sanctuary has enough watch-only descriptor metadata.
  - Preserve strict linked-address verification.
- [x] Phase 13: Owner override workflow.
  - Keep default over-cap behavior as hard reject.
  - Add bounded, human-created overrides with audit trail if needed.
- [x] Phase 14: Mobile approval foundation.
  - Add mobile-safe pending agent draft listing, review metadata, comments/rejection, and signer integration path.
- [x] Phase 15: Operational runbooks and E2E coverage.
  - Add docs, key compromise runbook, backup/restore expectations, release notes, and an e2e smoke path.

Next recommended implementation slice:

- [x] Run cross-phase corner-case audit from Phase 1 onward, then push all committed work.

## Review

Cross-phase audit update:

- Re-read the implementation surface from the first agent wallet funding commit through Phase 15, covering the server agent API, draft validation, policy enforcement, admin management, monitoring, dashboard, operational address generation, owner overrides, mobile review APIs, backup metadata, docs, and smoke coverage.
- Fixed a signer metadata edge case found during audit: draft signature updates now validate that any submitted `signedDeviceId` belongs to the draft wallet before appending it to `signedDeviceIds`. This protects the web, mobile, and agent signature-update paths that all delegate through `draftService.updateDraft`.
- Reconciled stale plan state: Phase 1 wallet role labels are implemented and tested, and the original open questions now point at the Phase 8, 12, 13, and 14 decisions.
- Confirmed the intended security boundary is still intact: Sanctuary stores no private keys, agent credentials cannot broadcast or approve policies, mobile approval intent does not sign or broadcast, and owner overrides are human-created, bounded, one-time funding exceptions.
- Remaining residual follow-up is deliberately outside this server-side phase set: robust unknown-destination/self-transfer classification for operational spends needs destination/counterparty detail in transaction notifications, and mobile client tests wait on the future mobile app.

Verification run:

- `cd server && npx vitest run tests/unit/services/draftService.test.ts` — 44 passed.
- `cd server && npx vitest run tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/agentOperationalAddressService.test.ts tests/unit/services/agentMonitoringService.test.ts` — 214 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Twelfth slice update:

- Added `docs/how-to/agent-wallet-funding.md` as the operator guide for registering agents, issuing runtime keys, validating agent funding drafts, human review, owner overrides, monitoring, backup/restore expectations, and targeted verification.
- Added agent wallet funding incident guidance to `docs/how-to/operations-runbooks.md`, including suspected `agt_` key compromise, agent signer compromise, and operational wallet private-key compromise.
- Added `docs/plans/agent-wallet-funding-release-notes.md` covering the release boundary, API surfaces, operator impact, backup/restore behavior, release gates, and known follow-up.
- Updated the docs index to link the new operator guide and release notes.
- Added agent metadata tables to backup/restore ordering: `walletAgent`, `agentApiKey`, `agentFundingOverride`, `agentAlert`, and `agentFundingAttempt`.
- Marked append-only agent alert and funding attempt history as large backup tables so backup export uses cursor pagination instead of loading all rows at once.
- Extended the Prisma test mock with agent override and alert delegates so backup tests can exercise the new tables.
- Added backup-service coverage proving agent profiles, API key hashes/prefixes, alerts, funding attempts, and owner overrides are exported with BigInt-safe serialization.
- Added `tests/unit/api/agent-wallet-funding-smoke.test.ts`, which exercises the full route path: admin registers agent, admin issues a scoped key, agent submits a signed funding draft, and a human/mobile reviewer receives decoded draft metadata and deep-link payloads.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/api/agent-routes.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/backupService.test.ts` — 149 passed.
- Post-review backup hardening check: `cd server && npx vitest run tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Edge case audit:

- Backups now include hashed agent credential records but still do not include raw `agt_` tokens.
- Agent backup ordering restores wallet/user/device prerequisites before `walletAgent`, then restores key, alert, attempt, and override records after the agent profile.
- Agent alert and funding attempt histories use cursor-paginated backup export because they can grow like audit logs.
- Agent funding attempts and owner override amounts preserve satoshi precision through existing `__bigint__` backup serialization.
- Operator docs explicitly distinguish `agt_` key compromise from agent signer private-key compromise; signer compromise is treated as wallet-descriptor compromise.
- Operational wallet compromise is documented as single-sig agent-controlled funds-at-risk, not as a Sanctuary signing failure.
- The smoke test asserts key hashes are not returned from key creation while the one-time `agt_` token is.
- The smoke test verifies submitted agent drafts keep agent id, operational wallet id, and signed-device metadata through to the human/mobile review payload.
- Residual follow-up: run the requested cross-phase audit before push.

Eleventh slice update:

- Added `GET /api/v1/mobile/agent-funding-drafts` and `GET /api/v1/mobile/agent-funding-drafts/:draftId` for mobile-safe review of pending agent funding drafts.
- Added mobile approve/comment/reject/signature routes under `/api/v1/mobile/agent-funding-drafts/:draftId/*`.
- Returned decoded draft summary metadata from stored PSBT-derived draft fields, including inputs, outputs, selected UTXOs, totals, change, input paths, linked operational wallet id, and wallet metadata.
- Added deep-link payloads that notification senders can reuse for `sanctuary://agent-funding-drafts/:draftId`, web review paths, and API review paths.
- Enforced mobile wallet permissions: `viewTransactions` gates visibility, `signPsbt` gates signed PSBT submission, and review actions require either `signPsbt` or `approveTransaction`.
- Kept approval semantics explicit: mobile approve records audited intent and next action, but it does not auto-sign, broadcast, or force policy approval.
- Routed mobile signed PSBT submission through `draftService.updateDraft`, preserving the existing web signing update path and signed-device aggregation behavior.
- Marked mobile rejections by setting draft `approvalStatus=rejected`, which removes the draft from future pending mobile review lists.
- Added audit events for mobile approve, comment, reject, and sign actions without logging signed PSBT material.
- Added OpenAPI schemas/paths and route registration for the new mobile agent draft API.

Verification run:

- `cd server && npx vitest run tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/routes.test.ts` — 33 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.

Edge case audit:

- Draft list limits are validated and bounded to 1-100 with a default of 25.
- Rejected, vetoed, expired, non-agent, and already-expired drafts are excluded from pending mobile review queries.
- General rejected-draft lookup remains available internally after a reject so the API can return the rejected review payload.
- BigInt satoshi values are serialized as decimal strings to avoid precision loss.
- Missing or null JSON draft fields are normalized to `null` in mobile summaries.
- A draft without `viewTransactions` mobile permission is not returned in lists or detail responses.
- A per-draft mobile permission denial during cross-wallet listing skips that draft instead of failing the whole list.
- Signature submission is denied unless mobile permissions allow `signPsbt`.
- Approver-only users can record review intent but receive `nextAction=none` unless they can also sign.
- Signed PSBT material is passed only to `draftService.updateDraft`; audit details record draft and device metadata, not PSBT content.
- Empty approve/comment/reject bodies are rejected where a comment or reason is required, and comments/reasons are trimmed and capped at 1000 characters.
- Residual follow-up: Phase 15 should add operational docs/runbooks and an e2e smoke test that exercises this flow from admin setup through agent draft submission and human review.

Tenth slice update:

- Added `AgentFundingOverride` persistence for one-time owner-created funding windows bounded by agent, funding wallet, operational wallet, amount, expiry, and status.
- Added admin override APIs: list, create, and revoke, with request validation, OpenAPI coverage, DTO serialization, and audit events for create/revoke.
- Updated funding policy so inactive agents, wrong operational-wallet destinations, and cooldowns remain hard failures; cap violations can proceed only when a matching active, unused, unexpired owner override covers the requested amount.
- Marked the matching override used after draft creation and added an override-use audit event linked to the created draft.
- Labeled override-funded agent drafts with `(owner override)` so human reviewers can distinguish exceptional funding from normal in-policy funding.
- Added Admin -> Wallet Agents override management so humans can view active/used/revoked/expired override history, create bounded overrides, and revoke active overrides. Agent credentials cannot call these admin routes.
- Post-commit hardening made override use conditional on `status=active`, `usedAt=null`, and `revokedAt=null`, bounded override listing to 25 rows by default, and documented the policy invariant that overrides waive caps only after status, destination, and cooldown checks pass.
- Kept Sanctuary's boundary intact: overrides do not sign, broadcast, store private keys, move funds directly, or change wallet descriptors.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/openapi.test.ts` — 84 passed.
- Post-hardening focused server check: `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 85 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 366 files / 8870 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 9 passed.
- Post-hardening focused frontend check: `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 10 passed.
- `npm run typecheck:app` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5535 tests passed. Existing jsdom navigation warning remains in `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx`.
- `git diff --check` — passed.

Edge case audit:

- Whitespace-only override reasons are trimmed before validation and rejected when empty.
- Override amounts must be positive and are serialized as strings to avoid satoshi precision loss.
- Expired overrides stay visible in history but cannot satisfy policy; the UI distinguishes expired active rows from currently usable overrides.
- Used and revoked overrides cannot be reused by policy because lookup requires `status=active`, `usedAt=null`, and `revokedAt=null`.
- Override consumption uses a conditional update so a stale or already-used row cannot be marked used a second time.
- Override list responses are bounded to 25 rows by default and allow an explicit validated limit up to 100.
- Cooldown enforcement runs before any override lookup, so an owner override cannot bypass agent cadence controls.
- Wrong operational-wallet submissions fail before override lookup, even if a broad override exists for the same agent.
- Revoked agents cannot receive new owner overrides.
- Override use is marked only after the draft is created, preventing a failed draft build from consuming the override.
- A used override records the draft id and emits a separate audit event for review/history correlation.
- Admin override UI handles empty, loading, error, create, revoke, expired, used, and revoked states without exposing the full agent API key material.
- Residual follow-up: Phase 14 should expose mobile-safe pending agent draft review, comments/rejection, and signer handoff paths.

Ninth slice update:

- Added a receive-address-specific address repository helper so agent operational address requests cannot return wallet change addresses.
- Added `getOrCreateOperationalReceiveAddress`, which returns an existing unused operational receive address or, when the linked single-sig operational wallet has descriptor metadata, derives and stores a fresh receive-address gap.
- Wrapped operational address generation in the existing per-agent advisory lock to avoid concurrent duplicate derivation for the same agent.
- Kept descriptorless operational wallets in read-only mode: they still fail closed instead of accepting an unverified agent-provided address.
- Updated `GET /api/v1/agent/wallets/:fundingWalletId/operational-address` to use the service and return `generated: true|false`.
- Added `POST /api/v1/agent/wallets/:fundingWalletId/operational-address/verify` so agents can preflight whether a provided destination is a known linked operational receive address.
- Updated OpenAPI docs/schema for the generated-address behavior.
- Kept Sanctuary's boundary intact: the endpoint derives watch-only receive addresses only; it does not store private keys, sign, broadcast, mark addresses used, or accept unverified destinations.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentOperationalAddressService.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/addressRepository.test.ts tests/unit/api/openapi.test.ts` — 86 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run test:unit` — 366 files / 8863 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Null/missing descriptors fail closed with an explicit invalid-input error instead of falling back to agent-provided data.
- Empty receive-address sets derive from index `0`; mixed receive/change history derives from the highest receive index plus one.
- Change-address paths are filtered out when selecting an unused operational receive address.
- Malformed derivation-path history is ignored for next-index calculation.
- Generated addresses are persisted as unused and the endpoint does not mark them used prematurely.
- The service validates derived paths are receive paths before storing a generated gap.
- The verification endpoint returns `verified=false` without wallet metadata for unknown addresses, other-wallet addresses, and change addresses.
- Unsupported operational wallet networks and non-single-sig operational wallets fail before derivation.
- A duplicate insert race re-reads the next unused receive address after `createMany(..., { skipDuplicates: true })`.
- Residual follow-up: Phase 13 will add human-created override workflows for exceptional over-cap funding; agent-created over-cap submissions remain rejected.

Eighth slice update:

- Added `GET /api/v1/admin/agents/dashboard` for operational dashboard rows with agent metadata, operational UTXO balance, pending funding draft counts, last funding request, last operational spend, open alert counts, active key counts, recent drafts, recent spends, recent alerts, and key metadata.
- Dashboard balances aggregate unspent operational wallet UTXOs from the database, so the totals come from the same source as wallet balance queries rather than cached UI state.
- Recent funding requests, operational spends, and open alerts are fetched with windowed bulk queries instead of per-agent query fan-out.
- Added frontend admin API bindings and an Admin -> Agent Wallets route.
- Added the Agent Wallets dashboard with spend-ready totals, operational balance totals, pending drafts, open alerts, funding/operational wallet links, review-drafts navigation, pause/unpause actions, and per-key revocation actions.
- Added expandable detail rows for policy settings, recent funding requests, operational spends, open alerts, and active keys.
- Kept Sanctuary's boundary intact: the dashboard does not sign, broadcast, move funds, store private keys, or alter wallet descriptors. Pause/unpause only updates the agent status used by the existing agent API gate.

Verification run:

- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/admin-agents-routes.test.ts` — 20 passed.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx tests/components/ui/Button.test.tsx tests/components/ui/LinkButton.test.tsx tests/components/ui/EmptyState.test.tsx tests/api/adminAgents.test.ts tests/src/app/appRoutes.test.ts` — 28 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5534 tests passed.
- `cd server && npm run test:unit` — 365 files / 8849 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty dashboard responses render a stable empty state.
- Load failures render retry UI and do not expose stale partial data.
- Dashboard date formatting handles missing values and invalid date strings.
- Dashboard satoshi formatting handles empty or malformed string values without crashing the page.
- Active key counts exclude revoked and expired keys on the server; the UI also filters inactive keys before showing revocation actions.
- Pending draft counts exclude expired drafts and include unsigned, partial, and signed drafts that still need human review or broadcast follow-up.
- Pause/unpause actions call the existing admin agent update endpoint, so paused agents are blocked by the existing agent API status checks.
- Revoke-key actions require confirmation and call the existing scoped key revoke endpoint; wallet descriptors are unchanged.
- Shared link-button styling has direct tests for default secondary links, custom variants/sizes, and forwarded React Router link props.
- Residual follow-up: Phase 12 still needs operational address generation for watch-only wallets with sufficient descriptor metadata.

Seventh slice update:

- Added operational monitoring policy fields to wallet agents: refill threshold, large-spend threshold, large-fee threshold, repeated-failure threshold/lookback, and alert dedupe window.
- Added persisted `AgentAlert` history with dedupe keys, severity/status, optional tx/amount/fee/threshold fields, rejected-attempt context, and JSON metadata for dashboard/mobile use.
- Added a repository-level advisory lock around alert dedupe check/write so concurrent alert evaluation cannot duplicate rows inside the dedupe window.
- Operational outgoing transaction notifications now also evaluate alert rules for linked active agents. Large spends and large fees dedupe per transaction; balance threshold alerts dedupe by agent/wallet/window.
- Rejected agent funding attempts now evaluate repeated-failure alert rules from stored monitoring records instead of logs.
- Added `GET /api/v1/admin/agents/:agentId/alerts` plus OpenAPI coverage and frontend admin API bindings.
- Added monitoring fields to the Admin -> Wallet Agents create/edit UI and summary rows.
- Kept Sanctuary's boundary intact: alerts observe and persist state only; they do not sign, broadcast, move funds, or store private keys.

Verification run:

- `cd server && npm run prisma:generate` — passed.
- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts` — 41 passed.
- `npx vitest run tests/api/adminAgents.test.ts tests/components/AgentManagement.test.tsx` — 8 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 364 files / 8843 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- Post-review targeted checks: `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/agent/dto.test.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` — 53 passed.
- Post-review targeted check: `npx vitest run tests/components/AgentManagement.test.tsx` — 6 passed.

Edge case audit:

- Alert rule fields are optional; blank create fields are omitted, and cleared edit fields are sent as `null`.
- Threshold values of `0`, `null`, or unset do not trigger alerts; positive thresholds are required before evaluation writes history.
- Transaction-specific large-spend and large-fee alerts use txid-based dedupe from epoch so retries cannot duplicate the same tx alert.
- Balance and repeated-failure alerts use a configurable dedupe window, defaulting to 60 minutes, to avoid writing on every sync.
- Alert dedupe uses a PostgreSQL advisory transaction lock keyed by dedupe key, preserving repeat alerts after the configured window while preventing concurrent duplicate writes inside the window.
- Monitoring failures are logged and swallowed so alert persistence cannot mask transaction notification delivery or agent API responses.
- Repeated-failure alerts count stored rejected attempts in the configured lookback window.
- Residual follow-up: unknown-destination/self-transfer classification and a dashboard/mobile alert review surface remain Phase 10 follow-up/Phase 11 work.

---

Sixth slice update:

- Added `GET /api/v1/admin/agents/options` so the admin UI can present valid user, funding-wallet, operational-wallet, and signer-device choices without ad hoc client-side discovery.
- Added frontend admin agent API bindings and typed metadata for agent profiles, options, scoped keys, create/update payloads, and one-time key creation responses.
- Added an Admin -> Wallet Agents section with summary stats, agent list rows, policy/status display, create/edit modals, revoke actions, scoped key issuance, one-time `agt_` token display, copy handling, and key revocation.
- Added UI filtering that mirrors core server validation: funding wallets are multisig, operational wallets are single-sig on the same network, both are scoped to the target user, and signer devices must be linked to the funding wallet.
- Added admin-only linked wallet badges in wallet detail headers for "Agent Funding Wallet" and "Agent Operational Wallet" context.
- Hardened UI edge cases for optional numeric policy fields, invalid expiration dates, unavailable clipboard APIs, and stale form selections after user/wallet changes.
- Post-review hardening: wallet detail now requests server-filtered agent links with `walletId`, admin badges align with the existing shared-wallet badge palette, key revoke text has a dark-mode state, and focused tests cover load errors, empty lists, clipboard failures, and admin-gated wallet-detail fetching.

Verification run:

- `npm run typecheck:app` — passed.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail/WalletHeader.test.tsx tests/api/adminAgents.test.ts` — 39 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 56 passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run build` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 363 files / 8837 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty agent lists render a stable empty state, and loading/error states do not expose partial data.
- Create submit stays disabled until a target user, funding wallet, operational wallet, signer, and non-empty name are selected.
- Editing does not allow changing immutable linkage fields; it only updates name, status, policy caps, cooldown, and notification/pause settings.
- Optional caps/cooldowns are omitted on create when blank and sent as `null` on update when cleared.
- Clipboard copy reports an action error when the browser clipboard API is unavailable or denies the write.
- Full `agt_` tokens are held only in the create-key modal state and are cleared when the modal closes.
- Wallet detail agent badges are fetched only for admins; non-admin wallet detail views do not call the admin agent endpoint.
- Residual follow-up: Phase 10 should add persisted alert thresholds/history for operational wallet monitoring beyond the current notification/pause behavior.

---

Fifth slice update:

- Resolved Phase 8 policy semantics in the plan:
  - Agent over-cap submissions remain hard rejected.
  - Human multisig signature is the approval for normal in-policy funding.
  - Agent-provided operational destinations are accepted only when Sanctuary verifies they belong to the linked operational wallet.
  - Concurrent agent drafts are allowed only when they do not violate UTXO locks or aggregate policy caps.
- Added `AgentFundingAttempt` persistence for accepted/rejected funding attempts, including agent id, key metadata, wallet ids, amount, fee rate, recipient, reason code/message, and request metadata.
- Wrapped agent funding policy evaluation, draft creation, UTXO locking, and `lastFundingDraftAt` update in a per-agent PostgreSQL advisory lock.
- Recorded rejected funding attempts on validation, policy, scope, PSBT, and lock failures without hiding the original API error.
- Recorded accepted attempts after draft creation for monitoring symmetry.
- Updated OpenAPI text for the agent funding endpoint to state that agents cannot request/apply owner overrides.
- Added tests for advisory lock usage and funding attempt persistence/rejection recording.
- Post-review hardening: capped in-memory draft notification dedupe to 1,000 keys, aligned the agent funding draft badge with the existing shared palette, and changed the autonomous-spend warning into the standard amber callout pattern.

Verification run:

- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/openapi.test.ts` — 60 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 134 passed.
- `cd server && npm run test:unit` — 363 files / 8834 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run test:run` — 391 files / 5517 tests passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts` — 6 passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Rejected funding attempts are best-effort monitoring records; a failure to write the monitoring record does not mask the original validation/policy error.
- Accepted funding attempt recording is also best-effort and does not make Sanctuary a signer or custodian.
- The advisory lock serializes the critical section across app processes that share the same PostgreSQL database.
- The lock does not refactor all draft writes into one transaction client; if a database failure occurs after draft creation but before cadence update, the API can still surface an error after a draft exists. Daily/weekly aggregate caps still include stored drafts, while cooldown depends on `lastFundingDraftAt`.
- Address generation is intentionally deferred to Phase 12; Phase 8 keeps the stricter current behavior that only known linked operational addresses are returned/accepted.

---

Fourth slice update:

- Added admin-only agent management endpoints for listing, creating, updating, and revoking wallet agents.
- Added admin-only `agt_` key management endpoints for listing, issuing, and revoking scoped agent API keys. Full keys are returned only at creation time.
- Agent creation validates that the target user can access both linked wallets, the funding wallet is multisig, the operational wallet is single-sig, both wallets use the same network, and the registered signer device belongs to the funding wallet.
- Added per-agent policy fields and enforcement for per-request funding caps, operational-wallet balance caps, daily limits, weekly limits, cooldowns, active/revoked state, and linked destination wallet.
- Added agent linked-wallet read endpoints for minimal wallet summary and the next known unused operational receive address.
- Added an agent draft-signature update endpoint that lets an agent refresh the agent signature on its own draft while reusing the same PSBT validation path and existing draft lock.
- Agent-created drafts now store `agentId` and `agentOperationalWalletId`, use a default agent funding label when none is provided, and surface agent metadata through the draft API/client type.
- Telegram draft notifications now use agent-specific copy, include the linked operational wallet name when known, show whether the agent signature is present, warn about post-funding autonomy, and notify only owner/signer wallet parties for agent drafts.
- Draft notification dedupe suppresses repeated agent funding notifications with the same agent/wallet/recipient/amount key for 10 minutes.
- Operational-wallet outgoing transaction notifications are enriched as agent operational spends; configured agents can be auto-paused after such a spend.
- The draft row now labels agent funding requests, shows the linked operational wallet destination context, shows agent signature state, and warns that the operational wallet can spend without multisig approval once funded.
- OpenAPI coverage was added for the admin agent endpoints and agent read/update endpoints.

Verification run:

- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 131 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/openapi.test.ts` — 43 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run test:unit` — 363 files / 8831 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run test:run` — 391 files / 5517 tests passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Null, blank, unknown, expired, malformed, and revoked agent API keys are rejected before route handlers run.
- Agent profiles that are paused, revoked, or linked to different wallets cannot submit funding drafts.
- Admin agent creation rejects same-wallet links, nonexistent users/wallets, wrong wallet types, network mismatches, inaccessible wallets, and signer devices not attached to the funding wallet.
- Agent funding requests reject missing or malformed PSBTs, PSBT transaction mismatches, duplicate inputs, empty inputs/outputs, unknown outputs, missing recipient payment, amount mismatches, spent/frozen/locked UTXOs, and missing/invalid registered signer partial signatures.
- Fee rate must be finite and inside Sanctuary's configured global min/max bounds.
- Per-request, daily, weekly, cooldown, and operational balance caps reject over-limit requests before drafts are stored.
- Agent signature refreshes are limited to the agent's own drafts and tolerate that draft's existing lock while still rejecting conflicting locks from other drafts.
- Telegram agent draft notifications no longer reference a human creator and do not suppress the linked human owner/signer.
- Viewer-only wallet users are not selected for Telegram agent funding draft notifications.
- Duplicate agent draft notification keys are suppressed for a bounded TTL and old keys are pruned opportunistically.
- Operational spend enrichment only runs for outgoing transactions and only for active agents linked to that operational wallet.
- Residual concurrency risk: policy cap checks and draft creation are not wrapped in a serializable transaction, so simultaneous submissions could race on aggregate daily/weekly totals. UTXO draft locks still prevent double-spending the same inputs.

Follow-up work:

- Add a richer admin UI for agent profile/key management instead of API-only management.
- Add an Agent Wallets dashboard section with funding wallet, operational balance, status, and alert summaries.
- Decide whether operational receive addresses should be generated by Sanctuary on demand or only read from already-derived watch-only addresses.
- Decide whether owner override for over-cap funding should exist or whether caps remain hard rejects.
- Consider moving policy evaluation plus draft creation into one serializable database transaction if high-concurrency agent submissions become realistic.
- Extend mobile approval once the mobile app exists.

---

Third slice update:

- Added `agentFundingDraftValidation`, which decodes the unsigned and signed PSBTs before accepting an agent funding draft.
- The signed PSBT must have the same unsigned transaction shape as the submitted draft PSBT.
- Every input must be an available funding-wallet UTXO, and spent, frozen, missing, or draft-locked inputs are rejected.
- Every output must be either a linked operational-wallet payment or funding-wallet change. Unknown outputs are rejected.
- The submitted `recipient` must belong to the operational wallet and `amount` must equal the total paid to that wallet.
- Draft display and locking metadata is now derived from the decoded PSBT: selected outpoints, inputs, outputs, fee, totals, change, RBF signaling, and signer input paths.
- The agent route no longer trusts agent-provided `selectedUtxoIds`, output/input JSON, fee totals, change values, `payjoinUrl`, or `isRBF`; it always creates a non-RBF draft lock for agent funding submissions.
- The signed PSBT must include a cryptographically valid partial signature from the registered agent signer fingerprint on every input.
- Added repository support for exact outpoint lookup with spent/frozen/draft-lock state.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/utxoRepository.test.ts` — 35 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 361 files / 8815 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing or malformed PSBTs: rejected.
- Signed PSBT transaction mismatch from the unsigned draft PSBT: rejected.
- Empty input or output sets: rejected.
- Missing funding-wallet input UTXOs: rejected.
- Already-spent, frozen, or draft-locked funding UTXOs: rejected.
- Outputs to non-wallet addresses or non-standard scripts: rejected.
- Recipient not in the linked operational wallet: rejected.
- Declared amount differing from decoded operational-wallet payment total: rejected.
- Invalid signer device fingerprint format: rejected.
- Missing or invalid registered agent partial signature on any input: rejected.
- Funding and operational wallet network mismatch or address overlap: rejected.

Follow-up work:

- Add admin/API management flows for registering agents and issuing/revoking `agt_` keys.
- Add policy caps, fee-rate bounds, and rate limits for agent funding requests.
- Improve human-visible draft and Telegram copy for linked operational-wallet destinations.
- Add notification dedupe and operational wallet monitoring.

---

Implemented the second server slice for agent multisig funding:

- `POST /api/v1/wallets/:walletId/drafts` now accepts `signedPsbtBase64` and `signedDeviceId` alongside the unsigned PSBT payload.
- If one initial signature field is present without the other, draft creation is rejected.
- If both are present, Sanctuary verifies the `signedDeviceId` is linked to the funding wallet before creating the draft.
- Accepted initial signatures create a normal draft with `status = partial`, `signedPsbtBase64` set, and `signedDeviceIds = [signedDeviceId]`.
- Added `WalletAgent` and `AgentApiKey` persistence, with `agt_` scoped bearer keys stored as hashes and separated from read-only MCP keys.
- Added `/api/v1/agent/wallets/:fundingWalletId/funding-drafts`, scoped to one funding wallet, one operational wallet, and one signer device.
- Agent-created drafts pass `notificationCreatedByUserId = null`, so Telegram draft notifications go to all eligible wallet parties and show the agent label as the creator.
- Agent submissions are audit logged with agent id, key prefix, wallet ids, signer device id, draft id, amount, and fee rate.
- OpenAPI now declares `agentBearerAuth` and documents the agent funding route. The pre-existing admin MCP key route coverage gap is also documented.
- The Prisma import guardrail no longer needs the transaction export route exception because repeatable-read export transactions now go through the transaction repository.

Verification run:

- `cd server && npx vitest run tests/unit/agent/auth.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/agent-routes.test.ts tests/unit/routes.test.ts tests/unit/api/openapi.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts` — 129 passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/handlers.test.ts` — 15 passed.
- `cd server && npm run test:unit` — 360 files / 8807 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `cd server && npm run build` — passed.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing `signedPsbtBase64` or missing `signedDeviceId`: rejected.
- Empty initial signature fields: rejected by route validation and service validation.
- Unknown signer device id: rejected before persistence.
- Wallet missing during signer validation: rejected.
- Existing unsigned draft creation path stays unchanged.
- RBF UTXO locking behavior stays unchanged.
- Missing, malformed, unknown, revoked, or expired `agt_` keys: rejected.
- Paused/revoked agent profile: rejected.
- Funding wallet id mismatch: rejected.
- Operational wallet id mismatch: rejected.
- Agent key without `create_funding_draft` scope: rejected.
- Agent-created drafts do not suppress notifications to the linked human user.
- Empty route body and missing required agent funding fields: rejected before service calls.

Follow-up work:

- Validate PSBT contents against funding-wallet UTXOs and operational-wallet destination addresses.
- Validate the agent cosigner's actual partial signature, not only the signer device metadata.
- Add admin/UI flows for creating agents and issuing/revoking agent API keys.
- Enforce agent-specific funding policy caps, rate limits, notification dedupe, and richer notification copy.

---

# HttpOnly cookie auth + refresh flow migration — implementation plan

ADRs:
- `docs/adr/0001-browser-auth-token-storage.md` — Accepted 2026-04-12
- `docs/adr/0002-frontend-refresh-flow.md` — Proposed; awaiting user review

Branch strategy: one PR per phase. Each phase is independently revertible. Do not start a phase until the previous one is merged and CI is green on `main`.

**Resolved decisions** (from the user check-in on 2026-04-12, applying the "no cutting corners" working rule):

1. **CSRF library:** `csrf-csrf` (modern, server-stateless double-submit, well-maintained).
2. **Cookie names:** `sanctuary_access` (HttpOnly access token), `sanctuary_csrf` (readable double-submit token), `sanctuary_refresh` (HttpOnly refresh token, scoped to `/api/v1/auth/refresh`). All snake_case to match the existing `sanctuary_token` convention in `src/api/client.ts:137`.
3. **`/auth/me` endpoint:** already exists at `server/src/api/auth/profile.ts:20`. Reused as-is.
4. **Refresh flow:** included in this work, not deferred. Designed in ADR 0002. Implementation lands in Phase 4.

## Phase 0 — ADR 0002 review and acceptance — COMPLETE 2026-04-12

Goal: the refresh-flow design is reviewed, accepted, and ready to merge into Phase 4. This is a documentation-only phase but it gates everything else — the design must land before any cookie code is written, since the cookie shape (`sanctuary_refresh` scoped to `/api/v1/auth/refresh`) is decided here.

- [x] User reviews `docs/adr/0002-frontend-refresh-flow.md`.
- [x] Push back on any design decisions or accept as-is. (Codex review caught the BroadcastChannel-as-mutex race; ADR 0002 was revised from Option C to Option E — Web Locks API + BroadcastChannel for state propagation only.)
- [x] Mark ADR 0002 status from "Proposed" to "Accepted".
- [x] Update the cross-reference in ADR 0001 to also say "Accepted".

**Exit criteria:** ADR 0002 status is Accepted. ✓ Open questions inside ADR 0002 (refresh lead time, refresh token TTL, WebSocket reconnect on refresh, logout-all UI, Page Visibility API behavior) are deferred to implementation time per the ADR's own "Open questions" section — they do not block Phase 1.

## Phase 1 — Backend foundation (PR 1)

Goal: the backend can verify either a cookie+CSRF or an `Authorization: Bearer` header on every protected route, but no route is yet *issuing* cookies. This phase ships behind no flag and changes no behavior; it just teaches the auth middleware to recognize cookies.

- [ ] Add `cookie-parser` to `server/package.json` and wire it into `server/src/index.ts` before the auth middleware runs.
- [ ] Add `csrf-csrf` to `server/package.json`. Capture the version pin in the PR description.
- [ ] Add CSRF middleware to `server/src/middleware/csrf.ts` using `csrf-csrf`'s `doubleCsrf` factory. Use a stable secret derived from the existing JWT secret material so deployers do not need to add a new env var.
- [ ] Update `server/src/middleware/auth.ts` to read the access token from a `sanctuary_access` cookie when no Authorization header is present.
- [ ] When the request authenticated via cookie, require a valid `X-CSRF-Token` for POST/PUT/PATCH/DELETE. The Authorization-header path is exempt (mobile/gateway).
- [ ] Tests:
  - [ ] `server/tests/unit/middleware/auth.test.ts` — cookie-only auth, header-only auth, both present (cookie wins), neither (401).
  - [ ] `server/tests/unit/middleware/csrf.test.ts` (new) — POST without token rejected, with wrong token rejected, with correct token accepted, GET exempt.
  - [ ] No regression in `server/tests/unit/middleware/gatewayAuth.test.ts`.

**Exit criteria:** `cd server && npm run build`, `cd server && npx vitest run tests/unit/middleware/`, and the existing auth integration suite all pass. No frontend changes yet. No client breaks because no route is *issuing* cookies yet.

## Phase 2 — Backend response cookies + expiry header (PR 2)

Goal: auth endpoints set the cookies on success, clear them on logout, and surface access-token expiry to the client via `X-Access-Expires-At`. The JSON `token`/`refreshToken` fields stay in the response body for one release as a rollback safety net.

- [ ] `server/src/api/auth/login.ts:187-313` — on successful login set:
  - [ ] `sanctuary_access` (HttpOnly, Secure, SameSite=Strict, path `/`, Max-Age = access TTL in seconds)
  - [ ] `sanctuary_refresh` (HttpOnly, Secure, SameSite=Strict, **path `/api/v1/auth/refresh`**, Max-Age = refresh TTL in seconds)
  - [ ] `sanctuary_csrf` (Secure, SameSite=Strict, **NOT HttpOnly** so the frontend can read it)
  - [ ] `X-Access-Expires-At` response header with the access token's `exp` claim as ISO 8601.
  - [ ] Keep the JSON `token`/`refreshToken` fields for one release.
- [ ] `server/src/api/auth/twoFactor/verify.ts:33-140` — same treatment on 2FA success.
- [ ] `server/src/api/auth/tokens.ts:28-81` (refresh):
  - [ ] Read refresh token from `sanctuary_refresh` cookie when the request body has no `refreshToken` field.
  - [ ] Issue rotated `sanctuary_access`, `sanctuary_refresh`, and `sanctuary_csrf` cookies on success.
  - [ ] Set `X-Access-Expires-At` on the response.
  - [ ] Keep accepting the body field for the gateway/mobile path.
- [ ] `server/src/api/auth/tokens.ts:87-160` (logout, logout-all) — clear all three cookies via `Set-Cookie` with `Max-Age=0`.
- [ ] `server/src/api/auth/profile.ts:20` (`/auth/me`) — set `X-Access-Expires-At` on the response so the client can schedule its first refresh after a page reload without an explicit refresh.
- [ ] Update OpenAPI auth response schemas in `server/src/api/openapi/` to document `cookieAuth` and `csrfToken` security schemes alongside the existing `bearerAuth`.
- [ ] Tests:
  - [ ] `server/tests/unit/api/auth.test.ts` and the 2FA verify tests — assert all three Set-Cookie headers carry the expected attributes (HttpOnly where applicable, Secure, SameSite=Strict, expected paths, expected Max-Age).
  - [ ] Logout test — assert all three cookies cleared.
  - [ ] Refresh tests:
    - [ ] Refresh from cookie alone succeeds and rotates the cookies.
    - [ ] Refresh from body alone still succeeds (mobile path regression).
    - [ ] Refresh with both present uses the cookie.
    - [ ] Failed refresh (revoked token) returns 401 and clears the cookies.
  - [ ] Every auth response carries `X-Access-Expires-At` with a valid ISO 8601 timestamp matching the JWT `exp` claim.
  - [ ] OpenAPI tests still pass with the new security schemes documented.

**Exit criteria:** server builds, all auth tests pass, no frontend changes yet, mobile/gateway path still uses the JSON token in the response body.

## Phase 3 — Backend WebSocket cookie reading (PR 3)

Goal: WebSocket upgrades on the same origin authenticate via cookie. The deprecated query parameter token path is removed in the same change.

- [ ] `server/src/websocket/auth.ts:56-72` — extract token from `sanctuary_access` cookie when no Authorization header is present. Use a small cookie-parsing helper (or import from cookie-parser) — do not regex-extract.
- [ ] Remove the deprecated query parameter token path (`server/src/websocket/auth.ts:62-69`). It has been deprecated long enough and removing it eliminates a token-leakage vector via referer headers / server logs.
- [ ] The auth-message-after-connect path (lines 136-191) stays for clients that prefer it. A same-origin browser will normally not need it.
- [ ] Confirm `server/src/utils/jwt.ts` continues to honor the original `exp` claim of an access token until that timestamp passes — so an existing WebSocket connection authenticated with the previous access token survives a cookie rotation. This is one of the open questions in ADR 0002 and the answer governs whether we need to force a WS reconnect on refresh.
- [ ] Tests:
  - [ ] `server/tests/unit/websocket/auth.test.ts`:
    - [ ] Upgrade with valid cookie + no header succeeds.
    - [ ] Upgrade with header only still works (gateway/mobile regression).
    - [ ] Upgrade with deprecated query parameter is now rejected.
    - [ ] Upgrade with a 2FA pending token in the cookie is rejected (the existing `pending2FA` check at line 28 still applies).
  - [ ] `server/tests/integration/websocket/websocket.integration.test.ts` regression check.

**Exit criteria:** all WebSocket auth tests pass, no broken regressions in the WS integration suite, the deprecated query parameter path is gone from the codebase (also remove any client code that emitted it).

## Phase 4 — Frontend cookie auth + refresh flow (PR 4)

This is the biggest phase. It implements both ADR 0001 (cookies replace storage) and ADR 0002 (refresh flow) on the frontend in a single coherent change. Splitting them would mean rewriting `src/api/client.ts` twice.

### 4a — Cookie-based request path

- [ ] `src/api/client.ts` — switch every fetch call (`request`, `fetchBlob`, `download`, `upload`) to `credentials: 'include'`.
- [ ] `src/api/client.ts` — remove `TokenStorageMode`, `getTokenStorageMode`, `getBrowserStorage`, `getPrimaryTokenStorage`, `readStoredToken`, `writeStoredToken`, the legacy localStorage migration block, the `setToken`/`getToken` exports, and the `Authorization` header injection.
- [ ] `src/api/client.ts` — add a CSRF token reader that reads `sanctuary_csrf` from `document.cookie` and injects it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE.

### 4b — Refresh primitive with Web Lock + freshness check

**This is the section that changed after Codex review caught a cross-tab race in the BroadcastChannel-only design. See ADR 0002 Option C (rejected) and Option E (recommended) for the design rationale.**

- [ ] New module `src/api/refresh.ts` (or co-located in `client.ts` if it fits cleanly).
- [ ] Exports `refreshAccessToken()` returning a Promise.
- [ ] Within a single tab, uses single-flight semantics — concurrent callers receive the same in-flight Promise so the lock acquisition itself is not duplicated.
- [ ] The single-flight promise wraps `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })` for cross-tab mutual exclusion.
- [ ] Inside the lock callback:
  - [ ] **Freshness check first:** if `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS` (60_000), another tab already refreshed during the lock wait — return immediately with no network call.
  - [ ] Otherwise, send `POST /api/v1/auth/refresh` with `credentials: 'include'` and the CSRF header.
  - [ ] On success, parse `X-Access-Expires-At` from the response, update `accessExpiresAt`, broadcast `refresh-complete` with the new expiry, reschedule the local timer.
  - [ ] On failure, broadcast `logout-broadcast` and reject the promise.
- [ ] Lock release happens automatically when the callback returns or throws.

### 4c — Scheduled (proactive) refresh

- [ ] On every successful auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`), parse `X-Access-Expires-At` and schedule a `setTimeout` for `expiresAt - REFRESH_LEAD_TIME_MS` to call `refreshAccessToken()`.
- [ ] Clear the previous timer before scheduling a new one.
- [ ] Clear the timer on logout and on `beforeunload`.

### 4d — Reactive (401) refresh

- [ ] In `src/api/client.ts:request`, when a response status is 401 and the request was not already a retry, await `refreshAccessToken()` and replay the original request once.
- [ ] If the retry also fails with 401, do not retry again — surface the error and trigger logout.
- [ ] Non-401 failures (5xx, network) bypass the refresh path entirely.

### 4e — BroadcastChannel state propagation (NOT mutual exclusion)

- [ ] On client init, open `new BroadcastChannel('sanctuary-auth')`. Mockable for tests via dependency injection.
- [ ] On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local timer.
- [ ] On `logout-broadcast` from another tab, trigger the local logout flow.
- [ ] **Do not implement a `refresh-start` event.** The Web Lock is the start signal. BroadcastChannel is async pub/sub and cannot prevent races; using it as a coordination primitive was the bug Codex caught in the original ADR draft.
- [ ] Close the channel on `beforeunload`.

### 4f — UserContext + logout flow

- [ ] `contexts/UserContext.tsx`:
  - [ ] Stop calling `apiClient.setToken`. The login/2FA-verify handlers no longer touch token storage.
  - [ ] On app boot, call `/api/v1/auth/me`. If it succeeds, hydrate the user and schedule the refresh timer from the response header. If it returns 401, render the login screen.
  - [ ] Logout: clear the scheduled refresh timer, broadcast `logout-broadcast`, redirect to login. Both terminal refresh failure and explicit user logout share this path.

### 4g — Tests

- [ ] `tests/setup.ts`:
  - [ ] Add a `navigator.locks` mock that maintains a Map of held lock names with FIFO waiters and supports multi-instance "tab" simulation. Pure in-memory, no network or filesystem.
  - [ ] Add a BroadcastChannel polyfill or mock that supports multi-instance same-channel pub/sub for the test where two simulated tabs interact.
- [ ] `tests/api/client.test.ts`:
  - [ ] Replace storage mode tests with: every request includes `credentials: 'include'`, non-GET requests include `X-CSRF-Token` from the readable cookie.
  - [ ] `setToken`/`getToken` no longer exist (compile-time error if referenced).
  - [ ] `request()` parses `X-Access-Expires-At` and updates internal state.
- [ ] `tests/api/refresh.test.ts` (new):
  - [ ] Within-tab single-flight: two concurrent `refreshAccessToken()` calls return the same promise; the underlying fetch is called exactly once; the Web Lock is acquired exactly once.
  - [ ] Proactive refresh: with fake timers, advancing past `expiresAt - REFRESH_LEAD_TIME_MS` triggers a refresh exactly once; the new expiry is honored; the timer reschedules itself.
  - [ ] Reactive refresh: a 401 response triggers a refresh and retries the original request; retry success surfaces normally; retry failure surfaces the second 401 and triggers logout.
  - [ ] **Cross-tab Web Lock serialization (the test that catches the bug Codex flagged):** simulate two tabs sharing the same lock state. Both tabs trigger `refreshAccessToken()` simultaneously. Assert exactly one `POST /auth/refresh` is sent across both tabs (the second tab waits on the lock, sees fresh `accessExpiresAt` after the broadcast handler ran, and short-circuits).
  - [ ] Cross-tab race with stale broadcast: same setup, broadcast handler delayed. Assert the second tab still sends its refresh, the second refresh succeeds, and no logout fires (the "wasted refresh but not broken" path).
  - [ ] BroadcastChannel state propagation: `refresh-complete` from another tab updates `accessExpiresAt` and reschedules the timer; `logout-broadcast` triggers the local logout flow.
  - [ ] Terminal refresh failure: server returns 401 on `/auth/refresh`. Assert lock is released, `logout-broadcast` is sent, local logout flow fires.
  - [ ] Non-401 failures (500, network error) do not trigger a refresh attempt.
- [ ] `tests/contexts/UserContext.test.tsx`:
  - [ ] Logout clears the scheduled refresh timer and broadcasts `logout-broadcast`.
  - [ ] On app boot, `/auth/me` is called; success hydrates user + schedules refresh; 401 renders login screen.
- [ ] All existing `apiClient.setToken` test references are removed.
- [ ] Component tests that previously relied on `apiClient.setToken` to seed an authenticated state are updated to mock `/auth/me` instead.
- [ ] Frontend strict typecheck and 100% coverage gate must stay green, including the freshness short-circuit branch and the lock-held-by-another-tab branch.

**Exit criteria:** `npm run typecheck:app`, `npm run typecheck:tests`, `npm run test:coverage` all pass with 100% coverage. `./start.sh --rebuild` and a manual login + 2FA + WebSocket-bearing page works end-to-end in a browser. Verify in browser devtools that:
- The access cookie is HttpOnly (script cannot read it via `document.cookie`).
- The CSRF cookie is readable and is echoed in the `X-CSRF-Token` header on POSTs.
- A scheduled refresh fires before the access token expires.
- Forcing a 401 (e.g., by waiting past expiry without scheduled refresh) triggers a transparent refresh + retry.
- Two open tabs do not race the refresh; the second tab uses the rotated cookie without making its own refresh call.

## Phase 5 — Documentation (PR 5) — COMPLETE 2026-04-13

Goal: the new model is captured in operations and release docs so the next operator does not have to read both ADRs to understand the system.

- [x] `docs/how-to/operations-runbooks.md`:
  - [x] Add the cookie + Secure + TLS termination requirement.
  - [x] Document the CSRF token rotation behavior.
  - [x] Document the refresh token TTL and rotation.
  - [x] Document the BroadcastChannel cross-tab coordination so an operator debugging "why did all my tabs log out at once" knows where to look.
- [x] `docs/reference/release-gates.md` — cookie/CSRF/refresh test suite added to the Browser auth and CSP gate; Phase 4 Browser Auth Gate section rewritten from "remaining architecture decision" to "resolved 2026-04-13".
- [x] `docs/plans/codebase-health-assessment.md`:
  - [x] Security row moved from B to A- (partial schema coverage + accepted dependency findings keep it from a clean A).
  - [x] HttpOnly-cookie ADR row removed from outstanding items table.
  - [x] Ninth Phase 4 slice section records the ADR 0001/0002 implementation and the undocumented refresh-flow gap closure.
- [x] `docs/adr/0001-browser-auth-token-storage.md` — Resolution section added with full commit history, Codex-caught bug list, and Security grade movement.
- [x] `docs/adr/0002-frontend-refresh-flow.md` — Resolution section added with implementation summary, test coverage list, Codex-caught bugs specific to the refresh flow, and answers to all 5 "open questions."
- [x] OpenAPI: `cookieAuth` and `csrfToken` security schemes are now **referenced** from every browser-mounted protected route (not just declared in `components.securitySchemes`). Added `server/src/api/openapi/security.ts` exporting `browserOrBearerAuth = [{ bearerAuth: [] }, { cookieAuth: [], csrfToken: [] }]` and `internalBearerAuth = [{ bearerAuth: [] }]`; every path file (auth, admin, ai, bitcoin, devices, drafts, intelligence, labels, mobilePermissions, payjoin, push, transactions, transfers, walletExport, walletHelpers, walletImport, walletPolicies, walletSettings, walletSharing, wallets) imports the shared constant; `internal.ts` continues to use bearer-only because the `/internal/ai/*` routes are proxied by the AI container, not reachable from browsers. Test assertions in `server/tests/unit/api/openapi.test.ts` updated to `browserOrBearerAuthSecurity` for browser routes and `bearerOnlyAuthSecurity` for internal routes. Caught by Codex stop-time review of Phase 5 — the original carry-over only verified the schemes were *declared*, not *referenced*.

**Exit criteria:** ✓ docs reviewed, both ADR resolution sections filled in, codebase health assessment grade movement recorded.

## Phase 6 — Deprecation removal (PR 6) — COMPLETE 2026-04-13

Goal: remove the rollback safety net once we are confident the cookie + refresh path is stable.

**Scope note:** the original Phase 6 plan assumed browser-mounted and gateway-mounted auth routes were separately mounted. They aren't — there's a single `authRouter` under `/api/v1/auth` that serves both browsers and the gateway's transparent proxy. Mobile is not currently an active consumer. Given that, Phase 6 strips the JSON `token`/`refreshToken` fields from **all** callers of the auth router. If/when a mobile client ships, it will need to authenticate via cookies OR the auth flow will need a cryptographically-verified gateway channel (the `shared/utils/gatewayAuth.ts` HMAC primitive is the obvious building block). That future work is explicitly out of scope here.

- [x] Remove the JSON `token`/`refreshToken` fields from `/auth/register`, `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` response bodies (`server/src/api/auth/login.ts`, `server/src/api/auth/twoFactor/verify.ts`, `server/src/api/auth/tokens.ts`). Rollback-safety-net comments replaced with Phase 6 rationale.
- [x] Update OpenAPI schemas to drop `token`/`refreshToken` from `LoginResponse` and `RefreshTokenResponse`; `RefreshTokenResponse.required` updated from `['token','refreshToken','expiresIn']` to `['expiresIn']`.
- [x] Remove `VITE_AUTH_TOKEN_STORAGE` leftover from `.env.example` (there was no `vite.config.ts` entry to remove — Phase 4 already did that).
- [x] Audit `src/api/client.ts` for Phase-4-era dead code. Confirmed clean: no `setToken`/`getToken`/`TokenStorageMode`/`readStoredToken`/`writeStoredToken`/`storedToken`/"rollback"/"legacy" references. Phase 4 removed all of it.
- [x] Update 12 unit test assertions in `server/tests/unit/api/auth.routes.registration.test.ts` and `server/tests/unit/api/auth.routes.2fa.test.ts` from `toBeDefined()` to `toBeUndefined()` for `response.body.token` / `response.body.refreshToken`. Where the assertion was load-bearing (rotation tests), replace with `Set-Cookie` content assertions.
- [x] Refactor integration tests in `server/tests/integration/flows/auth.integration.test.ts`, `admin.integration.test.ts`, and `security.integration.test.ts` to read tokens from the `sanctuary_access` / `sanctuary_refresh` Set-Cookie headers instead of the response body. Added `extractAuthTokens(response)` helper in `server/tests/integration/setup/helpers.ts`.

**Exit criteria achieved:**
- ✓ Backend builds and typechecks cleanly.
- ✓ Backend unit + integration test suites pass (8749 unit + 503 integration-skip-when-no-db).
- ✓ Frontend coverage gate stays at 100% (5475 tests).
- ✓ Gateway builds and 510 gateway tests pass.
- ✓ No test references `VITE_AUTH_TOKEN_STORAGE`.
- ✓ No test references `apiClient.setToken`.
- ✓ No production code reads or writes the JSON `token`/`refreshToken` field anywhere on the auth routes.

## Cross-phase guardrails

- Run the full local test suite + typechecks before pushing each phase. CLAUDE.md is explicit: "Do not rely on CI to catch test failures or type errors."
- Pre-commit hooks run AI agents whose feedback must be reviewed (CLAUDE.md "Run `git commit` in foreground"). Each phase commits in foreground.
- Per CLAUDE.md "When fixing CI failures... batch all related fixes together." If a phase touches a pattern (e.g., removing `apiClient.setToken`), grep the full repo for the pattern *before* committing so we do not ship one file at a time.
- The mobile gateway path (`gateway/`, `shared/utils/gatewayAuth.ts`) must remain untouched in functionality. Every phase should run `cd gateway && npm run build` and the gateway request-validation/proxy/HMAC tests as a regression check.
- The 100% frontend coverage gate is non-negotiable. If a refactor removes coverage, the missing branches must be added back in the same PR.
- Per the "no cutting corners" working rule: if a step would be easier by deferring a related concern, push back on the deferral first. The right question is "is the long-term solution healthier?" not "is this slice smaller?"
