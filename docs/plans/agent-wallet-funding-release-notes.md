# Agent Wallet Funding Release Notes

Status: draft release notes for the agent wallet funding feature

## Summary

Sanctuary can now coordinate agent-to-agent funding without becoming an autonomous signer. An external agent can hold one signer key in a multisig funding wallet, submit a partially signed funding draft for its linked operational wallet, and rely on Sanctuary for validation, notifications, human review, monitoring, and audit history.

The intended operating model is:

1. A human admin registers the agent, funding wallet, operational wallet, and agent signer device.
2. A human admin issues a scoped `agt_` key for draft submission.
3. The agent builds and partially signs a PSBT outside Sanctuary.
4. Sanctuary validates the PSBT, policy, linked destination, UTXOs, locks, and agent signature.
5. Human reviewers inspect the decoded draft and sign through the normal Sanctuary signing path.
6. The operational wallet remains agent-controlled after funding, while Sanctuary monitors it as watch-only.

## Security Boundary

- Sanctuary does not store the agent private key.
- Sanctuary does not auto-sign for the agent.
- Sanctuary does not auto-sign for the human.
- Agent credentials cannot broadcast.
- Agent credentials cannot approve policies or create owner overrides.
- Agent credentials cannot manage wallet settings.
- Agent credentials are scoped to one funding wallet and one operational wallet.
- Over-cap funding is rejected unless a bounded, human-created owner override exists.
- Owner overrides still require valid destination, valid agent status, cooldown compliance, PSBT validation, and human signing.

## Operator Impact

New admin surfaces:

- `Admin -> Wallet Agents` for agent registration, key management, owner overrides, and monitoring settings.
- `Admin -> Agent Wallets` for operational dashboard rows, pending drafts, recent funding attempts, recent spends, alerts, and key metadata.

New API surfaces:

- `POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts`
- `GET /api/v1/agent/wallets/:fundingWalletId/summary`
- `GET /api/v1/agent/wallets/:fundingWalletId/operational-address`
- `POST /api/v1/agent/wallets/:fundingWalletId/operational-address/verify`
- `PATCH /api/v1/agent/wallets/:fundingWalletId/funding-drafts/:draftId/signature`
- `GET /api/v1/mobile/agent-funding-drafts`
- `GET /api/v1/mobile/agent-funding-drafts/:draftId`
- `POST /api/v1/mobile/agent-funding-drafts/:draftId/approve`
- `POST /api/v1/mobile/agent-funding-drafts/:draftId/comment`
- `POST /api/v1/mobile/agent-funding-drafts/:draftId/reject`
- `POST /api/v1/mobile/agent-funding-drafts/:draftId/signature`

New operational records:

- Agent profiles.
- Agent API key hashes and prefixes.
- Funding attempts.
- Alert history.
- Owner override history.

## Backup And Restore

Backups include agent profiles, agent API key hashes and prefixes, funding attempts, alerts, and owner override records. Backups do not include raw `agt_` tokens or private keys.

After restore:

- Confirm agent profile relationships point to the intended funding wallet, operational wallet, and signer device.
- Confirm key prefixes and hashes restored.
- Rotate any runtime key whose raw `agt_` token is not available in the deployment secret store.
- Confirm operational wallet watch-only metadata and address history restored.
- Run the agent wallet funding smoke test before enabling production agent runtimes.

## Release Gates

Minimum targeted gates for this feature:

```bash
cd server
npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts
npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts
npx vitest run tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/services/mobileAgentDraftService.test.ts
npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts
npx vitest run tests/unit/services/backupService.test.ts
npm run build
```

Root-level checks:

```bash
npm run check:openapi-route-coverage
npm run check:api-body-validation
```

Broader release candidates should also pass the backend, frontend, gateway, install, and operations gates in `docs/reference/release-gates.md`.

## Known Follow-Up

- Mobile client UI and platform signer integration are not part of this server foundation.
- Mobile approve/comment currently records review intent through the mobile API response and audit trail; actual spend authorization remains the human signature.
- Suspicious operational self-transfer classification still needs deeper analysis for advanced alert triage.
