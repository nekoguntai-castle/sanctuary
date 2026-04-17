# Agent Wallet Funding Plan

Status: In progress - server primitives for linked agent metadata, scoped credentials, admin management, policy-gated funding draft submission, PSBT content validation, Telegram notification, draft-row display, operational monitoring policy, alert history, Agent Wallets dashboard, operational address generation, and owner funding overrides are implemented.

## Goal

Support an external agent that owns its own private keys, can request funding by submitting a partially signed multisig draft to Sanctuary, and can autonomously spend from a separate watch-only operational wallet once funded.

Sanctuary must remain a wallet coordinator. It must not store private keys or auto-sign transactions.

## Core Model

Use two linked wallets.

1. Agent Funding Wallet
   - Type: 2-of-2 multisig.
   - Cosigner A: agent-controlled multisig key.
   - Cosigner B: human-controlled key.
   - Sanctuary role: watch-only coordinator.
   - Purpose: human-approved funding gate.

2. Agent Operational Wallet
   - Type: single-sig watch-only wallet in Sanctuary.
   - Private key: held only by the agent.
   - Sanctuary role: monitor balances, UTXOs, and transactions.
   - Purpose: autonomous agent spending within a funded allowance.

Important boundary: once sats are in the operational wallet, the agent can spend them without multisig approval. Sanctuary can monitor, alert, and gate future funding, but cannot enforce approvals over that single-sig wallet unless the agent voluntarily routes spends through Sanctuary.

## Phase 1: Data Model And Metadata

- [x] Add an `Agent` or `WalletAgent` concept.
- [x] Track agent name, status, linked funding wallet, linked operational wallet, and agent cosigner device/account.
- [x] Support agent states: active, paused, revoked.
- [x] Add wallet relationship metadata for funding wallet to operational wallet.
- [ ] Add UI labels for "Agent Funding Wallet", "Agent Operational Wallet", and "Linked agent".
- [x] Make the relationship explicit enough that validation does not depend on labels or user-entered descriptions.

## Phase 2: Scoped Agent Draft Submit API

- [x] Add a scoped agent credential separate from human login and MCP.
- [x] Scope credentials to one agent and one funding wallet.
- [x] Allow only:
  - [x] Read minimal linked wallet summary.
  - [x] Read the next known unused receive address for the linked operational wallet, if configured.
  - [x] Submit funding drafts.
  - [x] Update the agent's own submitted draft with the agent signature.
- [x] Deny:
  - [x] Broadcast.
  - [x] Delete drafts.
  - [x] Approve policies.
  - [x] Manage wallet settings.
  - [x] Manage policies.
  - [x] Access unrelated wallets.
  - [x] Read sensitive descriptors beyond what is needed for draft submission.

Proposed endpoint:

```text
POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts
```

Example payload:

```json
{
  "operationalWalletId": "wallet-id",
  "psbtBase64": "...",
  "signedPsbtBase64": "...",
  "amount": 100000,
  "feeRate": 3.2,
  "outputs": [
    { "address": "bc1...", "amount": 100000 }
  ],
  "label": "Agent funding request"
}
```

## Phase 3: Draft Validation

Before accepting an agent-submitted draft, Sanctuary should verify:

- [x] The credential belongs to the linked agent.
- [x] The funding wallet is the configured multisig wallet.
- [x] The operational wallet is linked to the same agent.
- [x] Every destination output is either an address from the linked operational wallet or expected change back to the funding wallet.
- [x] The PSBT spends UTXOs from the funding wallet.
- [x] The PSBT does not spend frozen or draft-locked UTXOs.
- [x] The fee rate is within configured bounds.
- [x] The amount does not exceed configured policy caps.
- [x] The PSBT includes a valid partial signature from the registered agent cosigner.
- [x] The transaction is not already represented by another active draft that locks the same funding UTXOs.
- [x] Human-visible transaction metadata is derived from the decoded PSBT, not trusted from agent-provided fields.

If validation passes, create a normal Sanctuary draft with:

