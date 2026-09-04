# Dashboard Network Status Card Redesign Plan

Date: 2026-08-31
Status: Complete — PR A merged (#1007, 2cab474b56), PR B merged (#1008, 525369c8a5)
Baseline inspected: `5ab35aa71013bbace8021f6340e4cd69a62b404e`
Delivery shape: two serial, independently revertible protected PRs

## Goal

Replace the dashboard Node Status card's ambiguous connection-lease fraction
with a truthful, mode-aware view of the selected network's Electrum service:

- singleton mode identifies the configured endpoint and reachability;
- round-robin and least-connections modes summarize server availability;
- failover mode identifies the configured primary, the server that answered the
  status observation, whether failover is active, and the next failover candidate;
- pool-to-singleton fallback is visible instead of appearing fully healthy;
- unchecked or stale health is never presented as either online or offline.

The implementation must first align failover request routing with configured
priority. Today the strategy chooses where sockets are created, but ordinary
requests take the first idle socket in insertion order. The UI cannot truthfully
describe a primary/current route until that runtime behavior is corrected.

## User-facing vocabulary

The card remains a shallow `TelemetryCard`: eyebrow and badges, one headline,
one compact support region, and an optional server disclosure. Balanced and
singleton support stays on one line; failover may wrap its three facts across
two compact rows at narrow widths. Detailed pool metrics stay
behind the disclosure or in Admin; the dashboard does not show `active/total`
socket leases.

| Mode and condition | Headline | Support line |
| --- | --- | --- |
| Singleton reachable | `Operational` | `Connected to <host> · height <N>` |
| Singleton unreachable | `Offline` | Existing sanitized connection error |
| Singleton missing endpoint | `Node not configured` | `Open Admin → Node Config` |
| Pool with zero eligible servers | `No servers configured` | `Open Admin → Node Config` |
| Empty pool answered by singleton fallback | `Pool fallback active` | `Using singleton <host> · no pool servers configured` |
| Balanced pool, all checked online | `<online> of <total> online` | Strategy label · height |
| Balanced pool, mixed health | `<online> of <total> online` in warning treatment | `<offline + cooldown> unavailable` and/or `<unchecked + stale> unknown` |
| Balanced pool, all checked offline | `0 of <total> online` in error treatment | `<total> offline · no server answered` |
| Balanced pool, completed route-null with unchecked/stale evidence | `Health unknown` | `No server answered · <unavailable> unavailable · <unknown> unknown` |
| Failover, primary answered | `Primary online` | `Using <primary> · Next <backup>` |
| Failover, backup answered | `Failover active` | `Primary <label/state> · Using <backup> · Next <candidate or no further standby>` |
| Failover, no route and all fresh unavailable | `No server available` | `Preferred pool retry <server/state> · primary <state> · no server answered` |
| Failover, no route with unchecked/stale candidate | `Failover health unknown` | `Preferred pool retry <server/state> · primary <state> · no server answered` |
| Any pool, no route but fresh online evidence | `Status check failed` | `<N> recently online · no server answered` |
| Pool configured but singleton answered | `Pool fallback active` | `Using singleton <host> · pool unavailable` |
| Failover pool answered by singleton | `Pool fallback active` | `Primary <label/state> · Using singleton <host> · Next pool retry <preferred>` |
| Initial load or mismatched placeholder | `Checking…` | `Checking <network> node status…` |

The title remains `Node Status`. It carries the existing network badge and a
second text badge: `Single server`, `Round robin`, `Least connections`, or
`Failover`. Server rows use text as well as color: `Primary`, `In use`, `Next`,
or `Standby`, paired with `Online`, `Offline`, `Cooldown`, `Not checked`, or
`Stale`.

For a configured balanced pool, a normal disconnected response with complete
topology still uses the availability headline (`0 of N online` when every fresh
check failed) and adds `no server answered`. A minimal legacy error envelope with
no topology uses the generic `Offline` presentation.

Configuration gaps win before route-failure or health branches, but never hide a
successful singleton fallback or response-level staleness. An empty general pool
with no route has no disclosure and never renders `0 of 0 online`; a singleton
with no usable host never renders as an ordinary remote outage.

`Using` means the configured server that successfully answered this status
observation, not a permanently pinned socket. The response includes an
observation timestamp. `Next` means the next failover candidate if the observed
server became unavailable, and its displayed health remains independent (`Next
· Not checked` is valid; `Ready` is not inferred).

## Scope

### In scope

- Correct failover idle-connection selection and prove priority-based failback.
- Add an additive, network-specific operational projection to
  `GET /api/v1/bitcoin/status` while retaining existing raw pool metrics.
- Distinguish configured mode from the transport that actually answered:
  `pool`, `singleton`, or `singleton_fallback`.
- Model server availability as a freshness-aware enum rather than a raw boolean.
- Count only enabled endpoints eligible for the general network pool (`general`
  or `both`), using the canonical pool filtering path; silent-payments-only
  endpoints remain an Admin concern.
- Redesign `NodeStatusCard` around a pure presentation model and accessible
  disclosure.
- Update OpenAPI, frontend types, unit/integration tests, E2E fixtures,
  accessibility coverage, and the intentional dashboard visual baseline.

### Non-goals

- Do not change pool min/max sizing, weights, cooldown durations, retry policy,
  circuit-breaker policy, Tor routing, or server configuration UI.
- Do not redesign round-robin or least-connections acquisition policy in this
  work; preserve their current behavior while fixing failover priority truth.
- Do not add continuous probes for servers that have no connection. A server
  without completed fresh evidence is `Not checked`, never optimistically online
  or pessimistically offline.
- Do not display request throughput, queue depth, acquisition latency, socket
  busy counts, or health history in the collapsed dashboard card.
- Do not redesign `TelemetryCard`, the other telemetry cards, the dashboard
  grid, or Admin Node Config.
- Do not add a database migration or version bump.
- Do not infer route identity from Electrum's `server` version string,
  connection count, total request counter, or configured array position alone.

## Behavioral invariants

1. `0 active / 3 total` with three idle sockets and fresh successful per-server
   health evidence means three online servers and zero busy sockets; it never
   renders as `0/3` availability. Socket presence alone is not health evidence.
2. A failover request selects the lowest-priority-number eligible server even
   when another server's idle socket was inserted earlier.
   It does not spill to an idle backup merely because the healthy primary is
   busy: it creates primary capacity when allowed or queues for primary capacity.
3. When the primary becomes eligible again, the next failover request returns to
   it without requiring pool restart or socket recreation.
4. Round-robin and least-connections behavior is unchanged by the failover fix.
5. The five exact availability counts always sum to the enabled, general-pool-
   eligible server total. The compact card may derive `unavailable = offline +
   cooldown` and `unknown = unchecked + stale`, while the disclosure preserves
   every exact text state.
6. A successful status observation is authoritative reachability evidence for
   the answering server at `observedAt`, even if an older periodic health record
   has not yet converged. This response-only overlay does not rewrite health DB
   state.
7. A successful singleton fallback cannot produce the normal pool-operational
   presentation.
8. A failed connectivity check still returns the selected network, configured
   mode/strategy, topology when configuration was readable, and `connected:
   false`; only a configuration-read failure may return the minimal legacy error
   envelope.
9. Previous data retained during a network-tab change never appears under the
   newly selected network badge.
10. Status dots and icons are supplementary; every state and server role has
    adjacent text.

## Status contract

Keep `connected`, block height, host, pool sizing, and `pool.stats` for backward
compatibility. Add a typed operational projection rather than repurposing raw
metrics:

```ts
type ServerAvailability = 'online' | 'offline' | 'cooldown' | 'unchecked' | 'stale';
type PoolFallbackReason = 'pool_uninitialized' | 'pool_empty' | 'pool_probe_failed' | 'pool_circuit_open';

type NodeRouteObservation =
  | { transport: 'pool'; observedAt: string; serverId: string }
  | { transport: 'singleton'; observedAt: string; serverId: null }
  | {
      transport: 'singleton_fallback';
      observedAt: string;
      serverId: null;
      fallbackReason: PoolFallbackReason;
    };

interface NodeOperationalStatus {
  configuredMode: 'singleton' | 'pool';
  attemptedAt: string;
  route: NodeRouteObservation | null;
  pool: PoolOperationalStatus | null;
}

interface PoolOperationalStatus {
  strategy: NodePoolLoadBalancing;
  online: number;
  offline: number;
  cooldown: number;
  unchecked: number;
  stale: number;
  primaryServerId: string | null;
  preferredServerId: string | null;
  nextFailoverServerId: string | null;
  servers: Array<{
    serverId: string;
    label: string;
    host: string;
    port: number;
    priority: number;
    availability: ServerAvailability;
    checkedAt: string | null;
  }>;
}
```

Names and the exact bounded fallback-reason vocabulary may be adjusted to
existing conventions during implementation, but these discriminants and
nullability are acceptance requirements. `fallbackReason` is required only for
singleton fallback and is a reason code, never a raw exception message,
credential, or endpoint secret.

`NodeOperationalStatus` is present for normal connected and disconnected
responses. `configuredMode` remains truthful during fallback; `attemptedAt`
records a failed or successful status attempt, while `route` is null when no
backend answered. Strategy is required only in a non-null pool projection. A
minimal configuration-read-failure envelope may omit the operational projection
and receives the legacy presentation.

`primaryServerId` is the configured lowest-priority-number general-pool endpoint,
even when unavailable. For failover, `preferredServerId` is the side-effect-free
server the selector would attempt now. `nextFailoverServerId` is the candidate
after excluding an observed pool route. All three role fields are null for
balanced strategies except where a general-purpose primary concept is explicitly
added later.
For failover with `route: null`, `nextFailoverServerId` is also null: the primary
and preferred target are rendered without duplicating either as `Next`. A next
candidate exists only relative to an observed pool route server.
When primary and preferred are the same, collapsed copy combines the facts (for
example, `Preferred pool retry Primary A · Offline`) instead of repeating the
label. `preferredServerId` is prospective and must never be described as a server
that was actually attempted when no successful route observation exists.
Operational server entries carry their display identity so the card does not
depend on nullable legacy raw stats to resolve role IDs. Labels/hosts remain
subject to the endpoint's existing authenticated visibility and are never logged
or included in fallback errors.

Server availability is derived at response time:

- `online`: the same-response status observation succeeded on that server;
- otherwise `cooldown`: the cooldown deadline is in the future, even if the most
  recent health check succeeded;
- otherwise `online` or `offline`: the most recent completed health check is
  fresh and succeeded or failed, respectively;
- `unchecked`: no completed health check exists;
- `stale`: the last completed check is older than the pool's explicit freshness
  window.

The freshness window must be derived from the configured health-check interval
with a documented bounded grace period and tested with a fake clock. Do not use
the frontend's 60-second polling interval as server-health truth.

## Implementation prerequisites

- Start PR A from a fresh branch/worktree based on the forge's current protected
  target branch, not the release branch used for this planning snapshot. Preserve
  all unrelated dirty/untracked work.
- Re-read repository instructions and revalidate the first-idle failover path,
  general-pool server filter, status fallback, API/OpenAPI shapes, and affected
  test inventory against that refreshed baseline before writing regressions.
- If any of those source facts changed, update and recursively review this plan
  before implementation rather than forcing stale file paths or assumptions.
- Deliver PRs serially: PR B branches only after PR A is verified on the target
  branch, because its truthful presentation depends on PR A's routing contract.

## PR A — Routing truth and additive status contract

### A1. Lock current and desired behavior with regressions

- [x] Add a regression proving raw `activeConnections` counts borrowed sockets,
      while three idle healthy sockets remain available.
- [x] Add failover acquisition tests where idle socket insertion order conflicts
      with configured priority; require the primary socket to win.
- [x] Add primary-busy/backup-idle failover tests. With capacity available,
      require another primary connection; at capacity, require queueing rather
      than backup spillover. A backup route is evidence of primary ineligibility,
      not ordinary load pressure.
- [x] Prove a queued failover request is not drained by a backup release while
      the primary remains eligible, is drained by primary release, and may move
      to backup only after eligibility changes before queue drain.
- [x] Add failover transition tests for primary healthy → primary offline or in
      cooldown → backup selected → primary recovered → primary selected again.
- [x] Prove the next attempted server skips an ineligible server and preserves
      the selector's documented all-unhealthy fallback without calling it online.
- [x] Prove a mixed `general` / `both` / `silent_payments` server configuration
      counts and routes only through endpoints eligible for the general pool.
- [x] Add equal-priority tests proving one deterministic `(priority, serverId)`
      order drives runtime acquisition, primary ID, and next-failover ID.
- [x] Pin round-robin and least-connections acquisition behavior before changing
      the failover path, then require no regression in those modes.

Primary files:

- `server/tests/unit/services/bitcoin/electrumPoolConnections/internal-health-selection.contracts.ts`
- adjacent acquisition/connection-manager contract suites
- `server/tests/unit/services/bitcoin/electrumPool.test.ts`

### A2. Make failover idle acquisition strategy-aware

- [x] Replace the unconditional first-idle lookup for `failover_only` with a
      target-first path: choose the highest-priority eligible server with the
      canonical selector, then use an idle connection for that server, create one
      for that server when capacity permits, or queue. Reuse the same eligibility
      and fallback rules as `serverSelector.ts`; never choose backup solely because
      its socket is idle.
- [x] Keep round-robin index mutation out of read-only routing snapshots. Do not
      call the weighted selector merely to describe future routing.
- [x] Thread strategy/server state only through the acquisition boundary that
      needs it; do not duplicate selection rules in `networkStatusService.ts`.
- [x] Make queued-request draining reuse the same target-first decision and
      re-evaluate current eligibility at drain time. Preserve queue ordering,
      timeout cleanup, and exactly-once resolution while preventing a released
      backup from satisfying a request whose primary is still eligible.
- [x] Canonically order general-pool servers by `(priority, serverId)` and reuse
      that order in selection and projection so equal priorities cannot create
      different runtime and displayed primaries. No uniqueness migration is needed.
- [x] Keep dedicated subscription ownership, pool capacity limits, connection
      lifecycle, queue ordering/timeouts, and release idempotency unchanged.

Primary files:

- `server/src/services/bitcoin/electrumPool/serverSelector.ts`
- `server/src/services/bitcoin/electrumPool/connectionManager.ts`
- `server/src/services/bitcoin/electrumPool/electrumPool.ts`

### A3. Capture truthful route identity and transport provenance

- [x] Resolve one immutable configuration snapshot per status attempt from the
      node configuration plus servers. Derive mode, strategy, routable topology,
      display endpoint, and full internal singleton connection configuration from
      that same snapshot using existing pure projection helpers. Preserve host,
      port, protocol, self-signed-certificate policy, and proxy/Tor settings; do
      not call a second repository reader or silently mix in default mode.
- [x] If configured mode is pool but that snapshot has zero eligible general-pool
      servers, do not initialize or acquire the pool's implicit synthetic default
      connection. Attempt the explicit singleton path directly: success is
      `singleton_fallback` with reason `pool_empty`; failure is `route: null` with
      empty topology and null role IDs.
- [x] Extend `PooledConnectionHandle` with immutable configured-server identity
      (`serverId`, label, host, port) sourced from the borrowed connection.
- [x] Have the status probe return the identity of the single handle used for
      version and height, plus `observedAt`. Retain the handle until every started
      RPC settles (for example, parallel `allSettled` with explicit validation),
      create route evidence only if the complete observation succeeds, and release
      exactly once after settlement on every success/error/abort path.
- [x] Make each status backend read return its transport provenance atomically
      with the successful result. After a failed pool probe, use an explicit
      direct singleton status path that cannot return or retry a cached
      `PooledNodeClient` and receives the already-resolved full singleton
      connection config;
      do not infer provenance from configuration/cache or trigger another config
      read inside the connection resolver.
- [x] Make that explicit direct singleton client attempt-scoped and disconnect it
      in `finally` only after every started RPC settles, on connection failure,
      success, RPC failure, timeout, or abort. A disconnect error is logged without
      secrets and cannot replace the primary result/error; no polling socket may
      survive the attempt.
- [x] Before creating configured-singleton or singleton-fallback route evidence,
      run the existing requested-network identity verification with the attempt's
      abort/deadline context. A wrong-genesis/identity result is disconnected with
      `route: null`, preserves readable topology, and is never downgraded to a
      successful fallback.
- [x] Cover a cached initialized pool facade whose status acquisition fails and
      prove the subsequent answering client and reported transport are singleton
      fallback.
- [x] Simulate configuration changing or a second repository read failing during
      an attempt; require the response and connection target to remain internally
      consistent with the single captured snapshot.
- [x] Prove proxy (including authentication) and self-signed-certificate policy
      reach the direct fallback client while credentials never enter status DTOs,
      errors, logs, or snapshots.
- [x] Add delayed-version/failing-height and failing-version/delayed-height pool
      tests proving the handle is not released early, plus direct-client success,
      connect failure, one-RPC failure, timeout, and disconnect-throws cleanup
      tests proving exactly-once ownership cleanup.
- [x] Add successful and failed empty-pool fallback tests proving the pool
      registry/acquire path is never called, no synthetic `default` server enters
      route/topology output, and the attempt-scoped singleton client is cleaned up.
- [x] Add wrong-network configured-singleton and fallback tests, plus verification
      abort/timeout tests, proving identity verification settles before disconnect
      and no route evidence is emitted for the wrong chain.
- [x] Do not add global last-used application routing state. The status
      observation itself is the bounded evidence displayed by the card.

Primary files and tests:

- `server/src/services/bitcoin/electrumPool/types.ts`
- `server/src/services/bitcoin/electrumPool/acquisitionQueue.ts`
- `server/src/services/bitcoin/networkStatusService.ts`
- `server/src/services/bitcoin/nodeClient.ts`
- `server/tests/unit/services/bitcoin/pooledNodeClient.test.ts`
- focused acquisition-queue and node-client tests

### A4. Build the operational projection

- [x] Add one pure backend projector that combines network mode, configured
      priority, live pool stats, freshness, route observation, and transport.
- [x] Capture servers, server states, route evidence, effective interval, and one
      evaluation timestamp into an immutable snapshot before deriving counts or
      roles, so a concurrent health transition cannot produce internally
      inconsistent totals, primary, current, and next fields.
- [x] Build its topology through the canonical general-pool server filter so
      silent-payments-only endpoints cannot enter totals or failover roles.
- [x] Expose a side-effect-free failover snapshot from the pool/selector boundary
      for primary and next-attempt IDs; do not reimplement eligibility in the API.
- [x] Define `nextFailoverServerId` as the server selected for a hypothetical next
      attempt after excluding the observed server from the candidate set entirely.
      Apply the same priority/cooldown/all-unhealthy fallback rules to the
      remainder; return null when no distinct alternate exists. Assert exact IDs
      for primary→backup, backup→tertiary, skipped ineligible, all-cooldown,
      all-unhealthy, and one-server cases.
- [x] Return `nextFailoverServerId: null` unless `route.transport === 'pool'`.
      With no route or a singleton fallback route, `preferredServerId` is the next
      pool attempt; there is no observed pool route against which a distinct next
      candidate can be defined.
- [x] Return a side-effect-free `preferredServerId` for failover regardless of
      route success, using the same immutable selector snapshot. It identifies
      the next pool retry during singleton fallback and can differ from primary.
- [x] Keep preferred routing explicitly prospective. Test circuit-open before
      acquisition, acquisition timeout without a handle, handle-acquired/RPC-fail
      with eligibility changing before projection, and successful singleton
      fallback after pool-probe failure; none may claim preferred was attempted.
- [x] Overlay a successful route observation as fresh online evidence in the DTO
      without mutating periodic health state or database health.
- [x] Preserve configured servers when the pool is uninitialized and represent
      their health as `unchecked` unless persisted checked evidence is fresh.
- [x] Refactor status error composition so reachable topology survives backend
      failure and `network` is present on normal disconnected responses.
- [x] Return explicit transport/fallback state. Exercise cached pool facade,
      initial pool failure, singleton fallback, configured singleton, no servers,
      uninitialized pool, all unhealthy, cooldown, stale, and config-read failure.
- [x] Prove `route: null` with truthful configured mode/topology when both pool
      and explicit singleton fallback fail, and when configured singleton fails;
      keep the minimal legacy envelope only for configuration-read failure.
- [x] Require the five availability counts to sum exactly to the projected
      routable topology; test every state and freshness/cooldown boundary with a
      fake clock.
- [x] Require primary, preferred, next, and pool-route server IDs emitted by the
      normal projector to reference members of the same returned topology; retain
      frontend defensive handling for malformed external responses.
- [x] Expose the live pool's effective `healthCheckIntervalMs` (or an already
      computed freshness window/deadline) through a read-only operational/config
      snapshot. The projector must not reconstruct it from defaults or environment
      values. Test a non-default interval and a reloaded interval.
