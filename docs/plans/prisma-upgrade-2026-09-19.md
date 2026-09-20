# Prisma 7.10 upgrade evidence

Validated candidate `fb9be873` against baseline main
`9c81f62fe9372c226740e8dfb10e947524a87c89`. Prisma CLI, client and PostgreSQL
adapter advance together from 7.8.0 to 7.10.0. The version-specific Prisma
and engine install-script approvals advance with them. All changed/new npm
resolutions passed the three-day release-age check. The separate application
and migration image boundary from #1246 is preserved.

## Tests

Under Node 24.19.0/npm 11.19.0, strict clean installation, generated client,
shared/server builds, install-script policy, npm CI callsite policy and
supply-chain locks passed. The targeted Prisma model/migration suite passed
73 tests on both macOS and Linux; runtime dependency projection passed two
unit tests. The Docker Compose migration contract passed on Linux.

The full Linux server suite passed 16,368 tests, skipped 743 and retained one
todo. One timing-sensitive HTTP backpressure cancellation assertion failed
while image builds ran concurrently. A focused rerun of its complete file
passed all 101 tests. This records the original failure; it is not a claim
that the initial full run passed. The combined PR still requires its final CI.

`npm audit` reported 12 low and two moderate findings, with zero high/critical.
`npm ls --all` flags the pre-existing descriptors-core noble/scure override
incompatibilities: the five affected lock entries are byte-identical to main.
There were no Prisma peer failures.

## Real Linux image and database proofs

Runner: `runner-x300`, isolated task directory
`/var/tmp/sanctuary-prisma-20260919`. Proof runner image:
`nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go@sha256:617c92760e1202713f16e84f70da4bda82765e42a32bfca1c42a639706629395`.

- The canonical `build-runtime-image.sh` built the dedicated migration target.
  Its `--network none` smoke verified baked CLI/engines, generated client and
  compiled seed. Exact image retirement succeeded; cleanup was `no_op`.
- A signed coordinator ran real fresh PostgreSQL 16 migrations and seeding on
  an internal-only network. Repeat deployment retained a database sentinel.
- The application image passed `check-runtime-prisma-deps.cjs`, started and
  queried PostgreSQL through the generated client/adapter.
- A deliberately invalid SQL migration exited nonzero. Compose refused to
  start backend and worker; both remained stopped.
- A separate pristine main checkout built the actual 7.8.0 migration image,
  migrated and seeded PostgreSQL, then exported its full schema, data and
  migration history with `pg_dump`. The candidate restored that baseline and
  ran 7.10.0 deployment with external networking disabled. It preserved the
  sentinel, one seeded user and all 88 completed migration records. Its
  application image successfully queried the retained baseline data.

The upgrade fixture uses logical dump/restore, not a physical-volume handoff;
PostgreSQL stays on the same pinned version 16 image. No live deployment was
used. All three database proof subjects and their signed cleanup coordinators
finished successfully with `subjectExitStatus=0`, `cleanupExitStatus=0` and
`cleanupState=cleaned`.

## Evidence locations and hashes

Local evidence is retained in `/tmp/sanctuary-prisma-evidence`, including the
three disposable subject scripts, raw logs, image provenance/SBOM and signed
public cleanup artifacts. These operator-local paths are not durable CI URLs.
The table gives paths relative to that evidence directory and SHA-256 hashes.

| Evidence | SHA-256 |
| --- | --- |
| `image-proof.log` | `fb78efba82e99e612512878209a96edb3a9167b6971281022b30f83f9a0e38ab` |
| `sanctuary-prisma-runtime.log` | `aa12906bc03e7dee603f95b40f75ac0f577db17016d68d53d026333ec0bfbb36` |
| `sanctuary-prisma-baseline.log` | `431f6f81f9cfd125eac3c91d4d4672c52271d267e70977f56cc399e31d8e8777` |
| `sanctuary-prisma-upgrade.log` | `5a7629a99737362331ae9267264f91b8c0c1a854467bb846d88ee8e5b6894094` |
| `sanctuary-prisma-server-all.log` | `7f948a270a84ee5257ec15df931f121164dde6fc3658c432aa66b3b7f0f8554d` |
| `sanctuary-prisma-timeout-retest.log` | `edce105c8e50bf643c81f7254fdca6ed65f330b126939cb4b4e6a9edf70e2857` |
| `sanctuary-cleanup-local.i2hoPP/artifacts/final-upload.json` (fresh/negative) | `89213cdbdaec2a2333b86f6bbb3d8ee7d9ad8fa570114a4ee2827d536ceca80c` |
| `sanctuary-cleanup-local.wzenfs/artifacts/final-upload.json` (7.8 baseline) | `b35d58446ecd6c2481e4d1ed2c87073a4f80cf595cfbc144c015d0b1e6e10577` |
| `sanctuary-cleanup-local.UUQveG/artifacts/final-upload.json` (7.10 upgrade) | `c978548461fc1eac7eb36aa14091ef7ed859e30c3d95b2a88750162ed5cd6942` |
