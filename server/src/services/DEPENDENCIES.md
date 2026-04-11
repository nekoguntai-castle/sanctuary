# Service Dependency Graph

This document describes the dependencies between services in the Sanctuary backend.
Understanding these dependencies is crucial for:
- Safe refactoring
- Correct startup ordering
- Identifying potential cascade failures
- Planning graceful degradation

## Dependency Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              STARTUP PHASE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐        │
│   │   Database   │ ──▶ │  Migrations  │ ──▶ │ Token Revocation │        │
│   │   (Prisma)   │     │   Service    │     │    Service       │        │
│   └──────────────┘     └──────────────┘     └──────────────────┘        │
│          │                                           │                   │
│          ▼                                           ▼                   │
│   ┌──────────────┐                          ┌──────────────────┐        │
│   │   Config     │                          │    Auth/JWT      │        │
│   │   (getConfig)│                          │    Utilities     │        │
│   └──────────────┘                          └──────────────────┘        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKGROUND SERVICES                             │
│                    (Managed by StartupManager)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │                     Electrum Pool                             │      │
│   │  ┌────────────────┐    ┌────────────────┐                    │      │
│   │  │ Circuit Breaker│◀──▶│  Connection    │                    │      │
│   │  └────────────────┘    │  Management    │                    │      │
│   │                        └────────────────┘                    │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                          │                                               │
│                          ▼                                               │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │                    Sync Service (non-critical)                │      │
│   │  ┌────────────────┐    ┌────────────────┐                    │      │
│   │  │ Electrum Pool  │◀───│  Wallet Sync   │                    │      │
│   │  │   (required)   │    │    Logic       │                    │      │
│   │  └────────────────┘    └────────────────┘                    │      │
│   │         │                      │                              │      │
│   │         ▼                      ▼                              │      │
│   │  ┌────────────────┐    ┌────────────────┐                    │      │
│   │  │ Recovery Policy│    │   WebSocket    │                    │      │
│   │  │   (retries)    │    │  Broadcasts    │                    │      │
│   │  └────────────────┘    └────────────────┘                    │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │               Notification Service (non-critical)            │      │
│   │  ┌────────────────┐    ┌────────────────┐                    │      │
│   │  │ Electrum Pool  │◀───│ Block Monitor  │                    │      │
│   │  │   (optional)   │    │   (optional)   │                    │      │
│   │  └────────────────┘    └────────────────┘                    │      │
│   │         │                                                     │      │
│   │         ▼                                                     │      │
│   │  ┌────────────────┐                                          │      │
│   │  │   WebSocket    │                                          │      │
│   │  │   Server       │                                          │      │
│   │  └────────────────┘                                          │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │               Maintenance Service (non-critical)             │      │
│   │  ┌────────────────┐    ┌────────────────┐                    │      │
│   │  │   Database     │◀───│ Cleanup Tasks  │                    │      │
│   │  │   (required)   │    │   (scheduled)  │                    │      │
│   │  └────────────────┘    └────────────────┘                    │      │
│   └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Service Criticality

| Service | Critical | Impact if Failed | Degradation Behavior |
|---------|----------|-----------------|---------------------|
| Database (Prisma) | ✅ Yes | Total failure | Server won't start |
| Config | ✅ Yes | Total failure | Server won't start |
| JWT/Auth | ✅ Yes | No auth | All protected endpoints fail |
| Token Revocation | ⚠️ Medium | Security risk | Revoked tokens remain valid |
| Electrum Pool | ⚠️ Medium | No blockchain | Wallet sync, tx broadcast fail |
| Sync Service | ❌ No | Stale balances | Balances not auto-updated |
| Notification Service | ❌ No | No real-time | Users must refresh manually |
| Maintenance Service | ❌ No | Disk fills up | Old data accumulates |

## Startup Order

The `StartupManager` handles background service startup with proper ordering:

```typescript
// From index.ts
const backgroundServices: ServiceDefinition[] = [
  {
    name: 'notifications',
    critical: false,        // Continues if fails
    maxRetries: 2,
    backoffMs: [1000, 3000],
  },
  {
    name: 'sync',
    critical: false,
    maxRetries: 3,
    backoffMs: [2000, 5000, 10000],
  },
  {
    name: 'maintenance',
    critical: false,
    maxRetries: 2,
    backoffMs: [1000, 2000],
  },
];
```

### Startup Sequence

1. **Database Connection** (blocking)
   - `connectWithRetry()` - Retries connection with backoff
   - Health check starts

2. **Token Revocation** (blocking)
   - Initializes in-memory revocation cache
   - Loads any persisted revocations

3. **Migrations** (blocking, may fail gracefully)
   - Runs pending database migrations
   - Continues even if migrations fail