- [x] Keep raw pool metrics additive and unchanged for Admin/observability users.

Primary files and tests:

- `server/src/services/bitcoin/networkStatusService.ts`
- `server/src/services/bitcoin/electrumPool/metricsExporter.ts` only if projection
  inputs need additive priority metadata
- `server/tests/unit/api/bitcoin/bitcoin.network.contracts.ts`
- focused `networkStatusService` unit tests if the route suite becomes unwieldy

### A5. Make the public contract explicit

- [x] Define the DTO vocabulary with the existing canonical
      `NodePoolLoadBalancing` type from `shared/constants/nodeConfig.ts`; avoid a
      fourth string union.
- [x] Reconcile duplicate frontend pool types in `src/api/bitcoin.ts` and
      `src/types/index.ts` rather than adding a third divergent declaration.
- [x] Expand the OpenAPI pool schema from `additionalProperties: true` to named
      strategy, route, operational summary, server availability, and legacy raw
      stats fields with required/nullability rules.
- [x] Encode route provenance as the same discriminated `oneOf`: pool requires a
      server ID and forbids a fallback reason; configured singleton has a null
      server ID and no reason; singleton fallback has a null server ID and a
      required bounded reason. Add compile-time/projector and route/OpenAPI tests
      for valid and rejected combinations.
