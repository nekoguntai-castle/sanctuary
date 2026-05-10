# External Review Package

Date: 2026-05-09
Status: reviewer index; physical hardware artifact set and formal audit remain
pending

This package tells an external reviewer where to start, what Sanctuary claims,
which commands reproduce the main evidence, and which limitations must remain
visible in any report.

## Review Scope

Primary review objective: find any path where Sanctuary can lose funds, hide a
fund-moving mismatch, leak wallet authority, or ship unverifiable software.

In scope:

- Wallet import, descriptor parsing, address derivation, transaction creation,
  PSBT validation, finalization, broadcast, and audit persistence.
- Hardware-wallet adapters, transport assumptions, display verification, and
  signed artifact replay.
- Browser auth, CSRF, WebSocket auth, gateway/mobile authorization, MCP keys,
  AI provider credentials, and Console/MCP tool authorization.
- Backup creation, restore, support-package redaction, runtime secrets, release
  artifacts, offline bundles, CI gates, and dependency/security triage.

Out of scope unless explicitly requested:

- Custodial hot-wallet private-key storage, because Sanctuary does not support
  it as a product goal.
- Mainnet hardware validation, because release evidence must use regtest,
  signet, or testnet only.
- Bitcoin Core as an operator runtime dependency while Sanctuary is
  Electrum-only.

## Document Map

| Question | Start Here |
| --- | --- |
| What are the high-risk boundaries and non-goals? | [Wallet Threat Model](wallet-threat-model.md) |
| What can operators verify today? | [Trust And Verification](trust-and-verification.md) |
| Which gates block release claims? | [Release Gates](release-gates.md) |
| How are physical hardware artifacts captured safely? | [Hardware Wallet Validation](hardware-wallet-validation.md) |
| How are stable release artifacts verified? | [Offline Bundles](offline-bundles.md) |
| How is AI/MCP kept read-only? | [AI Settings, Sanctuary Console, And MCP Access](../how-to/ai-mcp-console.md) and [MCP Server](../how-to/mcp-server.md) |
| How does broadcast work? | [Transaction Broadcasting](../explanation/transaction-broadcasting.md) |
| How does deterministic derivation work? | [Address Derivation](../explanation/address-derivation.md) |

Repository-only planning evidence is linked from [Sanctuary Documentation](../README.md)
under "Repository-only plans".

## Evidence Commands

Reviewers should prefer focused checks first, then broaden when a finding touches
shared infrastructure.

```bash
npm --prefix server run test -- --run tests/unit/services/bitcoin/descriptorParser.test.ts
npm --prefix server run test -- --run \
  tests/unit/api/transactions-http-routes.test.ts \
  tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts \
  tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts \
  tests/unit/services/bitcoin/industry/broadcastSafety.test.ts \
  tests/unit/services/bitcoin/validationEvidenceContracts.test.ts
npm run check:safety-catch-guards
npm --prefix server run test:mutation:critical:gate
npm run test:release-artifacts
npm run release:verify-artifacts -- \
  --manifest release-manifest.json \
  --strict-stable \
  --public-key scripts/offline/keys/sanctuary-offline-release-public.pem
npm --prefix scripts/verify-addresses run verify
REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
```

Expected caveat: the hardware fixture command is the intended full evidence gate
after physical capture. Before capture, it documents the pending hardware gap
rather than proving full hardware-in-loop confidence.

Docs and site checks:

```bash
npx vitest run tests/docs/readme-links.test.ts tests/docs/remarkMermaidClickRewrite.test.ts
npm run docs:build
git diff --check
```

## Review Questions

- Can any broadcast path use caller-supplied metadata as authority after the
  signed PSBT or raw transaction is decoded?
- Can any malformed, wrong-network, private-key-bearing, duplicate-cosigner, or
  unsupported descriptor create wallet state?
- Can any safety-critical catch block log an error and continue with uncertain
  transaction, signing, import, backup, auth, release, or node state?
- Can AI, Console, or MCP see descriptors, xpubs, PSBTs, bearer tokens, provider
  API keys, or execute a state-changing tool?
- Can a backup restore silently preserve bearer tokens, provider credentials, or
  MCP keys on a different instance?
- Can an operator install a stable release without a manifest, signed checksum
  file, checksum coverage, SBOM/provenance references, or image digests?
- Can physical hardware evidence contain secrets or mainnet funds?
- Does any public claim exceed the evidence in [Release Gates](release-gates.md)?

## Artifact Rules

External review evidence may include:

- Test logs, coverage logs, mutation summaries, lizard output, release verifier
  output, and docs build output.
- Sanitized regtest/signet/testnet descriptors, xpubs, PSBTs, raw transactions,
  decoded summaries, fingerprints, derivation paths, and device/app versions.
- Screenshots or photos only when they show addresses, amounts, policy text, or
  output summaries without secrets.

External review evidence must not include:

- Seed words, passphrases, PINs, pairing secrets, private extended keys, host auth
  tokens, provider API keys, JWTs, MCP bearer tokens, release private keys, live
  `.env` files, TLS private keys, or mainnet-funded signing artifacts.

## Known Review Blockers

- Physical hardware signed artifacts are still pending for the required Ledger,
  Trezor, and BitBox rows.
- Responsible disclosure and bug bounty process publication is pending.
- Formal independent audit is pending.
- Safety catch guard baseline reduction and typed error taxonomy expansion are
  pending.
- Target-environment performance calibration is operator-topology dependent.

These blockers should appear in any external report until closed by evidence.
