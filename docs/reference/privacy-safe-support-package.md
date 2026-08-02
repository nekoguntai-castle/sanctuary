# Privacy-safe support package reference

Sanctuary's support package version `2.0.0` is a locally generated,
administrator-only diagnostic artifact. Its only profile is
`shareable_aggregate`. The server does not upload the file or contact a
notification provider while generating it.

Generation requires an explicit acknowledgement because aggregate counts and
coarse activity windows can still reveal operational activity on a small
deployment. Treat the downloaded file as support evidence and share it only
with the intended support party.

## Privacy boundary

The package is built from exact, strict schemas. Unknown fields fail validation;
legacy collectors are excluded unless they are separately admitted to the
shareable registry. The final canonical JSON bytes are size-limited and scanned
for secret values and identifier-shaped data before response headers are sent.

The shareable profile excludes:

- names, usernames, user IDs, wallet IDs, aliases, and access relationships;
- addresses, transaction IDs, job IDs, amounts, fees, and transaction payloads;
- chat IDs, recipient IDs or counts, message content, and provider responses;
- URLs, hosts, endpoints, connection strings, credentials, and tokens;
- raw logs, stack traces, exception messages, and dead-letter payloads; and
- timestamps tied to an individual transaction, job, or notification attempt.

The package does include its own generation time and operational sample times.
Those timestamps describe the diagnostic observation, not an individual user's
activity. A complete package is limited to 256 KiB and each collector's data is
limited to 16 KiB.

## Envelope and section contract

The top-level fields are:

| Field           | Meaning                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | Exact artifact schema version, currently `2.0.0`.                                                                                  |
| `profile`       | Exact privacy profile, currently `shareable_aggregate`.                                                                            |
| `generatedAt`   | Time package generation began.                                                                                                     |
| `serverVersion` | Sanctuary application version that generated the file.                                                                             |
| `collectors`    | Strict map of admitted section names. A section may be absent when a deliberately restricted internal generation selects a subset. |
| `meta`          | Bounded total duration plus fixed lists of successful and failed collector names.                                                  |

Every present collector is either `ok` with strict `data`, or `error` with one
of `timeout`, `unavailable`, `privacy_policy_violation`, or `internal_error`.
Both forms include:

| Field          | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `durationMs`   | Bounded wall-clock collection duration.                                     |
| `truncated`    | Whether the collector intentionally omitted records to stay within a bound. |
| `droppedCount` | Bounded number omitted by that collector-level bound.                       |
| `provenance`   | Source, sampling, and authority contract described below.                   |

A failed or unavailable observation is not converted to zero. Zero is evidence
only where a field is explicitly `observed` and its value is zero.

## Provenance

Each section identifies where its evidence came from:

| Field                 | Contract                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `collectorProcess`    | Always `api`; the API assembles and validates the artifact.                                                                           |
| `sourceProcess`       | `api`, `worker`, `redis_shared`, or `database_shared`.                                                                                |
| `sourceKind`          | `static_configuration`, `effective_configuration`, `aggregate_query`, `direct_worker_probe`, `queue_getters`, or `rolling_aggregate`. |
| `sampledAt`           | When the API collector sampled the source.                                                                                            |
| `dataAsOf`            | Freshness marker supplied for the observation. It is not the time of the oldest event in a rolling window.                            |
| `observationWindow`   | `point_in_time` for this schema. Telemetry's data contains its own named rolling windows.                                             |
| `authoritativeFor`    | Closed list of claims the section may establish.                                                                                      |
| `notAuthoritativeFor` | Related claims the section must not be used to establish.                                                                             |

Source provenance prevents an API-process default or empty value from being
mistaken for worker delivery evidence. In particular, static feature defaults
do not establish current recipient eligibility, queue consumption, or delivery.

## Collector fields

### `config`

This API-authored static configuration DTO includes only environment, Bitcoin
network, and five derived booleans: database configured, Redis configured,
worker-health URL configured, Electrum subscriptions enabled, and Telegram's
feature default enabled. It contains no underlying URL or credential.

`telegramFeatureDefaultEnabled` is a configuration/default fact. It is not a
current delivery gate and does not prove that Telegram recipients are eligible
or that a notification was attempted.

### `notificationEligibility`