- [x] `status = partial`.
- [x] `signedPsbtBase64 = agent-signed PSBT`.
- [x] `signedDeviceIds = [agent signer id]`.
- [x] Label similar to `Agent funding request`.
- [x] Metadata linking the draft to the agent and operational wallet.

## Phase 4: Human Notification And Review

- [x] Extend Telegram draft notifications for agent-created funding requests.
- [x] Notify eligible funding wallet parties.
- [x] Avoid notifying unrelated viewers.
- [x] Add notification dedupe to prevent repeated agent submissions from spamming humans.
- [x] Show "Agent signed" in the draft row.
- [x] Show the destination as the linked operational wallet, not only as an address.
- [x] Warn clearly that once funded, the agent can spend from the operational wallet without further multisig approval.
- [x] Let the human complete signing through existing hardware wallet flows or future mobile signing.
- [x] Broadcast only after the human signature completes the 2-of-2 PSBT.

Suggested Telegram text:

```text
Agent funding request

Agent: Example Agent
From: Agent Funding Wallet
To: Agent Operational Wallet
Amount: 100,000 sats
Fee: 540 sats
Agent signature: present
Action: review and sign in Sanctuary
```

## Phase 5: Funding Policies

Add policies at the agent link level.

- [x] `maxFundingAmountSats`
- [x] `maxOperationalBalanceSats`
- [x] `dailyFundingLimitSats`
- [x] `weeklyFundingLimitSats`
- [x] `cooldownMinutes`
- [x] `allowedDestinationWalletId`
- [x] `requireHumanApproval = true`
- [x] `pauseOnUnexpectedSpend`
- [x] `notifyOnOperationalSpend = true`

Policy behavior:

- [x] Reject new funding drafts if the operational wallet balance is already above cap.
- [x] Reject or require owner override when requested amount exceeds cap.
- [x] Reject if the destination is not the linked operational wallet.
- [x] Reject or hold for review if the agent submits too frequently.
- [x] Notify and optionally pause future funding if the operational wallet spends unexpectedly.

## Phase 6: Operational Wallet Monitoring

Because the operational wallet is single-sig and agent-controlled, monitoring and refill gates are the safety layer.

- [x] Alert on outgoing transactions from the operational wallet.
- [x] Alert when balance falls below refill threshold.
- [x] Alert when balance exceeds expected maximum.
- [x] Alert on unconfirmed outgoing spend.
- [x] Alert on large fee spend.
- [x] Alert on repeated failed funding requests.
- [ ] Surface unknown or suspicious self-transfer classification issues.
- [x] Add an Agent Wallets dashboard section with funding wallet, operational balance, and status.

Example dashboard row:

```text
Agent          Funding Wallet      Operational Balance      Status
Example Agent  2-of-2 Treasury     82,000 sats              Active
```

## Phase 7: Future Mobile Approval

Design the review path so a mobile app can be added later.

- [ ] List pending agent funding drafts.
- [ ] Show decoded PSBT summary.
- [ ] Show linked operational wallet destination.
- [ ] Allow approve, reject, and comment.
- [ ] Allow mobile signing when a supported signer exists.
- [ ] Return a signed PSBT to Sanctuary or broadcast after policy checks.

## Security Constraints

- [x] Sanctuary never stores agent private keys.
- [x] Sanctuary never auto-signs for the agent or the human.
- [x] Agent credentials cannot broadcast.
- [x] Agent credentials cannot approve policies.
- [x] Agent credentials cannot manage policies or wallet settings.
- [x] Agent credentials cannot submit drafts to arbitrary wallets.
- [x] All agent draft submissions are audit logged.
- [x] Agent credentials can be revoked without changing wallet descriptors.
- [x] Human review always shows decoded transaction details.
- [x] Destination verification is descriptor or address based, not label based.

## MVP Scope

The smallest useful version:

- [x] Register an agent cosigner and link a funding wallet plus operational wallet.
- [x] Create a scoped agent draft-submit credential.
- [x] Let the agent submit a partially signed PSBT funding the linked operational wallet.
- [x] Validate destination, amount, fee, wallet ownership, and agent partial signature.
- [x] Create a partial draft in Sanctuary.
- [x] Send Telegram notification to the human signer or approver.
- [x] Let the human review, sign, and broadcast through existing Sanctuary flows.
- [x] Monitor operational wallet balance and outgoing spends.

## Open Questions

- [ ] Should the operational wallet receive address be generated by Sanctuary, by the agent, or either as long as Sanctuary verifies it belongs to the linked descriptor?
- [ ] Should agent funding drafts require an approval vote before human signing, or is the human signature itself the approval?
- [ ] Should owner override be allowed for over-cap funding, or should over-cap requests be hard rejected?
- [ ] Should the agent be allowed to submit multiple concurrent funding drafts?
- [ ] What should happen if the operational wallet spends to an unknown destination immediately after funding?
- [ ] Should this feature reuse the existing vault policy service or introduce an agent-specific policy layer that feeds into vault policies?

## Future Work Roadmap

This roadmap keeps safety-critical server behavior ahead of convenience UI. Sanctuary should remain a coordinator and notifier; it must not become an agent signer or a hidden custodian.

### Phase 8: Decisions And Safety Hardening

Goal: resolve policy semantics and close the remaining race before expanding usage through UI.

- [x] Decide operational receive address behavior:
  - Recommended: Sanctuary may derive/generate the next watch-only receive address from the operational wallet descriptor when none is available; agent-provided addresses are accepted only if Sanctuary verifies they belong to the linked operational wallet.
  - Do not allow unverified agent-provided destinations.
- [x] Decide over-cap behavior:
  - Recommended default: hard reject agent-submitted over-cap funding drafts.
  - Future owner override should be a human-initiated/admin action, not a hidden bypass that the agent can trigger.
- [x] Decide approval semantics:
  - Recommended default: the human multisig signature is the approval for normal in-policy funding.
  - Use explicit approval/voting only for policy override workflows.
- [x] Decide concurrent draft behavior:
  - Recommended default: allow concurrent drafts only when they do not share UTXOs and do not exceed aggregate policy caps.
- [x] Guard policy evaluation, draft creation, UTXO locking, and `lastFundingDraftAt` update with a per-agent PostgreSQL advisory lock.
- [x] Record accepted and rejected agent funding attempts with reason codes so repeated failures can be monitored.
- [x] Add tests that prove the route uses the per-agent funding lock and records rejected policy attempts.

Implementation note:

- The current hardening uses `pg_advisory_xact_lock` keyed by agent id to serialize the critical section across app processes. It does not yet refactor every draft repository call to use the same Prisma transaction client. That is a pragmatic step that closes the cap/cooldown race for normal deployments while avoiding a broad transaction-aware repository rewrite.

Acceptance criteria:

- [x] Concurrent submissions cannot exceed configured caps when all app instances use the agent funding route and the same database advisory lock.
- [x] A rejected policy check never creates a draft, never locks UTXOs, and can still be counted for repeated-failure alerts.
- [x] The behavior of over-cap requests is explicit in API responses, OpenAPI docs, and tests.
- [x] Operational addresses returned to agents are always verified as linked-wallet addresses.

Verification:

- [x] `cd server && npm run build`
- [x] `cd server && npm run check:prisma-imports`
- [x] `npm run check:api-body-validation`
- [x] `npm run check:openapi-route-coverage`
- [x] `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/openapi.test.ts`
- [x] `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts`
- [x] `cd server && npm run test:unit`
- [x] `npm run typecheck:app`
- [x] `npm run test:run`
- [x] `git diff --check`

### Phase 9: Admin Agent Management UI

Goal: make the existing admin APIs usable without manual API calls.

- [x] Add an Admin -> Agents section.
- [x] List agents with status, linked user, funding wallet, operational wallet, signer device, policy caps, key count, last funding draft time, and revoked state.
- [x] Create agent flow:
  - Select target user.
  - Select funding multisig wallet.
  - Select operational single-sig wallet on the same network.
  - Select signer device attached to the funding wallet.
  - Configure policy caps and notification flags.
