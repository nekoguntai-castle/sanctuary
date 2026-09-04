# Changelog

All notable changes to Sanctuary are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.8.70] - 2026-09-04

### Added

- Added immutable deployment generations, canonical mutation locking, signed
  producer registrations, and application lifecycle authority references.
- Added a signed operator lost-authority recovery path with exact cleanup
  receipts and closeout for orphaned CI stacks.
- Added an additive `operational` projection to `GET /api/v1/bitcoin/status`:
  configured mode, the transport that actually answered (pool, singleton, or
  singleton fallback with a bounded reason), the observed route server, and
  freshness-aware per-server availability with failover primary/preferred/next
  roles.

### Changed

- Routed setup, start, stop, upgrade backup, and offline apply through retained
  Compose definitions and stamped Compose/OCI resources with ownership metadata.
- Failover-only Electrum pools now route requests to the highest-priority
  eligible server instead of the first idle socket, with deterministic
  `(priority, id)` ordering and primary failback without a pool restart.
- Redesigned the dashboard Node Status card around the operational projection:
  mode-specific headlines, a strategy badge, honest pool-fallback and
  unknown-health states, a `Last known` treatment for stale data, and an
  accessible server disclosure with text role and availability.

### Fixed

- Connectivity failures on the status endpoint now return the selected network,
  configured mode, and topology instead of a bare error envelope.
- The Node Status card no longer presents socket lease counts as server health
  or shows a previous network's servers after a network switch.

## [0.8.69] - 2026-08-30

### Added

- Whole-pipeline wallet-sync phase progress, active-stage age metrics, and
  request-negotiated worker diagnostics v2 while preserving diagnostics v1.
- Wallet-sync execution panels and alerts, live stage timing in the Log tab, and
  privacy-safe incident evidence for generation, lease, and worker state.

### Changed

- Made the default MCP-disabled launcher and release rebuild gate fail closed.
- Established one immutable-tag release recovery policy and an affected-fleet
  release-candidate canary contract for v0.8.69.

### Fixed

- Bounded wallet-sync remote work, cancellation, recursion, and fallback paths
  delivered by PRs #949, #950, and #951.
- Preserved causal ordering for equal-millisecond wallet-sync progress events
  across mixed worker versions.

## [0.8.68] - 2026-08-26

### Changed

- Prepared the v0.8.68 release from the accepted v0.8.67 baseline.

## [0.8.67] - 2026-08-26

### Added

- Added bounded cross-network wallet-sync recovery and retired the legacy stale-wallet scheduler.

### Fixed

- Coordinated frontend refresh and CSRF recovery, repaired MCP health probes, and updated monitoring and security dependencies.

## [0.8.66] - 2026-08-21

### Changed

- Unified the wallet-sync lifecycle, persistence, publication, retry ladder, and diagnostic contracts.
- Made static quality gates and architecture-boundary ratchets reflect the work they actually execute.

## [0.8.65] - 2026-08-20

### Added

- Added transaction sub-tabs, detachable panels, and clearer wallet-sync failure presentation.

### Changed

- Suspended the single-maintainer wallet-safety human-attestation gate while retaining automated evidence.

## [0.8.64] - 2026-08-19

### Fixed

- Restored sync for legacy wallets, enforced live WebSocket authorization, and hardened approval persistence.
- Corrected release evidence, Grafana migration settling, and install cleanup behavior.

## [0.8.63] - 2026-08-13

### Added

- Added hardware-wallet conformance and authenticated wallet-safety evidence for Ledger, Trezor, Jade, and Taproot flows.

### Fixed

- Corrected release-evidence builds and Tor configuration paths in upgrade tests.

## [0.8.62] - 2026-08-08

### Added

- Added strict frontend validation for wallet, UTXO, signing, fee, price, xpub, and RBF API responses.

### Fixed

- Made dashboard request failures visible instead of presenting them as empty data.

## [0.8.61] - 2026-08-07

### Fixed

- Made failed or stale backups externally visible and hardened send-fee and dashboard fee-rate handling.
- Isolated install lanes, migration waits, release notes, and runner-lock evidence.

## [0.8.60] - 2026-08-06