This database aggregate reports whether its query was `observed` or
`unavailable`. An observed result uses distinct accessible wallets with at
least one eligible recipient as its unit and buckets each value as `zero`,
`one`, `two_to_five`, `six_to_twenty`, or `over_twenty`.

It includes bucketed counts of Telegram users that are configured and globally
enabled, plus eligible-wallet buckets for received, sent, draft, and
consolidation notifications. `disabledDirectionWallets` reports accessible,
globally enabled and configured wallets whose enabled wallet settings contain no
eligible recipient for that direction. It does not count a wallet as disabled
when another eligible recipient enables the direction.

`enabledUsersWithoutWalletSettings` retains globally enabled users whose wallet
settings object is empty or invalid; these users are not erased by the
per-wallet expansion. Separate buckets report users missing a credential and
orphaned wallet settings. The collector exports no user rows, relationship rows,
credentials, settings objects, or identifiers. These facts describe
configuration eligibility, not provider acceptance.

### `notificationQueue`

This is an API-side, getter-only BullMQ view over shared Redis. It reports queue
pause state and count/oldest-age observations for waiting, active, delayed,
failed, completed, prioritized, and waiting-child states. Counts saturate at
`1,000,000`; age values use fixed buckets from `none` through
`gte_twenty_four_hours`.

Every field is independently `observed(value)`, `unavailable`, `timeout`, or
`unsupported`. The snapshot is marked `approximate_non_atomic`: queue state can
change between getter calls, so consumers must not infer causality or require
arithmetic equality among state totals. The reader opens no worker, scheduler,
event consumer, or job-mutation interface.

BullMQ retention is applied by producers when jobs are enqueued. Removed or
evicted completed/failed jobs cannot appear in counts or oldest-age results.
Version `2.0.0` exports retention contract version `1`: transaction, draft, and
consolidation families retain at most 500 completed and 250 failed jobs, while
webhook notification jobs use immediate removal for both outcomes. Per-family
retained age is `unsupported`, because BullMQ has no bounded name-filtered
oldest-job getter. `producerCompatibility` is `unknown`; the queue reader cannot
discover all API producer versions. Therefore absence remains inconclusive and
`at_retention_cap` or proven eviction must not be inferred from this section.

### `notificationDeadLetters`

This Redis-backed schema-v1 aggregate records best-effort exhausted-notification
callbacks without exporting the operational dead-letter entries. Records are
grouped only by allowlisted job family, safe failure class, attempts bucket, and
coarse last-seen age. Each count saturates at `1,000,000`; at most 128 dimension
records are returned with a bucketed indication of rejected or omitted
dimensions.

The derived window covers seven days of hourly buckets; backing keys expire
after eight days so boundary reads remain available. Retry, claim, removal, or
deletion of the underlying job does not remove the historical aggregate before
expiry. Duplicate failure callbacks may increment more than once, and crashes
or write failures may omit increments. Readable results therefore always have
`degraded` coverage; `unavailable` or `timeout` returns empty records with
`unavailable` coverage, not evidence of zero exhausted notifications.

### `notificationWorker`

This is a direct, authenticated protocol-v1 worker sample. An observed result
contains only bounded operational facts: ready/degraded state, uptime and
concurrency buckets, notification consumer and handler registration, Redis and
database state, Electrum manager/connectivity/subscription ownership and address
count bucket, Telegram circuit state with bucketed request/failure counts,
last-success and last-failure ages, a fixed failure class, and the worker's local
notification-telemetry writer circuit plus bucketed dropped-event state.

Database state is `connected`, `disconnected`, or `unknown`. `unknown` means the
worker could not provide local monitoring evidence; it must not be interpreted
as connected. The worker telemetry-writer observation is likewise
`unavailable` when local evidence is missing.

`unavailable`, `timeout`, and `unsupported` are distinct. A ready probe alone
does not prove that a transaction was detected or a notification was delivered.
This protocol contains no process ID, hostname, provider text, or endpoint.

### `notificationWorkerFleet`

This Redis-shared heartbeat aggregate complements the direct worker sample. A
worker writes heartbeat protocol version `1` every 10 seconds with a 35-second
TTL. The reader is bounded to 32 active registry members and exports only a
worker-count bucket, oldest-heartbeat age bucket, a coarse restart indicator,
aggregate consumer and transaction-handler capability, aggregate telemetry
writer circuit/drop state, aggregate Telegram circuit and transport freshness,
fixed Telegram failure class, coverage, and retention-contract compatibility.
Replica IDs and boot epochs remain internal.