- [x] Edit agent flow for name, status, policy caps, cooldown, operational-spend notification, and pause behavior.
- [x] Revoke agent flow with a clear warning that existing wallet descriptors are not changed.
- [x] API key management:
  - List key metadata only.
  - Create a new key and show the full `agt_` token exactly once.
  - Revoke keys idempotently.
- [x] Add wallet detail labels for "Agent Funding Wallet", "Agent Operational Wallet", and linked agent context.

Acceptance criteria:

- Admin users can complete agent registration, key issuance, key revocation, policy updates, and agent revocation through the UI.
- The full agent API key is never shown after the creation response.
- UI validation mirrors server validation closely enough to catch obvious type/network/wallet-role mistakes before submit.
- Non-admin users cannot reach or use the management views.

Verification:

- [x] `npm run typecheck:app`
- [x] `npx vitest run tests/components/AgentManagement.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail/WalletHeader.test.tsx tests/api/adminAgents.test.ts`
- [x] `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts`
- [x] `npm run check:api-body-validation`
- [x] `npm run check:openapi-route-coverage`
- [x] `cd server && npm run check:prisma-imports`
- [x] `cd server && npm run build`
- [x] `npm run test:run`
- [x] `cd server && npm run test:unit`
- [x] `git diff --check`

### Phase 10: Operational Monitoring And Alert Rules

Goal: convert passive operational wallet observation into actionable safety signals.

- [x] Add monitoring configuration to the agent profile:
  - `minOperationalBalanceSats` or `refillThresholdSats`
  - `largeOperationalSpendSats`
  - `largeOperationalFeeSats` and/or fee percent threshold
  - repeated failed funding request threshold and lookback window
- [x] Alert when operational balance falls below refill threshold.
- [x] Alert when operational balance exceeds expected maximum.
- [x] Alert on large outgoing operational spend.
- [x] Alert on large fee spend.
- [x] Alert on repeated rejected agent funding attempts.
- [x] Store alert history with dedupe keys and human-readable messages.
- [x] Expose admin alert history APIs for future dashboard/mobile use.
- [x] Add monitoring fields to the existing admin agent management UI.
- [x] Alert on repeated failed funding requests.
- [ ] Add unknown-destination handling mode: notify only, pause agent, or both.
- [ ] Improve classification for self-transfer/change-like transactions from the operational wallet.
- [x] Store enough alert history to power dashboards without scraping logs.

Acceptance criteria:

- Alerts are deduped with a repository-level advisory lock, testable, and evaluated through the existing operational transaction notification path.
- Balance threshold alerts do not spam on every sync while the balance remains unchanged.
- Operational outgoing activity can optionally pause future funding without revoking keys or mutating wallet descriptors.
- Failed request alerts use stored rejection records, not log parsing.

Verification:

- [x] Unit tests for balance thresholds, large-spend/fee classification, repeated failures, and dedupe.
- [x] API tests for admin alert history listing.
- [x] Component/API binding tests for monitoring policy fields.
- [x] `npm run test:run`
- [x] `cd server && npm run test:unit`
- Notification channel tests for Telegram/push payload shape once a push channel exists for this event.

### Phase 11: Agent Wallets Dashboard

Goal: give humans a single operational view for agent-controlled funds.

- [x] Add an Agent Wallets dashboard section.
- [x] Show agent name, status, funding wallet, operational wallet, operational balance, pending funding drafts, last funding request, last operational spend, and alert count.
- [x] Provide quick actions:
  - Review pending funding drafts.
  - Pause or unpause an agent.
  - Revoke an agent key.
  - Open linked funding wallet and operational wallet.
- [x] Add detail view for agent policy, recent funding requests, operational spends, alerts, and key metadata.

Acceptance criteria:

- [x] A human can answer: "Which agents can spend right now, how much do they have, and what needs my attention?"
- [x] Dashboard totals match wallet UTXO balance queries.
- [x] Pausing an agent from the dashboard immediately blocks future agent API submissions.