### Changed

- Made CI shell inventories self-checking and registered previously orphaned test suites.

### Fixed

- Removed the unusable Promtail host-log mount and hardened monitoring, diagnostics, and address-verification CI.

## [0.8.59] - 2026-08-05

### Added

- Reworked the dashboard layout, activity pagination, and BTC balance movement display.

### Fixed

- Corrected monitoring configuration seeding and strengthened package-compromise and AES-GCM validation.

## [0.8.58] - 2026-08-02

### Added

- Added privacy-safe notification diagnostics and single-incident support evidence.

### Fixed

- Restored candidate, upgrade, offline-upgrade, and isolated release build behavior.

## [0.8.57] - 2026-07-30

### Changed

- Made Forgejo the CI authority and GitHub the passive public mirror and operator-owned distribution endpoint.

### Fixed

- Hardened worker lock-loss termination, scheduling, webhook retries, migrations, transfers, backups, and outbound request bounds.

## [0.8.56] - 2026-06-07

### Added

- Added keyboard and dialog accessibility across dashboards, tables, charts, modals, and UTXO selection.

### Changed

- Converged shared transaction, draft, and vault-policy request schemas.

## [0.8.55] - 2026-05-27

### Added

- Added Silent Payments Electrum readiness infrastructure and wallet webhook notifications.

### Fixed

- Hardened remote LLM provider connectivity, persistent settings, and Codeberg tag refresh during upgrades.

## [0.8.54] - 2026-05-16

### Changed

- Completed quality, dependency-advisory, architecture, and hardware-readiness remediation.

### Fixed

- Corrected the release target after the prerelease preparation selected the wrong version line.

## [0.8.53] - 2026-05-13

### Changed

- Moved the prebuilt image path to Codeberg Packages and removed obsolete GitHub-only release workflows.

### Fixed

- Repaired fresh-install migrations, worker startup, release CI diagnostics, and image publication reliability.

## [0.8.52] - 2026-05-08

### Added

- Added blocking-I/O quality enforcement and reliability documentation.

### Changed

- Consolidated release-candidate upgrade evidence under the install-test owner and improved CI isolation.

## [0.8.50] - 2026-05-02

### Added

- Added signed offline-release bundle infrastructure and Codeberg installer fallback.

### Changed

- Removed the GitLab mirror and unused privacy-mixing references.

## [0.8.49] - 2026-05-02

### Added

- Added testnet and signet wallet workflows and a sidebar network selector.

### Fixed

- Hardened wallet addresses, derivation evidence, and PSBT safety verification.

## [0.8.48] - 2026-04-30

### Changed

- Published a version-only follow-up to v0.8.47.

## [0.8.47] - 2026-04-30

### Added

- Added requester-scoped agent-wallet setup and database-backed price-provider controls.

### Fixed

- Hardened decoy randomness, wallet references, derivation paths, transaction intent limits, and BullMQ job identifiers.

## [0.8.46] - 2026-04-28

### Added

- Added local AI providers and automatic Sanctuary Console context.

### Fixed

- Corrected Console transaction planning and expanded local-provider regression coverage.

## [0.8.45] - 2026-04-27

### Added

- Added the Sanctuary Console, AI provider credential boundary, MCP access controls, and assistant read tools.

### Changed

- Reduced complexity across transaction sync, signing, configuration, and UI flows while restoring exact quality gates.

## [0.8.44] - 2026-04-25

### Changed

- Unified notification worker delivery and parallelized browser, backend, and coverage CI lanes.

### Fixed

- Hardened privacy-score rendering, test semantics, and integration-suite ownership.

## [0.8.43] - 2026-04-24

### Fixed

- Restored Ledger xpub fetch flow
- Hardened 2FA upgrade release gate

### Changed

- Path-aware CI security and test scopes
- Skipped repo-quality workflow on workflow-only changes
- Cancelled superseded release-candidate CI runs
- Cleaned up CI duration reporting output

## [0.8.34] - 2026-04-15

### Changed

- Extracted admin Electrum server service from route layer
- Continued architecture cleanup: route-to-repository boundary enforcement reduced to 44 exceptions

### Fixed