- [x] Add OpenAPI and route contract assertions for every enum and disconnected
      envelope. Keep new fields additive so the old card remains functional
      between PR A and PR B.

PR A verification gate:

- [x] Run focused Electrum selector, connection, acquisition, node-client, status
      route, and OpenAPI suites.
- [x] Run `cd server && npm run typecheck:tests && npx tsc --noEmit`.
- [x] Run `cd server && npx vitest run --coverage tests/unit` and retain backend
      unit coverage thresholds.
- [x] Run applicable lint/static gates, especially API/OpenAPI, Bitcoin network
      boundaries, safety catch guards, architecture, complexity, and diff check.
- [x] Independently review routing transitions, release/error paths, fallback
      provenance, health freshness, null/empty topology, and secret-safe errors.

PR A acceptance:

- Failover selection and failback match displayed priority semantics.
- The additive response distinguishes configuration, actual transport, route
  observation, health freshness, and raw socket metrics.
- All other pool strategies and current consumers remain behaviorally stable.
- PR A can ship with the old card and can be reverted without data rollback.

## PR B — Mode-aware card and rendered behavior

### B1. Normalize selected-network status data

- [x] At the API/query boundary, ensure every response carries the requested
      network when consuming a legacy minimal response.
- [x] Surface React Query placeholder state and require response network to match
      the active dashboard network before presenting routing details; otherwise
      show `Checking…` and never reuse the previous network's topology. Keep the
      selected network badge, but omit the strategy badge until matching-network
      configuration arrives.