4. **HTTP Server Start** (blocking)
   - Express app begins listening
   - WebSocket servers initialize

5. **Background Services** (parallel, non-blocking)
   - Started via `startAllServices()`
   - Each has retry logic with backoff
   - Failed non-critical services enter degraded mode

## Module Dependencies

### Core Infrastructure

```
src/config/
├── index.ts          ← Entry point, loads all config
├── types.ts          ← TypeScript interfaces
└── features.ts       ← Feature flags

src/models/
└── prisma.ts         ← Database client, connection management
    └── Depends on: config (DATABASE_URL)

src/utils/
├── logger.ts         ← Logging (no dependencies)
├── jwt.ts            ← Token generation/validation
│   └── Depends on: config (JWT_SECRET)
└── encryption.ts     ← Field encryption
    └── Depends on: config (ENCRYPTION_KEY)
```

### Services Layer

```
src/services/
├── startupManager.ts      ← Orchestrates service startup
│   └── Depends on: recoveryPolicy, logger
│
├── syncService.ts         ← Wallet sync orchestration
│   └── Depends on: electrumPool, prisma, websocket, recoveryPolicy
│
├── circuitBreaker.ts      ← Fault tolerance pattern
│   └── Depends on: logger (no external deps)
│
├── recoveryPolicy.ts      ← Retry logic
│   └── Depends on: logger (no external deps)
│
├── maintenanceService.ts  ← Scheduled cleanup
│   └── Depends on: prisma, config
│
└── bitcoin/
    ├── electrumPool.ts    ← Connection pooling
    │   └── Depends on: circuitBreaker, electrum, prisma, config
    │
    ├── electrum.ts        ← Low-level Electrum protocol
    │   └── Depends on: (network only)
    │
    └── blockchain.ts      ← Blockchain operations
        └── Depends on: electrumPool
```

### API Layer

```
src/api/
├── auth.ts           ← Authentication endpoints
│   └── Depends on: prisma, jwt, tokenRevocation
│
├── wallets.ts        ← Wallet management
│   └── Depends on: prisma, syncService, blockchain
│
├── transactions.ts   ← Transaction operations
│   └── Depends on: prisma, blockchain, electrumPool
│
└── bitcoin.ts        ← Blockchain status
    └── Depends on: electrumPool, config
```

### WebSocket Layer

```
src/websocket/
├── server.ts         ← WebSocket server
│   └── Depends on: jwt, wallet (access checks)
│
├── events.ts         ← Typed event definitions
│   └── No dependencies
│
├── broadcast.ts      ← Typed broadcast helpers
│   └── Depends on: server, events
│
└── notifications.ts  ← Notification service
    └── Depends on: server, electrumPool
```

## Circuit Breaker Integration

The Electrum pool uses a circuit breaker to prevent cascade failures:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  API Request    │────▶│  Circuit        │────▶│  Electrum       │
│  (sync/tx)      │     │  Breaker        │     │  Pool           │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  State:         │
                        │  - closed       │ Normal operation
                        │  - open         │ Fast-fail (5 failures)
                        │  - half-open    │ Testing recovery
                        └─────────────────┘
```

## Graceful Degradation

When services fail, the system degrades gracefully:

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Electrum all servers down | No sync/tx | Circuit breaker opens, retries on schedule |
| Database connection lost | API errors | Auto-reconnect with backoff |
| Sync service crash | Stale data | StartupManager retries, WebSocket notifies |
| WebSocket disconnect | No real-time | Client reconnects automatically |

## Adding New Services

To add a new service that integrates properly:

1. **Implement a start/stop boundary** on the service when it owns background work or long-lived resources.
2. **Register** the service in `src/index.ts` with `registerService()` from `src/services/serviceRegistry.ts`.
3. **Declare startup behavior** with `critical`, `maxRetries`, `backoffMs`, and optional `dependsOn`.
4. **Add tests** in `tests/unit/services/serviceRegistry.test.ts` or a focused service test when ordering or shutdown behavior matters.

```typescript
registerService({
  name: 'myService',
  start: () => myService.start(),
  stop: () => myService.stop(),
  critical: false,  // Set to true if server should exit on failure
  maxRetries: 3,
  backoffMs: [1000, 2000, 5000],
  dependsOn: ['sync'],  // Optional: wait for sync first
});
```

## Health Monitoring

Services expose health information:

- **StartupManager**: `getStartupStatus()`, `isSystemDegraded()`
- **Electrum Pool**: `getPoolStats()`, `getCircuitHealth()`
- **Circuit Breaker Registry**: `getHealth()` for all breakers
- **WebSocket**: `getStats()` for connection counts

Use the `/api/v1/health` endpoint to check overall system health.