- Allowed disabling worker-heartbeat startup gate for server-only runs
- Fixed install test SSL directory export for fresh installs

## [0.8.33] - 2026-04-14

### Fixed

- Migrated install e2e auth-flow scripts to Phase 6 cookie auth
- Propagated CSRF token correctly out of subshell in install tests

## [0.8.32] - 2026-04-14

### Fixed

- Lowered JS bundle size threshold to account for nginx gzip
- Synced ai-proxy lockfile with package.json dependencies
- Resolved flaky Layout test teardown race condition

## [0.8.31] - 2026-04-13

### Added

- Support bundle container diagnostics collector

### Fixed

- Prevented syncInProgress flag from getting permanently stuck
- Added dumb-init to gateway to prevent zombie process accumulation

## [0.8.30] - 2026-04-13

### Changed

- Refreshed README and install documentation
- Extracted shared `isConsolidation` utility and `useWalletLabels` hook

### Fixed

- Prevented memory exhaustion during transaction field population

## [0.8.29] - 2026-04-12

### Fixed

- Resolved BullMQ ConnectionOptions type errors in workerSyncQueue
- Achieved coverage thresholds for CI across frontend and backend

## [0.8.28] - 2026-04-12

### Fixed

- Restored legacy 2FA verification compatibility

## [0.8.27] - 2026-04-11

### Fixed

- Restored 2FA clock drift tolerance lost in otplib v13 migration

## [0.8.26] - 2026-04-10

### Fixed

- Bumped jsdom to 29.0.2
- Synced lockfiles for alpine npm ci in GitHub Actions

## [0.8.25] - 2026-04-09

### Fixed

- Corrected Prisma 7 seed.js path and Docker stage inclusion
- Fixed E2E import validation error selector

## [0.8.24] - 2026-04-08

### Changed

- Comprehensive technical debt cleanup across codebase

### Fixed

- Updated Zod v4 enum errorMap to message parameter in gateway

## [0.8.23] - 2026-04-07

### Changed

- Modernized typography: dropped serif italic, adopted General Sans medium

### Fixed

- Invalidated access cache for group members on group deletion
- Fixed CI integration test database configuration

## [0.8.22] - 2026-04-06

### Changed

- Closed backend coverage gaps for intelligence, notifications, and middleware

## [0.8.21] - 2026-04-05

### Changed

- Modernized UI with tighter radii, refined buttons, and segmented network tabs

### Fixed

- Resolved "no receive address" for wallets with many unused change addresses

## [0.8.20] - 2026-04-04

### Changed

- Covered sparkline edge cases and multisig branch for 100% coverage

## [0.8.19] - 2026-04-03

### Changed

- Extracted fetchUnusedAddresses callback and simplified effect

## [0.8.18] - 2026-04-02

### Changed

- Upgraded Docker actions to Node.js 24 versions

### Fixed

- Added REDIS_PASSWORD and AI_CONFIG_SECRET to CI and install workflows

## [0.8.17] - 2026-04-01

### Added

- Elevated login page with animations, effects, and micro-interactions

### Fixed

- Improved rate limit messages and reworked login gradient animation

## [0.8.16] - 2026-03-31

### Added

- AI Settings page gated behind aiAssistant feature flag

### Fixed

- Added missing migration for feature_flags tables

## [0.8.15] - 2026-03-30

### Fixed

- Resolved dashboard UI bugs: tooltip clipping, missing 24h price change, card border consistency

## [0.8.14] - 2026-03-29

### Added

- 20 premium UI enhancements for distinctive look and feel

### Changed

- Expanded test coverage with gateway unit tests and E2E user journeys

## [0.8.13] - 2026-03-28

### Fixed

- Standardized UI patterns across all admin components
- Repaired 3 pre-existing test failures in CI

## [0.8.12] - 2026-03-27

### Added

- Feature-flag key validation, runtime toggle coverage, and edge case tests
- Render regression visual baselines and PR gate

### Changed

- Deduplicated feature-flag key validation and shared constants

## [0.8.11] - 2026-03-26

### Added

- Treasury Autopilot frontend settings UI

### Changed