Verification:

- [x] Component tests for empty/loading/error/populated states.
- [x] Shared link-button tests for dashboard navigation actions.
- [x] API tests for the new dashboard aggregation endpoint.
- [x] `npm run test:run` for frontend regression coverage.

### Phase 12: Operational Address Generation

Goal: remove the current limitation where the agent endpoint only returns an already-known unused operational address.

- [x] Add a server service that can derive or create the next receive address for the operational watch-only wallet using existing descriptor/xpub logic.
- [x] Change the agent operational-address endpoint to return the next unused address and generate one when safe.
- [x] Preserve a read-only mode for wallets where Sanctuary lacks enough descriptor metadata to derive addresses.
- [x] Add an optional address verification endpoint if agents submit their own operational address.

Acceptance criteria:

- [x] The endpoint never returns an address that Sanctuary cannot prove belongs to the linked operational wallet.
- [x] Address generation preserves gap-limit behavior and does not mark addresses used prematurely.
- [x] Regtest/testnet/mainnet paths are covered by the existing descriptor derivation suite and Phase 12 service route coverage.

Verification:

- [x] Address derivation unit tests for supported script/network combinations.
- [x] Agent route tests for existing unused address, generated address behavior, and address verification payloads.
- [x] Service tests for descriptorless wallets, receive/change path filtering, generated receive gap persistence, derived non-receive path rejection, and verification failures.

### Phase 13: Owner Override Workflow

Goal: support exceptional funding without weakening the default agent guardrails.

- [x] Add an owner-initiated override flow for funding above normal caps.
- [x] Decide whether to reuse vault approvals or create an agent-specific override request type.
- [x] Require override reason, expiry, maximum amount, and target operational wallet.
- [x] Ensure the agent cannot create, approve, or extend an override.
- [x] Audit every override create/revoke/use event.

Acceptance criteria:

- [x] Normal agent submissions remain hard rejected unless a valid human-created override exists.
- [x] Overrides are bounded by amount, wallet, agent, and expiry.
- [x] The human review screen clearly distinguishes normal in-policy funding from override funding.

Verification:

- [x] Policy tests for no override, valid override, expired override, wrong agent, wrong wallet, amount over override, and one-time-use behavior if selected.
- [x] Audit log tests for override lifecycle.
- [x] Admin UI/API binding tests for listing, creating, and revoking overrides.

### Phase 14: Mobile Approval Foundation

Goal: prepare mobile review/signing without changing the core security boundary.

- [ ] Add API support for listing pending agent funding drafts with decoded PSBT summaries.
- [ ] Add mobile-friendly endpoints for approve/reject/comment metadata.
- [ ] Add deep-link payloads from Telegram/push notifications to the mobile review screen.
- [ ] Add mobile signing integration only when a supported signer is available.
- [ ] Return signed PSBTs to Sanctuary through the same draft update/signature path used by web signing.

Acceptance criteria:

- Mobile can review the same decoded transaction details as web.
- Mobile approval alone does not broadcast or bypass multisig requirements.
- Signing still requires the human signer device or supported mobile signer path.

Verification:

- API tests for pending draft listing, authorization, comment/reject actions, and PSBT summary shape.
- Mobile client tests once the mobile app exists.

### Phase 15: Operational Runbooks And E2E Coverage

Goal: make the feature operable and defensible before broader use.

- [ ] Add operator docs for creating an agent, issuing a key, funding, pausing, revoking, and rotating keys.
- [ ] Add a security runbook for suspected agent key compromise.
- [ ] Add an e2e smoke path for admin creates agent -> creates key -> agent submits signed PSBT -> human sees draft metadata.
- [ ] Add backup/restore expectations for agent metadata and API key hashes.
- [ ] Add release notes that explain the single-sig operational wallet boundary.

Acceptance criteria:

- A new operator can execute the happy path from docs without asking a developer.
- A compromised `agt_` key can be revoked without wallet descriptor changes.
- E2E coverage proves the main workflow does not regress.
