# Wallet Threat Model

Date: 2026-05-09
Status: active fund-safety reference; external security review not yet complete

This threat model defines the trust boundaries Sanctuary must defend before it
can make high-trust wallet claims. It is intentionally conservative: when a
boundary cannot be proven by an executable gate, the limitation is stated
instead of turned into a promise.

## Security Goals

- Private keys, seed words, passphrases, and hardware-wallet PINs are never
  accepted or stored as Sanctuary wallet state.
- No transaction reaches broadcast unless Sanctuary derives its intent from the
  decoded PSBT or raw transaction and the configured Electrum backend can witness
  each final input as fetchable, standard-address, and still unspent.
- Wallet imports cannot create wallet state from private extended keys,
  wrong-network descriptors, malformed cosigner data, duplicate keys, unsupported
  branch patterns, or script/path mismatches.
- AI, Console, and MCP surfaces remain read-only investigation tools. They do
  not sign, broadcast, create drafts, edit wallet data, run shell commands, or
  run arbitrary SQL.
- Release artifacts are verifiable before operators install them.
- Support packages, logs, and review artifacts must not contain private keys,
  seed material, bearer tokens, provider API keys, or other unredacted secrets.
  Backups remain sensitive even when they contain only watch-only wallet data and
  encrypted credential material.
- Unknown or partially classified fund-moving state fails closed.

## Assets

| Asset | Why It Matters | Current Protection |
| --- | --- | --- |
| Bitcoin funds | Irreversible loss is the highest-severity failure | Private keys stay outside Sanctuary; spending paths require decoded transaction validation, external signer approval, Electrum preflight, policy checks, and user review |
| Wallet descriptors, xpubs, fingerprints, and derivation paths | Watch-only material can reveal balances, transaction graph, and future addresses | Import domain validation, authenticated access, backup handling, support-package redaction, and MCP DTO exclusions |
| Labels, memos, policies, drafts, groups, and audit logs | Metadata can identify counterparties and operational intent | Authenticated APIs, scoped sharing, encrypted backup fields where applicable, prompt-history payload minimization |
| PSBTs, raw transactions, UTXO sets, and fee decisions | Tampering can redirect funds or hide fees | Server-canonical decode, metadata conflict checks, policy checks, safety catch guard, critical mutation gate |
| User credentials, 2FA secrets, refresh cookies, MCP keys, gateway secrets, and provider API keys | Credential theft can expose wallet metadata or administrative controls | HttpOnly cookies, CSRF, scoped MCP keys, forced MCP-key revocation after restore, encrypted provider credentials, runtime secrets outside the checkout |
| Backups and restore archives | Restore can overwrite state and expose encrypted or sensitive data | Restore validation, explicit destructive restore confirmation, backup-secret guidance, support-package redaction |
| Release keys, manifests, checksums, SBOMs, provenance, and container digests | Compromised releases can become a funds-loss vector | Manifest-backed release verifier, signed checksum requirement for stable releases, offline-bundle trust anchor documentation |
| CI, dependency, and source history | Compromised dependencies or build workflows can alter shipped code | Required checks, audit gates, gitleaks, Semgrep, actionlint, lizard, critical mutation, branch protection |

## Actors

| Actor | Capability | Expected Control |
| --- | --- | --- |
| Operator or admin | Configures nodes, imports wallets, approves releases, restores backups | Clear runbooks, release verification, strong credentials, explicit restore and exposure warnings |
| Authenticated non-admin user | Reads permitted wallets and may initiate allowed workflows | Route-level authorization, wallet sharing checks, scoped API behavior |
| Malicious browser code or dependency | Runs in the browser origin and tries to steal credentials or alter UI intent | HttpOnly access tokens, CSRF, server-side canonical decode and policy checks, hardware-screen verification |
| Malicious API client | Sends forged metadata, malformed descriptors, or stale spend data | Schema validation, descriptor domain validation, decoded transaction authority, Electrum preflight |
| Network attacker | Observes or modifies traffic between browser, backend, gateway, MCP, AI provider, or Electrum | HTTPS guidance, loopback defaults for MCP, bearer-key scopes, node TLS settings, local semantic transaction checks |
| Wrong-network or malicious Electrum server | Returns stale, missing, or misleading chain data | Local decoded-transaction validation, fail-closed preflight when required input evidence is unavailable, operator node guidance |
| Compromised AI provider or MCP client | Attempts to exfiltrate sensitive material or request actions beyond read scope | Read-only tool registry, DTO exclusions for descriptors/xpubs/PSBTs/tokens, provider credential redaction, scoped and expiring MCP keys |
| Hardware wallet, firmware, bridge, or transport mismatch | Displays or signs something different from Sanctuary's expected transaction | Hardware display verification, adapter tests, fixture intake schema, pending physical signed artifacts |
| Compromised release pipeline or maintainer account | Publishes altered artifacts or images | Required PR checks, release manifest verifier, signed checksums, SBOM/provenance, branch protection |
| Insider with repository or infrastructure access | Attempts to bypass review, weaken tests, or leak secrets | Protected branches, required checks, reviewed baselines, no tracked runtime secrets, external review package |

## Trust Boundaries