- Raised server test coverage thresholds to 99%, restored 100% frontend coverage

## [0.8.10] - 2026-03-25

### Added

- Treasury Autopilot Phase 1: fee monitoring and consolidation notifications

### Changed

- Closed coverage gaps across server and gateway

## [0.8.9] - 2026-03-24

### Fixed

- Live-refresh recent activity and show transaction lock state on dashboard
- Fixed worker readiness probes and compose health checks

## [0.8.8] - 2026-03-23

### Fixed

- Corrected rate limit env var names in docker-compose and auth flow tests
- Prevented `set -e` from exiting early during optional feature and prerequisite checks

## [0.8.7] - 2026-03-22

### Fixed

- Flaky UserContext theme test isolation

## [0.8.6] - 2026-03-21

### Fixed

- Moved nodemailer to production dependencies for Docker builds

## [0.8.5] - 2026-03-20

### Changed

- Refactored ConnectDevice, SendTransactionPage, and DeviceSharing into modular architecture
- Adopted `useLoadingState` hook across components

## [0.8.4] - 2026-03-19

### Fixed

- Fixed install tests for setup.sh refactoring

## [0.8.3] - 2026-03-18

### Fixed

- Handled docker compose build race condition errors gracefully
- setup.sh now handles SSL and startup

## [0.8.2] - 2026-03-17

### Fixed

- Fixed gateway whitelist to use full path including baseUrl
- Fixed TLS_ENABLED warning and docker-compose build for fresh clones

## [0.8.1] - 2026-03-16

### Fixed

- Added migration for lastSyncedBlockHeight column

## [0.8.0] - 2026-03-15

### Added

- Worker architecture: dedicated background worker for sync, subscriptions, and blockchain operations
- Block height tracking and pagination for large deployments

### Changed

- Removed navigation-triggered syncs in favor of worker-driven sync

[Unreleased]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.69...HEAD
[0.8.69]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.68...v0.8.69
[0.8.68]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.67...v0.8.68
[0.8.67]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.66...v0.8.67
[0.8.66]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.65...v0.8.66
[0.8.65]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.64...v0.8.65
[0.8.64]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.63...v0.8.64
[0.8.63]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.62...v0.8.63
[0.8.62]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.61...v0.8.62
[0.8.61]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.60...v0.8.61
[0.8.60]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.59...v0.8.60
[0.8.59]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.58...v0.8.59
[0.8.58]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.57...v0.8.58
[0.8.57]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.56...v0.8.57
[0.8.56]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.55...v0.8.56
[0.8.55]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.54...v0.8.55
[0.8.54]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.53...v0.8.54
[0.8.53]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.52...v0.8.53
[0.8.52]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.50...v0.8.52
[0.8.50]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.49...v0.8.50
[0.8.49]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.48...v0.8.49
[0.8.48]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.47...v0.8.48
[0.8.47]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.46...v0.8.47
[0.8.46]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.45...v0.8.46
[0.8.45]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.44...v0.8.45
[0.8.44]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.43...v0.8.44
[0.8.34]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.33...v0.8.34
[0.8.33]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.32...v0.8.33
[0.8.32]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.31...v0.8.32
[0.8.31]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.30...v0.8.31
[0.8.30]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.29...v0.8.30
[0.8.29]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.28...v0.8.29
[0.8.28]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.27...v0.8.28
[0.8.27]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.26...v0.8.27
[0.8.26]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.25...v0.8.26
[0.8.25]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.24...v0.8.25
[0.8.24]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.23...v0.8.24
[0.8.23]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.22...v0.8.23
[0.8.22]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.21...v0.8.22
[0.8.21]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.20...v0.8.21
[0.8.20]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.19...v0.8.20
[0.8.19]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.18...v0.8.19
[0.8.18]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.17...v0.8.18
[0.8.17]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.16...v0.8.17
[0.8.16]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.15...v0.8.16
[0.8.15]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.14...v0.8.15
[0.8.14]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.13...v0.8.14
[0.8.13]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.12...v0.8.13
[0.8.12]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.11...v0.8.12
[0.8.11]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.10...v0.8.11
[0.8.10]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.7.28...v0.8.0