- [x] Preserve stale same-network data on transient refetch failure rather than
      blanking it, but pass query error and update time into the presenter. Render
      `Last known: <summary>` plus a truthful evidence timestamp in a warning
      treatment as soon as a retained-data refetch fails. Use `observed
      <route.observedAt>` for a successful route, `attempted
      <operational.attemptedAt>` for route-null, and `received <dataUpdatedAt>`
      for a minimal legacy response. Do not continue
      presenting the frozen projection as live, and do not reclassify backend
      server health from the frontend's polling interval.
- [x] Treat a response as last-known after two missed 60-second polling windows
      even without an error (for example, after background-tab throttling). Use
      React Query's local update time for this response-level boundary and the
      backend `observedAt` only for displayed evidence time. A successful refresh
      returns immediately to current presentation.
- [x] Implement that boundary with a small response-freshness hook/controller:
      schedule a one-shot update for `dataUpdatedAt + 120s`, recalculate on focus
      or `visibilitychange`, and cancel/reschedule on new data, network change, or
      unmount. Prove with fake timers that last-known appears without a query
      event, foreground return reevaluates immediately, and a rapid switch cannot
      fire the prior network's timer.
- [x] Do not treat cross-network placeholder data as same-network retained data.
      Cover repeated refetch failure and recovery with a controlled clock. Add a
      rapid switch between networks with different modes and prove neither the
      prior server labels nor prior strategy badge appears.