`retentionContract` is `uniform` only when the bounded heartbeat view is
complete and every observed worker reports the current retention contract
version. Differing versions report `mixed_version`; incomplete coverage reports
`unknown`. Partial, stale, malformed, or overflowed registry observations, and
heartbeats from replicas without stable configured identities, force capability,
writer-health, Telegram circuit/freshness/failure fields to `mixed_or_unknown`
and retention compatibility to `unknown`. A detected stable-ID collision also
degrades the fleet rather than merging two replicas into authoritative evidence.
A restart or collision marker can remain visible for up to 24 hours. No current
record or a read failure is `unavailable`/`timeout`, represented by the minimal
`{ version, observation, coverage }` variant; those states do not establish a
zero-worker deployment.

Every simultaneously running worker replica must have its own non-empty,
stable `WORKER_REPLICA_ID`. Reusing one value across replicas causes heartbeat
key collisions; omitting it creates an unstable process-local identity and
therefore degraded, non-authoritative fleet coverage.

### `notificationTelemetry`

Telemetry schema version `1` contains derived `fiveMinutes`, `oneHour`, and
`twentyFourHours` windows. Each record has closed dimensions only:

- family: `transaction`;
- stage: one of the lifecycle stages in the counting table below;
- source process: `api` or `worker`;
- execution path: `queued` or `inline`;
- channel: `none`, `telegram`, `push`, or `other`;
- categorical outcome and safe failure class; and
- bounded `count` with a `saturated` marker.

Each window contains at most 256 dimension records. `truncated` and
`droppedDimensionBucket` describe valid dimensions omitted by that response
bound. They are not recipient or event counts. Telemetry writes are best effort;
the current reader therefore reports `degraded` coverage for readable windows
and `unavailable` coverage when Redis cannot be read. A zero record under
degraded coverage is not evidence that no event occurred.

Each window also reports `sources.api` and `sources.worker`. For each source,
`attendance` is `none`, `partial`, or `full` across the fixed Redis time buckets;
`observedBuckets` and `attestedEmitterCount` are coarse count buckets; and oldest
and newest observations use fixed age categories. Cardinality is an attested
emitter count, not a replica inventory or proof that every expected process was
present. An unreadable telemetry window returns unavailable source observations.

`localWriter` reports only the API process writer used while generating the
package: whether its local circuit is open or closed and a bucketed count of
dropped events. It does not describe worker writer health. If the API writer was
not initialized, the local observation is `unavailable`.

## Telemetry counting table

| Stage                       | Increment unit                                                      | Expected dimensions                                                    | Important qualification                                                                                               |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `enqueue_resolved`          | One resolved transaction `Queue.add` call                           | API, queued, channel `none`, outcome `none`                            | BullMQ stable-ID reuse/deduplication is not distinguished, so this is not an authoritative unique-job count.          |
| `enqueue_failed`            | One failed transaction enqueue call                                 | API, queued, channel `none`, outcome `none`, queue/Redis failure class | A subsequent inline fallback is counted separately.                                                                   |
| `handler_started`           | One worker handler attempt                                          | Worker, queued, channel `none`, outcome `none`                         | Retries increment again.                                                                                              |
| `transport_attempted`       | One categorical result from an enabled transaction channel dispatch | Source process for the path, channel set, categorical outcome          | A disabled channel that is skipped does not produce this stage. It does not count recipients or provider requests.    |
| `transport_accepted`        | One attempted-channel result categorized `accepted` or `partial`    | Same dimensions as its `transport_attempted` record                    | Provider acknowledgement certainty is categorical; this does not assert exactly-once user receipt.                    |
| `inline_fallback_attempted` | One inline fallback batch                                           | API, inline, channel `none`, outcome `none`                            | The batch may contain multiple transactions; it is not a transaction count.                                           |
| `inline_terminal_outcome`   | One categorical result for that fallback batch                      | API, inline, channel `none`, final aggregate outcome                   | Exceptions are recorded as `ambiguous`/`internal`; no provider error text is stored.                                  |
| `attempt_failed`            | One BullMQ failed event for a transaction job attempt               | Worker, queued, channel `none`, safe saved outcome/failure             | Retry attempts can produce multiple records for one logical job. Missing safe progress maps to `ambiguous`/`unknown`. |
| `terminal_completed`        | One completed transaction job event                                 | Worker, queued, channel `none`, strict retained result                 | Stable-ID reuse and upstream retries mean this must not be reconciled one-to-one with enqueue calls.                  |
| `terminal_failure`          | One exhausted transaction job event                                 | Worker, queued, channel `none`, safe saved outcome/failure             | Also has an `attempt_failed` increment for the exhausted attempt.                                                     |

