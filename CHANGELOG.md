# Changelog

All notable changes to Sanctuary are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support bundle collectors for vault policies, agent wallets, AI/intelligence, MCP, devices, drafts, backups, and mobile permissions
- Support bundle database collector now reports Prisma migration head

### Changed

- Reorganized documentation under the Diataxis framework (explanation, how-to, reference) with kebab-case naming
- Purged 58 auto-generated CI proof artifacts from `docs/plans/`
- Added `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/README.md` navigation index

### Fixed

- Hardened auth and AI proxy request validation
- Fixed npm 10 lockfile compatibility
- Avoided express type dependency in AI proxy schemas

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

[Unreleased]: https://github.com/nekoguntai/sanctuary/compare/v0.8.34...HEAD
[0.8.34]: https://github.com/nekoguntai/sanctuary/compare/v0.8.33...v0.8.34
[0.8.33]: https://github.com/nekoguntai/sanctuary/compare/v0.8.32...v0.8.33
[0.8.32]: https://github.com/nekoguntai/sanctuary/compare/v0.8.31...v0.8.32
[0.8.31]: https://github.com/nekoguntai/sanctuary/compare/v0.8.30...v0.8.31
[0.8.30]: https://github.com/nekoguntai/sanctuary/compare/v0.8.29...v0.8.30
[0.8.29]: https://github.com/nekoguntai/sanctuary/compare/v0.8.28...v0.8.29
[0.8.28]: https://github.com/nekoguntai/sanctuary/compare/v0.8.27...v0.8.28
[0.8.27]: https://github.com/nekoguntai/sanctuary/compare/v0.8.26...v0.8.27
[0.8.26]: https://github.com/nekoguntai/sanctuary/compare/v0.8.25...v0.8.26
[0.8.25]: https://github.com/nekoguntai/sanctuary/compare/v0.8.24...v0.8.25
[0.8.24]: https://github.com/nekoguntai/sanctuary/compare/v0.8.23...v0.8.24
[0.8.23]: https://github.com/nekoguntai/sanctuary/compare/v0.8.22...v0.8.23
[0.8.22]: https://github.com/nekoguntai/sanctuary/compare/v0.8.21...v0.8.22
[0.8.21]: https://github.com/nekoguntai/sanctuary/compare/v0.8.20...v0.8.21
[0.8.20]: https://github.com/nekoguntai/sanctuary/compare/v0.8.19...v0.8.20
[0.8.19]: https://github.com/nekoguntai/sanctuary/compare/v0.8.18...v0.8.19
[0.8.18]: https://github.com/nekoguntai/sanctuary/compare/v0.8.17...v0.8.18
[0.8.17]: https://github.com/nekoguntai/sanctuary/compare/v0.8.16...v0.8.17
[0.8.16]: https://github.com/nekoguntai/sanctuary/compare/v0.8.15...v0.8.16
[0.8.15]: https://github.com/nekoguntai/sanctuary/compare/v0.8.14...v0.8.15
[0.8.14]: https://github.com/nekoguntai/sanctuary/compare/v0.8.13...v0.8.14
[0.8.13]: https://github.com/nekoguntai/sanctuary/compare/v0.8.12...v0.8.13
[0.8.12]: https://github.com/nekoguntai/sanctuary/compare/v0.8.11...v0.8.12
[0.8.11]: https://github.com/nekoguntai/sanctuary/compare/v0.8.10...v0.8.11
[0.8.10]: https://github.com/nekoguntai/sanctuary/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/nekoguntai/sanctuary/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/nekoguntai/sanctuary/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/nekoguntai/sanctuary/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/nekoguntai/sanctuary/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/nekoguntai/sanctuary/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/nekoguntai/sanctuary/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/nekoguntai/sanctuary/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/nekoguntai/sanctuary/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/nekoguntai/sanctuary/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/nekoguntai/sanctuary/compare/v0.7.28...v0.8.0