- [x] Validate and format all evidence timestamps defensively. Add aged/retained
      route-success, route-null, and minimal-legacy tests proving no blank time,
      `Invalid Date`, or false `observed` label can render.

Primary files and tests:

- `src/api/bitcoin.ts`
- `src/hooks/queries/useBitcoin.ts`
- `src/components/Dashboard/hooks/useDashboardData.ts`
- `src/components/Dashboard/hooks/useNodeStatusFreshness.ts` (suggested)
- `src/components/Dashboard/hooks/dashboardDataModel.ts`
- `tests/hooks/queries/useBitcoin.test.ts`
- `tests/components/Dashboard/useDashboardData.test.tsx`
- focused freshness-hook tests with fake timers and visibility changes

### B2. Build a pure presentation model

- [x] Add a small, exhaustive presenter adjacent to `NodeStatusCard` that maps
      singleton, balanced, failover, fallback, checking, unknown, and legacy
      response shapes to badges, headline, tone, support items, and server rows.
- [x] Apply presentation precedence explicitly: mismatched/initial response →
      retained/aged wrapper → successful singleton fallback → configuration gap
      → route failure → successful singleton/balanced/failover health presentation.
      Response currency wraps every matching response, including configuration
      gaps. A
      route failure cannot look operational merely because recent health checks
      remain successful.
