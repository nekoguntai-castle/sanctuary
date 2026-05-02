# Sanctuary feature timeline — extracted 2026-04-29

Source: CHANGELOG.md (entries v0.8.0 through v0.8.43, plus the Unreleased section) + git log (Dec 11, 2025 onward, ~2,440 commits)

Note: CHANGELOG only formally begins at v0.8.0 (2026-03-15). Earlier entries are reconstructed from the git commit history and tag list, which goes back to the initial commit on 2025-12-11.

## Timeline (newest first)

### Late Apr 2026 (v0.8.45–v0.8.46 + Unreleased) — Sanctuary Console & local AI
2026-04-25 to 2026-04-29
- Launched the Sanctuary Console: an in-app AI assistant drawer with admin controls, MCP tooling, and rate-limited backend protocol
- Added a typed AI provider profile system with first-class support for local providers (e.g. self-hosted models) alongside cloud
- Added transaction-aware "typed intents" so the Console can plan and explain proposed actions without surprising users
- Shipped a living architecture documentation site with diagram drift detection and function-level call graphs
- Added a requester-only agent wallet setup flow and DB-backed price-provider settings

### Mid Apr 2026 (v0.8.35–v0.8.44) — Agent wallets, MCP, and CI hardening
2026-04-15 to 2026-04-25
- Introduced agent wallets: dedicated operational wallets with funding flows, owner overrides, alert monitoring, and an admin management UI
- Shipped a read-only MCP server so external AI tools can query Sanctuary safely
- Hardened security across the board: exposure-aware rate limits, CORS guards, CodeQL alert cleanup, cookie auth (HttpOnly + CSRF), Node 24 LTS adoption
- Reorganized documentation under the Diátaxis framework with a new contribution guide and changelog
- Massive complexity cleanup: refactored ~40+ UI and backend hotspots into smaller, testable modules

### Apr 2026 (v0.8.18–v0.8.34) — Vault policies, Treasury Intelligence, and remote diagnostics
2026-04-01 to 2026-04-15
- Vault Policies & Spending Governance: rules engine with approval workflows for org and multi-user wallets
- Treasury Intelligence ("On-Chain CFO"): AI-powered wallet analysis with natural-language insight tabs
- Support Bundle infrastructure: one-click diagnostic export covering vault policies, agent wallets, AI/MCP, devices, drafts, backups, mobile permissions, and container state
- Modernized typography (General Sans), tighter UI radii, refined buttons, segmented network tabs
- Major dependency upgrades: TypeScript 6, Prisma 7, Express 5, Vite 7, bitcoinjs-lib 7

### Mar 2026 (v0.8.10–v0.8.17) — Treasury Autopilot, feature flags, premium UI polish
2026-03-15 to 2026-04-01
- Treasury Autopilot Phase 1: automated fee monitoring and consolidation notifications (frees up dust UTXOs without user babysitting)
- Feature-flag admin UI with runtime toggling, audit trail, and gated rollouts (e.g. AI Settings)
- 20+ premium UI enhancements: rich tooltips with cross-highlighting, animated tabs, glow indicators, live fee flash, data-driven sparklines, theme noise control
- Elevated login page with animations, gradients, micro-interactions
- Official BIP test-vector verification across BIP-143, BIP-341, BIP-380, and Bitcoin Core key_io for paranoid hardware-wallet compatibility

### Mar 2026 (v0.8.0–v0.8.9) — Worker architecture & scale-out
2026-03-01 to 2026-03-15
- New worker architecture: dedicated background worker handles sync, subscriptions, and blockchain operations independent of the web tier
- Block-height tracking and pagination so deployments with hundreds of wallets stay responsive
- Wallet sync no longer triggered by navigation — moved to worker-driven event cadence
- Massive modularization pass: 30+ "god files" split into focused domain modules across server and frontend

### Feb–Mar 2026 (v0.7.28–v0.8.0) — Mobile gateway TLS & email verification
2026-01-08 to 2026-03-01
- Email verification for user registration
- Native TLS/HTTPS support in the API gateway with 4096-bit RSA keys, CA certificate support, and gateway-level audit logging
- iOS backend enhancements: mobile permissions model and push notifications
- Backend tests migrated to Vitest; new monitoring admin page with Grafana access
- Multi-implementation address verification (cross-checks against Go-based reference) and Stryker mutation testing for derivation correctness

### Jan 2026 (v0.7.10–v0.7.27) — Multi-account devices, multisig polish, encryption
2026-01-03 to 2026-01-08
- Multi-account device support for single-sig and multisig wallets with SD-card and QR import
- Device-merge flow that detects duplicate fingerprints and consolidates accounts
- Major multisig signing fixes across Trezor, Coldcard, BitBox02, Jade, and Passport — including BIP32-derivation propagation, SLIP-132 xpub conversion, and BBQr support for Coldcard Q
- 2FA encryption-at-rest with ENCRYPTION_SALT, downloadable encryption-key backup
- Wallet repair feature, extensible registries for import/export formats and script types