Redis server time assigns fixed minute and hour buckets. One atomic script
increments both base resolutions. Minute keys expire after 3,900 seconds and
hour keys after 93,600 seconds, allowing the 5-minute, 1-hour, and 24-hour
readers to cross bucket boundaries. Counts saturate at `1,000,000` when
exported. Writes use an isolated client, a 100 ms command budget, no offline
queue or retries, and a 30-second local circuit cooldown; telemetry failure must
not delay delivery.

These counters are intentionally not exactly-once. Process crashes, Redis
outages, retry/deduplication behavior, partial channel results, and clock-window
boundaries can create gaps or prevent one-to-one reconciliation. No selector,
transaction ID, job ID, or per-job idempotency ledger is used as a metric label.

## Version compatibility and rollout

| Deployment state                                                     | Safe interpretation                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API and worker both support package v2 / worker protocol v1          | Current aggregate configuration, queue, direct-worker, fleet, DLQ, and degraded rolling telemetry evidence is available according to each section's status and provenance.                           |
| New API with an old worker returning 404/426 or an incompatible body | `notificationWorker.status` is `unsupported`. The API does not fall back to raw worker metrics. Old workers do not publish v1 heartbeats or telemetry, so fleet/telemetry evidence is incomplete.      |
| New worker with an old API                                           | The old API cannot export the v2 contract. Versioned heartbeat, DLQ, and telemetry data may accumulate until TTL expiry, but no old support package becomes safe because of it.                       |
| Diagnostic credential or service path mismatch                       | Direct worker evidence is `unavailable`; shared heartbeat evidence may still be present, but neither state proves delivery.                                                                            |
| Mixed worker retention versions                                      | `notificationWorkerFleet.retentionContract` is `mixed_version`; do not assume the current per-family policy describes every retained job.                                                             |
| Missing/stale worker heartbeat or more than 32 visible members       | Fleet coverage is degraded or unavailable and retention compatibility is `unknown`; zero or uniform operation must not be inferred.                                                                   |
| Worker restart during an activity window                             | The fleet restart indicator provides coarse evidence, while rolling delivery telemetry remains degraded and cannot be assigned to an individual event.                                               |

Packages produced by Sanctuary `0.8.56` used a legacy export boundary that could
include credential-bearing configuration and non-authoritative API-local state.
Do not share those files. Restrict or destroy existing files under the operator's
evidence policy and rotate credentials if a file crossed the trusted boundary.

A `0.8.56` notification incident requires an approved privacy-safe backport or an
upgrade before worker-authored evidence is available. New telemetry is not
backfilled and cannot reconstruct an already-evicted historical job or prove why
a past notification did not arrive. Aggregate correlation can guide triage, but
it does not prove causality for a particular transaction.

## API behavior

`POST /api/v1/admin/support-package` requires administrator authentication and
the exact JSON body:

```json
{ "confirmShareableAggregate": true }
```

The server returns canonical JSON as an attachment on success. A deployment-wide
concurrent generation returns `429 support_package_generation_in_progress`.
Failure to acquire the coordination store, collect, validate, serialize, or pass
the final privacy check returns the fixed `503 support_package_unavailable`
response without echoing rejected data. Successful downloads include
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

The worker's legacy `GET /metrics` and `GET /metrics/prometheus` endpoints remain
unauthenticated on the internal-only worker listener for monitoring
compatibility. Operators must not publish that listener or either route to an
external network. The privacy-safe worker diagnostics endpoint used by the
support-package collector is separate and requires the dedicated API-to-worker
HMAC credential.