- [x] Do not let the existing `nodeStatus === 'error'` shortcut collapse a rich
      `connected: false` operational response into generic Error. Use the
      mode/topology route-failure models whenever present; reserve generic Error
      for minimal legacy/configuration-read failure.
- [x] Keep parsing/state derivation out of JSX and keep every edited/new function
      below `CCN <= 15`; use discriminated helpers rather than nested branches.
- [x] Derive balanced counts only from the operational projection. Keep
      `offline`, `cooldown`, `unchecked`, and `stale` separate in arithmetic;
      derive compact unavailable/unknown copy only after verifying the exact
      counts sum to total.
- [x] Use `primaryServerId`, `preferredServerId`, `nextFailoverServerId`, and
      `route.serverId` for failover labels. Do not infer roles from connection
      counts or the `server` software string, and do not invent a separate
      effective-server field.
- [x] In backup-active failover, keep all three requested facts collapsed and
      visible: configured primary plus state, observed route, and next failover
      candidate (or `No further standby`). Allow the compact region to wrap only
      as proven by responsive tests.
- [x] In failover singleton fallback, keep primary/state, singleton route, and
      `Next pool retry <preferred>` visible without disclosure; handle null
      preferred target as `No pool server available`.
- [x] Resolve preferred IDs only against the returned operational topology. If a
      malformed/additive payload references a missing ID, preserve primary and
      singleton facts and render `Next pool retry unknown` rather than crashing,
      omitting the fact, or inventing a label.
- [x] Split failover `route: null`: say `No server available` only when every
      candidate has fresh offline/cooldown evidence; if any candidate is unchecked
      or stale, say `Failover health unknown` and `No server answered` without
      claiming definitive unavailability.
- [x] If any pool has `route: null` but one or more fresh-online server results,
      show `Status check failed` and qualify the count as `recently online`; do not
      use the normal operational headline. For failover, render the preferred
      target as `Preferred pool retry`, preserve primary/state separately unless
      it is the same server, and suppress `Next` or any historical-attempt claim.
- [x] For balanced `route: null` with zero online and any unchecked/stale evidence,
      show `Health unknown` plus `No server answered` and the compact
      unavailable/unknown counts. Reserve `Checking…` for an in-flight query;
      test all-unchecked, offline+unchecked, and cooldown+stale as completed
      failures distinct from initial load and fallback.
- [x] Provide a safe legacy pool presentation when additive fields are absent:
      transport-neutral `Network operational` plus `Pool route unknown` and an
      optional configured-server count, never the old lease ratio or a claim that
      pool, primary, or a configured server answered. The legacy backend can hide
      singleton fallback behind `pool.enabled: true`.
- [x] Handle null stats, empty server arrays, zero configured servers, missing
      block height, missing host, long labels, and unknown enum data defensively.
- [x] Give zero eligible pool servers and a singleton missing a usable host
      explicit configuration-gap models with Admin guidance; these branches win
      before `0 of 0`, offline, unknown, and disclosure logic.
- [x] When an empty pool has a successful singleton fallback with reason
      `pool_empty`, combine both truths: `Pool fallback active`, the singleton
      host in use, and `no pool servers configured`, with Admin guidance in detail.
      Do not let the empty-pool branch suppress active fallback.