| Boundary | Main Risk | Current Gate Or Limitation |
| --- | --- | --- |
| Browser to backend | UI metadata or compromised browser lies about recipient, amount, fee, UTXOs, or draft id | Backend ignores caller metadata as authority for broadcast and re-derives from decoded payload; cookie/CSRF gates protect browser auth |
| Gateway or mobile API to backend | A client bypasses web UI constraints | Backend schemas, auth, wallet permission checks, and canonical transaction gates remain authoritative |
| Backend to database and Redis | Partial state mutation after an unsafe error | Safety catch guard blocks new non-terminal catches in safety modules; backup/restore tests cover destructive restore flows |
| Backend to Electrum | Node lies, is stale, unavailable, or wrong network | Production runtime is Electrum-only; broadcast preflight fails closed when prevout/unspent evidence is unavailable. Bitcoin Core remains release-lab evidence, not a runtime requirement |
| Backend to hardware wallet through browser transports | Device returns or displays unexpected account, address, change, or signature | Software adapter tests and fixture intake schema exist; full physical signed fixture matrix is pending and must not be overclaimed |
| Import file, QR, descriptor, and hardware-account inputs | Malformed or wrong-network wallet state is accepted | Shared descriptor/xpub domain validation rejects private keys, wrong networks, malformed multisig data, unsupported branches, and duplicates |
| Backup export and restore | Sensitive data leaks or restore destroys current state | Backup docs warn that backups are sensitive; restore validates and requires explicit destructive confirmation; restored MCP keys are forced revoked and provider credentials are disabled |
| LLM egress proxy, model provider, Console, and MCP | LLM sees secrets or performs wallet-changing actions | AI/MCP tools are read-only, scoped at execution time, and exclude private keys, descriptors, xpubs, PSBTs, bearer tokens, and provider API keys |
| Release pipeline to operator install | Operator installs compromised or unverifiable artifacts | Stable releases require manifest, signed checksums, local checksums, SBOM/provenance references, offline metadata, and image digests |
| CI and quality gates | Safety regressions merge unnoticed | Required typecheck, coverage, lizard, mutation, audit, secret, SAST, release, and safety-catch gates; legacy catch debt is allowlisted and ratchetable |

## Fund-Moving Invariants

Every exposed transaction path must preserve these invariants:

1. The server decodes the signed PSBT or raw transaction before policy,
   persistence, audit success, or network propagation.
2. Recipient, amount, fee, UTXO set, wallet id, network, and draft metadata from
   the caller are conflict checks only. They are never authoritative over the
   decoded payload.
3. Unknown inputs, unsupported scripts, missing previous outputs, stale inputs,
   ambiguous change, excessive fees, wrong network, incomplete signatures, and
   malformed payloads fail before broadcast.
4. Electrum preflight must run before production propagation. Bitcoin Core
   `testmempoolaccept` may be used as release-lab fixture evidence, but it is not
   an operator runtime dependency while Sanctuary is Electrum-only.
5. Successful broadcast and failed persistence require reconciliation evidence,
   not a blind retry with a different transaction.

## Non-Goals

- Sanctuary is not a hot wallet and does not custody private keys.
- Sanctuary does not protect funds if a user ignores a hardware-wallet display
  mismatch and approves a malicious transaction.
- Sanctuary does not guarantee privacy from the operator's chosen Electrum
  server, AI provider, browser, network, or backup storage.
- Sanctuary does not support public unauthenticated internet exposure.
- Sanctuary Console and MCP do not have signing, broadcast, wallet-editing,
  shell, or arbitrary SQL authority.
- Sanctuary does not claim a formal security audit, bug bounty, or full
  hardware-in-loop funds-loss-grade posture until the matching evidence exists.
- Sanctuary does not make Bitcoin Core a production runtime requirement while
  the supported node backend is Electrum.

## Known Limitations

- Physical hardware signing artifacts are not complete. The fixture intake
  schema exists, but the 11 required Ledger, Trezor, and BitBox rows remain
  pending or product-blocked as documented in
  [Hardware Wallet Validation](hardware-wallet-validation.md).
- Release artifact verification is required for stable releases, but operators
  still need a separately trusted public key or pinned checkout to establish the
  release trust anchor.
- Descriptor/import validation has runtime-local safety coverage; optional
  Bitcoin Core descriptor cross-checks remain release-lab evidence.
- The safety catch guard currently has an accountable legacy baseline. Reducing
  that baseline and expanding typed error taxonomy coverage remain follow-up
  work.
- Target-environment performance evidence is not transferable to every operator
  topology without rerunning the benchmark on that topology.
- A public responsible-disclosure or bug-bounty process must be published before
  broad high-trust or audited-software claims.

## Evidence Map

- [Release Gates](release-gates.md) lists required and pending gates.
- [Trust And Verification](trust-and-verification.md) translates the gates into
  operator-facing claims and limits.
- [External Review Package](external-review-package.md) is the reviewer index
  for commands, documents, and known limitations.
- [Hardware Wallet Validation](hardware-wallet-validation.md) defines physical
  device evidence and sanitization rules.
- [Offline Bundles](offline-bundles.md) documents stable-release verification and
  release trust anchors.
- [AI Settings, Sanctuary Console, And MCP Access](../how-to/ai-mcp-console.md)
  documents the read-only AI/MCP boundary.
- [MCP Server](../how-to/mcp-server.md) documents loopback/LAN exposure rules.