### Late Dec 2025 (v0.7.0–v0.7.9) — Tor, testnet/signet, QR signing, AI assistant
2025-12-21 to 2026-01-02
- Tor proxy support with .onion verification, exit-IP display, and decoy-output privacy mode
- Full testnet and signet support with per-network connection modes and network tabs
- QR-code signing for air-gapped hardware wallets (Foundation Passport, Coldcard, Keystone via UR/BBQr)
- AI Assistant integration: transaction labeling, natural-language queries, security-isolated container, easy model picker
- BitBox02 and Jade hardware wallet adapters
- Coin Control + Payjoin (BIP78) with privacy scoring and progressive-disclosure UX
- Postgres-backed token management, perpetual-operation maintenance jobs, monitoring metrics, and Redis WebSocket bridge for horizontal scaling

### Mid–late Dec 2025 (v0.5.0–v0.6.1) — RBF, multi-server pool, draft locking
2025-12-17 to 2025-12-20
- API Gateway introduced for mobile app access (architectural foundation for native apps)
- RBF and CPFP actions on transaction details with proper draft / UTXO locking
- Electrum connection pool with multi-server failover and health history
- Multi-output sends, draft transactions with field locking and expiration warnings
- Configurable mempool block estimator with decimal sat/vB fee rates
- Telegram + push notifications for transactions and drafts; configurable notification sounds
- UTXO virtualization, automatic gap-limit expansion, per-user view preferences

### Mid Dec 2025 (v0.4.x) — Drafts, audits, Umbrel, Trezor support
2025-12-15 to 2025-12-17
- Trezor hardware-wallet support via Trezor Suite alongside existing Ledger
- Draft transactions, transaction export (CSV/JSON), and table-layout transaction list
- Comprehensive audit logging system with correlation IDs
- Backup and restore for admins; ENCRYPTION_KEY support in installer
- Umbrel Community App Store package and one-liner installation script
- QR code camera scanning for device import; Coldcard JSON import

### Early–mid Dec 2025 (v0.2.0–v0.3.0) — Multi-user, 2FA, hardware wallets
2025-12-13 to 2025-12-14
- Role-based wallet permissions with admin registration control
- Two-factor authentication, security hardening (auth rate limiting, sync locking, WebSocket fixes)
- Telegram notifications for wallet transactions
- BlueWallet/Coldcard text-format wallet import
- Push notification backend for iOS and Android
- Real-time sync log tab in wallet detail view

### Dec 11–12 2025 — Initial release
2025-12-11 to 2025-12-12
- Watch-only Bitcoin wallet with Electrum and Bitcoin Core RPC support
- Wallet sharing with role assignment (users and groups)
- Multi-signature wallet support with descriptor and JSON import
- Hardware wallet PSBT signing via native WebUSB (Ledger, Trezor Safe 7, Ledger Gen 5)
- Sun/Rise/Set themes including starry night and tropical beach palettes
- HTTPS-only setup so WebUSB/WebHID hardware-wallet flows work in browser

## Notes for the timeline UI
- Earliest entry: 2025-12-11 (initial commit and v0.1 functionality)
- Latest entry: 2026-04-29 (Unreleased work in progress)
- Total span: ~4.5 months (140 days), spanning ~46 tagged releases (v0.2.0 through v0.8.46)
- Suggested grouping for layout: by minor version where possible (v0.2 / v0.3 / v0.4 / v0.5 / v0.6 / v0.7 / v0.8.0–9 / v0.8.10–17 / v0.8.18–34 / v0.8.35+). Visually this maps cleanly to ~12 cards on a vertical timeline.
- Cadence: extremely steady — averaging a release every 2–3 days. The watch-only model has been present from day one (v0.1 was already xpub-based with no signing keys held server-side); hardware wallet signing arrived within ~24 hours of the initial commit; multi-user/RBAC by v0.2 (day 3); Tor/privacy by v0.7 (week 2); mobile gateway TLS by v0.8 (week 5); AI assistant + agent wallets in v0.7–v0.8 (months 1–4).
- Notable arc: the project went from "single-user watch-only with Ledger" to "multi-user, multi-network, hardware-signed, AI-augmented, policy-governed treasury platform with mobile gateway and agent wallets" in roughly 20 weeks. The final third of the timeline (v0.8.x) is mostly architectural maturity: vault policies, agent wallets, MCP, Console, observability, and a living docs site — i.e. the platform graduating from "wallet" to "treasury system."