- [x] Render configured-mode badges independently of answering transport; prove
      disconnected pool, pool fallback, disconnected singleton, and minimal
      legacy envelopes.

Suggested files:

- `src/components/Dashboard/nodeStatusCardModel.ts`
- `src/components/Dashboard/NodeStatusCard.tsx`
- `tests/components/Dashboard/nodeStatusCardModel.test.ts`

### B3. Render the shallow, accessible card

- [x] Keep `TelemetryCard` and dashboard grid structure unchanged.
- [x] Add the strategy badge beside the existing network badge without allowing
      long labels to overflow at phone, tablet, or three-column desktop widths.
- [x] Replace the generic connected headline and lease fraction with the
      mode-specific presentation table defined above.
- [x] Keep server topology collapsed by default. Give the revealed region a
      stable ID and pass `controls` to `ShowMoreToggle` so `aria-expanded` and
      `aria-controls` describe the true disclosure.
- [x] Put textual role and availability beside each decorative dot. Do not add
      `aria-live` to the whole 60-second-refreshing card; if a concise live state
      is added, limit it to the headline and prove it does not repeat details.
- [x] Preserve the existing guidance to Admin Node Config for unavailable/error
      states and keep error copy sanitized.

Primary files and tests:

- `src/components/Dashboard/NodeStatusCard.tsx`
- `src/components/Dashboard/TelemetryCard.tsx` only if an existing slot cannot
  express two adornments; prefer no shared primitive change
- `tests/components/Dashboard/NodeStatusCard.test.tsx`
- `tests/components/Dashboard/Dashboard.render.test.tsx`

### B4. Cover mode/state, accessibility, and visuals

- [x] Replace literal `Connected` and `2/3` assertions with semantic assertions.
- [x] Add table-driven unit coverage for singleton; balanced all-online,
      degraded, all-offline, mixed unknown/stale/cooldown, initializing, empty,
      and legacy; failover primary, backup→tertiary, backup with no alternate,
      recovery, no-route all-unavailable, no-route all-unchecked, no-route
      all-stale, no-route mixed unavailable/unknown, no-route all-online,
      no-route mixed online/offline, primary-equals-first-attempt suppression,
      empty-pool fallback, aged/error empty-pool and missing-singleton responses,
      and fallback with preferred backup, preferred primary, null preferred, and
      missing preferred ID.
- [x] Prove `0 active / 3 idle` renders `3 of 3 online` when health evidence says
      all three servers are online.
- [x] Test long labels, disclosure keyboard behavior, `aria-expanded`,
      `aria-controls`, and visible status text independent of color.
- [x] Inventory every E2E `/bitcoin/status` mock and every `activeConnections`
      fixture. Update all pool response fixtures to the additive contract so
      they do not accidentally exercise the legacy branch; keep one focused
      unit test for legacy compatibility.
- [x] Include a legacy `connected: true`, `pool.enabled: true`, raw-stats response
      with no operational projection and prove the UI says neither pool/primary
      nor any configured server is in use.
- [x] Add representative round-robin and failover fixtures rather than trying to
      encode every mode in the single canonical dashboard screenshot.
- [x] Add a mixed general/both/silent-payments fixture proving only general-pool-
      eligible servers affect the dashboard denominator and roles.
- [x] Update accessibility coverage for the Node Status disclosure.
- [x] Move the exact dashboard PNG baseline to an ignored temporary backup,
      regenerate the canonical 1280×720 light screenshot, inspect the decoded
      image, and restore the backup if the render test fails. Do not rely on a
      passing 1% pixel tolerance as proof the layout changed correctly.
- [x] Add repeatable focused Playwright evidence at 375×812, 768×1024, and
      1280×720 using long server labels. Assert no element bounding box escapes
      the card/container and the page has no horizontal overflow. Separately prove
      the chosen truncation or wrapping keeps full accessible label text and does
      not obscure role/status; use `scrollWidth <= clientWidth` only for containers
      explicitly forbidden to truncate or scroll. Capture an explicit 1280×720
      dark-mode card screenshot/artifact and assert the same semantic text in
      light and dark modes.

Relevant E2E surfaces include:

- `tests/e2e/render-regression/renderRegressionHarness.ts`
- `tests/e2e/render-regression/renderRegressionCore.contracts.ts`
- `tests/e2e/accessibility.spec.ts`
- `tests/e2e/dashboard-price-blocks.spec.ts`
- the remaining status fixtures found by `rg -n "GET /bitcoin/status|activeConnections" tests/e2e`

PR B verification gate:

- [x] Run focused presenter, `NodeStatusCard`, dashboard render/data, query, and
      accessibility tests first.
- [x] Run `npm run typecheck:app && npm run typecheck:tests && npx tsc --noEmit`.
- [x] Run `npx vitest run --coverage` and retain frontend coverage thresholds.
- [x] Run `npm run lint:app`, `npm run build`, applicable static/complexity gates,
      and `git diff --check`.
- [x] Without starting Vite on the host, serve the built `dist/` through an
      ignored throwaway static-server/Playwright config with no `webServer` block;
      run focused Chromium dashboard render and accessibility cases.
