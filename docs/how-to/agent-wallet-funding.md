# Agent Wallet Funding

This guide explains how to operate the agent funding flow where an external agent holds one signer key in a multisig funding wallet and controls a separate single-sig operational wallet. Sanctuary coordinates policy checks, draft review, notifications, and monitoring. Sanctuary does not store the agent private key and does not auto-sign for either party.

## Supported Boundary

- Funding wallet: multisig wallet managed in Sanctuary.
- Agent signer: a registered signing device on the funding wallet. The agent holds the corresponding private key outside Sanctuary.
- Human signer or approver: a wallet party who reviews and signs in Sanctuary or a future mobile client.
- Operational wallet: usually single-sig and agent-controlled. Sanctuary should hold watch-only metadata for address verification and monitoring.
- Agent credential: scoped `agt_` API key that can submit funding drafts only for its linked funding and operational wallet pair.

Agent credentials cannot broadcast, approve vault policies, manage wallet settings, create owner overrides, or submit drafts to arbitrary wallets.

## Prerequisites

1. Create or import the funding multisig wallet.
2. Add the agent signer device to the funding wallet.
3. Create or import the operational wallet as watch-only when possible.
4. Verify the funding and operational wallets use the same network.
5. Decide funding limits, operational balance thresholds, cooldown, and alert thresholds.
6. Configure Telegram/push notification recipients for human reviewers.

## Register An Agent

1. Open `Admin -> Wallet Agents`.
2. Create an agent with:
   - Target human owner.
   - Funding wallet.
   - Operational wallet.
   - Agent signer device.
   - Per-request funding cap.
   - Optional daily and weekly caps.
   - Optional cooldown.
   - Operational balance and spend alert thresholds.
3. Confirm the agent is `active`.
4. Open `Admin -> Agent Wallets` and confirm the dashboard row shows the funding wallet, operational wallet, status, active key count, alert count, and pending draft count.

## Issue A Runtime Key

1. From the agent record, create a key with `create_funding_draft`.
2. Store the returned `agt_` token in the agent runtime secret store immediately. Sanctuary shows the full token once.
3. Do not paste the token into logs, tickets, shell history, CI output, or chat.
4. Confirm the key appears by prefix only in Sanctuary.

## Agent Funding Draft Submission

The agent should:

1. Ask Sanctuary for a linked operational receive address when it needs a destination.
2. Build a PSBT that spends only funding-wallet UTXOs.
3. Pay only the linked operational wallet destination and funding-wallet change.
4. Partially sign every input with the registered agent signer key.
5. Submit the draft to:

```text
POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts
Authorization: Bearer agt_...
```

Sanctuary validates the agent scope, linked destination, funding-wallet UTXOs, frozen/spent state, active draft locks, policy limits, cooldown, and agent partial signatures. Accepted submissions become normal draft transactions with agent metadata.

## Human Review

Human reviewers should review the draft before signing:

1. Open the draft from Telegram/push notification, `Admin -> Agent Wallets`, wallet draft list, or mobile review API.
2. Confirm the destination is the linked operational wallet.
3. Confirm amount, fee, inputs, outputs, change, and signer metadata.
4. Reject anything unexpected.
5. Sign only after the decoded summary matches the intended funding.
6. Broadcast through the normal Sanctuary transaction flow after enough signatures exist.

Mobile foundation routes are available under:

```text
GET  /api/v1/mobile/agent-funding-drafts
GET  /api/v1/mobile/agent-funding-drafts/:draftId
POST /api/v1/mobile/agent-funding-drafts/:draftId/approve
POST /api/v1/mobile/agent-funding-drafts/:draftId/comment
POST /api/v1/mobile/agent-funding-drafts/:draftId/reject
POST /api/v1/mobile/agent-funding-drafts/:draftId/signature
```

Mobile approve/comment records review intent through the API response and audit trail. It does not sign, broadcast, or bypass multisig. Mobile signature submission must provide a signed PSBT and is routed through the same draft update path as web signing.

## Owner Overrides

Default behavior is hard rejection for over-cap agent funding. If an exceptional refill is required:

1. Create a one-time owner override from the agent management UI.
2. Bound it by amount and expiry.
3. Include a reason.
4. Verify the resulting draft label includes `(owner override)`.
5. Revoke unused overrides as soon as they are no longer needed.

Overrides do not bypass inactive-agent checks, wrong-destination checks, cooldown, signature validation, or human signing.

## Monitoring

Use `Admin -> Agent Wallets` for daily operation:

- Operational balance.
- Pending funding drafts.
- Recent funding attempts.
- Recent operational spends.
- Open alerts.
- Active key count.

Alert types to investigate:

- Low operational balance.
- Operational balance above expected maximum.
- Large operational spend.
- Large operational fee.
- Repeated rejected funding attempts.

## Backup And Restore Expectations

Sanctuary backups include agent profiles, API key hashes and prefixes, funding attempts, alerts, and owner override records. Backups do not include raw `agt_` API tokens or private keys. After restore:

1. Confirm agent records are present.
2. Confirm key prefixes and hashes restored, but do not expect the full tokens to be recoverable from backup.
3. Rotate any key whose raw token was not separately available in the runtime secret store.
4. Confirm operational wallet watch-only descriptors and addresses restored.
5. Run an agent funding smoke test in a non-production environment before re-enabling production agent runtimes.

## Verification

Run these targeted checks when changing the flow:

```bash
cd server
npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts
npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts
npx vitest run tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/services/mobileAgentDraftService.test.ts
npx vitest run tests/unit/services/backupService.test.ts
npm run build
```

For release candidates, also run the broader backend and frontend gates in `docs/reference/release-gates.md`.
