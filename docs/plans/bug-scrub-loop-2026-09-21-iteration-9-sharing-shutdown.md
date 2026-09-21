# Bug Scrub Loop Iteration 9 — Sharing Refresh Ownership and HTTP Shutdown Admission

Source target: `4ec27dcf4e2dca75f1516a99351cb2fa6258179b` (`origin/main`). Scope: resolve every P0–P2 finding accepted by the complete iteration 9 whole-repository rescrub. Deployment remains deferred until a later complete pass finds zero P0–P2 bugs. PRs #1252 and #1269 are unrelated and remain untouched.

## Goal and accepted findings

Make one owner decide which same-route sharing snapshot may update each rendered access list, and stop new HTTP admission before graceful shutdown removes request dependencies.

- **P2 — `wallet-sharing--same-route-stale-refresh`:** `useWalletData` and `useWalletSharing` own separate request generations while writing the same `walletShareInfo`. A delayed pre-mutation read can overwrite the successful post-mutation refresh and leave enabled controls for obsolete principals or group state.
- **P2 — `device-sharing--same-route-stale-refresh`:** initial and post-mutation device share reads use route ownership only. An older same-route read can resolve last, overwrite the mutation result, and expose stale group or user controls.
- **P2 — `api-shutdown--http-admission-during-teardown`:** the API entrypoint closes its HTTP listener only after services, Redis, and Prisma are stopped. New and keep-alive requests can enter while those dependencies are being dismantled.

## Non-goals and assumptions

- Do not change wallet/device sharing authorization, role semantics, endpoint payloads, or persistence.
- Do not hide stale state with arbitrary delays or optimistic copies. The authoritative post-mutation read must own the shared state setter.
- Preserve route-change ownership and stale-search fencing already delivered in iteration 8.
- Preserve the 30-second forced shutdown deadline. Existing accepted connections may drain; new admission must stop synchronously at shutdown start.

## Phase 1 — Serialize sharing snapshots and close HTTP admission first

- [x] Add red wallet regressions that defer a pre-mutation share-info read, complete group/user add, update, or removal plus refresh with state B, then resolve state A last. Prove B remains rendered and stale role/group controls cannot issue a follow-up mutation. Exercise the real controller boundary so `useWalletData` and `useWalletSharing` participate in the same test.
- [x] Give wallet share-info reads one monotonic ownership source. Expose a refresh operation from the state-owning wallet data hook and route initial, visibility, transfer, and sharing-mutation reads through it. Increment ownership before each request, commit only the latest request for the current route, and return the committed/current response needed by the device-share prompt without letting a superseded response update state. Remove the second hook's direct share-info writer.
- [x] Add red device regressions that defer the initial share-info read, complete a group/user mutation and refresh with B, then resolve A last. Prove B remains and stale controls do not remove or replace the actual current group. Add the ownership-transfer variant: defer the initial share read, complete transfer plus its new share refresh, resolve the initial read last, and prove the transfer snapshot remains. Assert exactly one post-transfer share request and that `handleTransferComplete` does not settle until it commits or explicitly reports supersession.
- [x] Give device share-info reads a dedicated monotonic generation in addition to route ownership. Every initial and mutation refresh must begin a new generation; only the latest generation for the current route may write. Route reset/unmount must invalidate it. Make initial share/group loading depend on the loaded route identity rather than every replacement `device` object, so `handleTransferComplete` can refresh both the device and share info through exactly one awaited generation-owned operation without an effect starting a duplicate request. Transfer can change rendered owner and access controls. Preserve abort support, group/user filtering, error handling, and loading ownership.
- [x] Add API entrypoint shutdown-order regressions with a deliberately in-flight HTTP request. Trigger the registered signal handler and prove a fresh connection is refused once close starts while service, Redis, and database teardown have not begun; complete the admitted response, then prove dependency cleanup starts. Prove process exit waits for dependency cleanup after the request drain and repeated signals retain the existing single-shutdown/exit-code behavior. Trigger shutdown before `listen()` and prove callback `ERR_SERVER_NOT_RUNNING` is treated as an already drained listener, cleanup completes, and exit does not wait for the 30-second force timer. Stub a non-benign close callback error and prove it logs/escalates the exit code while cleanup still runs under the deadline.
- [x] Add a start-of-shutdown HTTP drain helper that invokes `httpServer.close()` once and immediately returns an always-settling result for its callback; do not create a temporarily unhandled rejection while other shutdown work is pending. Treat callback `ERR_SERVER_NOT_RUNNING` as an already drained listener. Record any other callback or defensive synchronous close error, log it, and escalate `shutdownExitCode` without skipping cleanup. Start the drain before WebSocket or dependency teardown, close WebSocket admission, **await the HTTP drain before stopping any request dependency**, then run service, Redis, and database teardown in the existing order. Keep the 30-second force timer across both phases and keep database-monitor drain immediately before final Prisma disconnect.

Acceptance: for wallet and device access state, an older same-route response can never replace a newer refresh; rendered access controls always correspond to the newest accepted snapshot. On API shutdown, the HTTP listener stops accepting requests before any dependency teardown starts, admitted requests retain their dependencies until they drain within the existing deadline, and dependency cleanup and exit occur only afterward.

Backout: revert the phase PR. No schema, stored access record, public API, or deployment configuration changes are involved.

## Verification and delivery

- [x] Run the focused wallet controller/hook and device ownership/access suites, including every new deferred ordering regression. Run frontend app/test/all type checks, lint, production build, and full frontend coverage at 100%.
- [x] Run the focused API entrypoint shutdown suite and the database/worker lifecycle suites to protect the iteration 8 drain ordering. Run server source/test type checks, lint, architecture/cycle/complexity/large-file gates, and full server unit coverage at 100%.
- [x] Run `git diff --check`, an independent P0–P2 implementation review, and the foreground pre-commit hook under Node 24.21.0/npm 12.0.2. Record exact commands and counts in this plan.
- [ ] Deliver through one protected Forgejo PR. Verify exact head CI, squash-merge ancestry and tree equality, and all exact merge-SHA target workflows before resolving findings.
- [ ] Run another complete whole-repository rescrub from the verified merge SHA. Deploy once only if that pass finds zero P0–P2 findings.

Completion requires all three findings resolved in `origin/main`, exact target CI green, no regression to iteration 8 ownership fixes, and a later complete zero-finding rescrub.

## Local verification evidence

- Frontend focused sharing/ownership suites: 60 tests passed; final device ownership and branch rerun: 26 tests passed.
- Frontend full coverage: 656 files and 8,859 tests passed; 100% statements (25,693/25,693), branches (16,353/16,353), functions (7,171/7,171), and lines (23,474/23,474).
- Server focused shutdown suites: 17 tests passed. Server full coverage: 718 files and 16,448 tests passed (766 skipped, 1 todo); 100% statements (40,993/40,993), branches (23,119/23,119), functions (8,732/8,732), and lines (38,190/38,190).
- Frontend app, test, and combined TypeScript checks; server source and test TypeScript checks; app/server lint and boundary checks; production build; architecture boundaries (2,431 files, 10,375 imports, 13 rules, 45 exceptions); server cycle baseline; lizard complexity; large-file classification; and `git diff --check` passed.
- Three independent final P0–P2 reviews approved the complete diff after review findings were fixed. The implementation commit passed the foreground Node 24.21.0/npm 12.0.2 pre-commit gate.