- [x] Inspect the regenerated PNG rather than trusting the tolerance alone, and
      record the named light/dark and three-viewport responsive evidence.
- [x] Independently review semantic accuracy, network-switch races, fallback and
      unknown states, keyboard/screen-reader behavior, responsive overflow,
      test-fixture completeness, and unintended telemetry-card changes.

PR B acceptance:

- The card answers the user's mode-specific questions without requiring the
  disclosure: balanced availability, or failover primary/current/next.
- No state uses `activeConnections/totalConnections` as health or availability.
- Pool fallback, disconnected, checking, stale, unchecked, and empty states are
  visibly distinct and truthful.
- Network switches cannot momentarily show the previous network's route.
- The card remains shallow and aligned with sibling telemetry cards at supported
  widths, in light and dark themes, with an accessible disclosure.
- PR B can be reverted independently while retaining the additive backend
  contract from PR A.

## Rollout and backout

1. Deliver PR A first. It is additive at the HTTP boundary and must keep the old
   dashboard working. Observe status responses for each enabled network and
   compare displayed raw stats with the new projection before starting PR B.
2. Deliver PR B only after PR A is on the target branch. Rebuild only already
   running local application containers after verified merge and target-branch
   CI, following repository workflow.
3. Back out PR B alone for a visual/presentation regression. The old card can
   ignore PR A's additive fields.
4. Back out PR A only if routing or status behavior regresses. No database or
   persisted-data rollback is required. If PR B has already landed, revert PR B
   first so it does not depend on removed fields.

## Edge-case audit required at implementation closeout

- Null/undefined status, pool, stats, route, timestamps, labels, and host.
- Empty configured servers and server counts of zero or one.
- Equal priorities, duplicate/missing IDs, a route ID absent from the returned
  server list, and next ID equal to current/primary.
- Clock boundaries at freshness and cooldown expiry.
- All servers unchecked, stale, cooldown, offline, or mixed.
- Status success concurrent with health-state mutation or pool reset.
- Handle release on version failure, height failure, abort, timeout, and fallback.
- Cross-network placeholder data and rapid repeated network switches.
- Long server labels, narrow cards, dark mode, reduced motion, keyboard-only
  disclosure, and color-independent status.

## Completion criteria

- Both PR acceptance sections and verification gates are complete.
- No changed production function exceeds `CCN 15`; no edited production file is
  pushed past the repository's 500-line refactor trigger without extraction.
- Full backend unit and frontend coverage thresholds remain green.
- Focused Playwright accessibility/render checks pass against a production build,
  and the exact regenerated baseline is visually inspected.
- Independent adversarial review has no unresolved correctness, accessibility,
  responsive, or verification findings.
- Final diff review finds no unrelated scope, duplicated selection logic,
  misleading copy, raw secret exposure, or accidental active/total health usage.

## Recursive review log

Eleven complete review passes were run. Pass 11 re-read the final plan and found
no verified actionable backend or frontend/UX comments.

Accepted improvements applied:

- Passes 1–2 made availability arithmetic exhaustive, separated cooldown,
  unchecked, and stale states, defined truthful all-offline/unknown copy, added
  configured mode and nullable route provenance, constrained topology to the
  general pool, and made responsive/dark verification executable.
- Passes 3–4 made failover routing target-first under busy-primary and queue-drain
  conditions, added deterministic equal-priority ordering and one immutable
  configuration snapshot, defined primary/preferred/next roles, covered retained
  response freshness with a real timer, and completed empty/no-route UI states.
- Passes 5–7 added settle-before-release and attempt-scoped singleton cleanup,
  full proxy/certificate propagation without secret exposure, discriminated route
  DTO/OpenAPI rules, empty-pool bypass of the synthetic default connection,
  wrong-network identity verification, truthful retained timestamps, safe invalid
  role-ID handling, and transport-neutral legacy copy.
- Passes 8–10 clarified prospective preferred-route wording, completed balanced
  no-route/unknown states, made operational server display identity self-contained,
  and aligned route/current/preferred copy with the exact DTO.
- Pass 11 confirmed the final field names and full plan were clean.

Rejected or deferred comments:

- Global last-used application-server telemetry was rejected for this scope. A
  strategy-correct status observation provides bounded evidence without adding
  mutable cross-request routing history.
- Continuous probes for connectionless standby endpoints were deferred because
  they change network load and lifecycle policy; the plan represents absent or
  stale evidence honestly instead.
- A database uniqueness migration for server priorities was rejected as
  unnecessary; a shared deterministic `(priority, serverId)` order handles
  malformed/equal priorities without persisted-data risk.
- A page/card-wide live region was rejected because 60-second refreshes would
  create repeated screen-reader chatter; visible text and disclosure semantics
  carry status without color dependence.
- Shared `TelemetryCard`, dashboard-grid, Admin configuration, and balanced-mode
  acquisition redesigns remain outside the requested card/failover boundary.

Final result: clean. No verified actionable plan comments remain.
