# Sanctuary Server Tests

## Overview

This directory contains the test suite for the Sanctuary Bitcoin wallet server. Tests are organized into unit tests that validate individual components in isolation.

## Test Structure

```
tests/
├── fixtures/           # Test data and fixtures
│   └── bitcoin.ts      # Bitcoin-related test data (addresses, UTXOs, transactions)
├── mocks/              # Mock implementations
│   ├── electrum.ts     # Electrum client mock
│   └── prisma.ts       # Prisma database mock
├── unit/               # Unit tests
│   ├── api/            # API endpoint tests
│   │   └── auth.test.ts
│   ├── middleware/     # Middleware tests
│   │   └── walletAccess.test.ts
│   ├── services/       # Service tests
│   │   ├── auditService.test.ts
│   │   ├── backupService.test.ts
│   │   ├── notifications.test.ts
│   │   ├── price.test.ts
│   │   ├── twoFactorService.test.ts
│   │   └── bitcoin/    # Bitcoin-specific services
│   │       ├── addressDerivation.test.ts
│   │       ├── advancedTx.test.ts
│   │       ├── blockchain.test.ts
│   │       ├── transactionService.test.ts
│   │       └── utils.test.ts
│   └── utils/          # Utility tests
│       ├── encryption.test.ts
│       └── redact.test.ts
├── integration/        # Integration tests (real PostgreSQL database)
│   ├── setup/          # Test infrastructure
│   │   ├── testDatabase.ts   # PostgreSQL test database setup
│   │   ├── testServer.ts     # Express app for supertest
│   │   └── helpers.ts        # Common test helpers (user creation, login)
│   └── flows/          # End-to-end flow tests
│       ├── auth.integration.test.ts    # Authentication flow
│       └── wallet.integration.test.ts  # Wallet lifecycle (create, share, delete)
└── setup.ts            # Global test setup
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (Development)
```bash
npm run test:watch
```

### With Coverage Report
```bash
npm run test:coverage
```

### Fast Tests (Changed Files Only)
```bash
npm run test:fast
```

### Targeted Test Suites

Run only Bitcoin-related tests:
```bash
npm run test:bitcoin
```

Run only security-related tests (auth, encryption, 2FA):
```bash
npm run test:security
```

### CI Mode
```bash
npm run test:ci
```

### Debug Mode
```bash
npm run test:debug
```

### Integration Tests

Integration tests require a running PostgreSQL database. They will automatically skip if no database is available. The repo-root runner starts a disposable PostgreSQL container and applies the defaults from `scripts/integration-test-defaults.sh`.

**Recommended (one command from repo root)**

```bash
npm run test:integration
```

**Option 1: Use the disposable Docker database (recommended)**

Run all integration tests from the repo root:

```bash
npm run test:integration
```

Run focused integration files from the repo root:

```bash
./scripts/run-integration-tests.sh tests/integration/flows/auth.integration.test.ts
```

**Option 2: Run inside Docker**

Run tests inside the backend container (database already accessible):
```bash
docker exec -it sanctuary-backend npm run test:integration
```

**Option 3: Local PostgreSQL**

If you have PostgreSQL running locally, export `DATABASE_URL` or `TEST_DATABASE_URL` in your shell before running the server integration script:

```bash
npm --prefix server run test:integration
```

Integration tests will be skipped in CI unless a test database is configured.

### Available Integration Tests

**Authentication Flow** (`auth.integration.test.ts`)
- User login
- Token verification
- Password change
- Admin user management
- Token refresh

**Wallet Lifecycle** (`wallet.integration.test.ts`)
- Create wallets (single-sig, multi-sig, taproot)
- Get wallet details and list
- Update wallet settings (name, descriptor)
- Add/remove devices from wallets
- Delete wallets
- Share wallets with users (viewer, signer, owner roles)
- Remove user access
- Wallet access permissions (role-based access control)
- Wallet statistics

## Coverage Thresholds

The following coverage thresholds are enforced:

### Global Thresholds
| Metric     | Threshold |
|------------|-----------|
| Branches   | 100%      |
| Functions  | 100%      |
| Lines      | 100%      |
| Statements | 100%      |

Exclusions in `server/vitest.config.ts` are limited to generated code, type-only files, zero-logic compatibility shims, side-effect-only daemon entrypoints, and live-infrastructure producers covered by integration tests. Reachable branches should get focused tests instead of new `v8 ignore` pragmas.

Run the enforced backend coverage gate with:

```bash
npm run test:unit -- --coverage
```

Run the enforced server test typecheck with:

```bash
npm run typecheck:tests
```

`npm run typecheck:tests:full` tracks the broader historical test fixture and DTO drift; use it when cleaning up shared test harnesses.

## Writing Tests

### Mocking Prisma

Use the centralized Prisma mock from `tests/mocks/prisma.ts`:

```typescript
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

beforeEach(() => {
  resetPrismaMocks();
});
```

### Mocking Electrum

Use the centralized Electrum mock from `tests/mocks/electrum.ts`:

```typescript
import { mockElectrumClient, resetElectrumMocks, createMockTransaction } from '../../mocks/electrum';

vi.mock('../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue(mockElectrumClient),
}));

beforeEach(() => {
  resetElectrumMocks();
});
```

### Mocking Repositories

Use the centralized repository mocks from `tests/mocks/repositories.ts`:

```typescript
import {
  mockAuditLogRepository,
  mockSessionRepository,
  mockPushDeviceRepository,
  mockSystemSettingRepository,
  mockDeviceRepository,
  resetRepositoryMocks,
  seedAuditLogs,
  seedSessions,
} from '../../mocks/repositories';

// Mock the repositories module
vi.mock('../../../src/repositories', () => ({
  auditLogRepository: mockAuditLogRepository,
  sessionRepository: mockSessionRepository,
  pushDeviceRepository: mockPushDeviceRepository,
  systemSettingRepository: mockSystemSettingRepository,
  deviceRepository: mockDeviceRepository,
}));

beforeEach(() => {
  resetRepositoryMocks();
});

// Seed test data if needed
beforeEach(() => {
  seedAuditLogs([
    { action: 'auth.login', userId: 'test-user', success: true },
  ]);
});
```

Available repository mocks:
- `mockAuditLogRepository` - Audit log operations (create, findMany, getStats)
- `mockSessionRepository` - Refresh token/session management
- `mockPushDeviceRepository` - Push notification device tokens
- `mockSystemSettingRepository` - System settings key-value store
- `mockDeviceRepository` - Hardware device management

### Test Fixtures

Common test data is available in `tests/fixtures/bitcoin.ts`:

- `testnetAddresses` - Valid testnet addresses for different script types
- `mainnetAddresses` - Valid mainnet addresses
- `sampleUtxos` - Sample UTXO data
- `sampleTransactions` - Sample transaction hex strings (RBF-enabled, P2PKH, etc.)

### Express Request/Response Mocks

For API endpoint tests, create mock request/response objects:

```typescript
const mockReq = {
  user: { id: 'user-id', username: 'testuser', isAdmin: false },
  params: { walletId: 'wallet-id' },
  body: { /* request body */ },
} as unknown as Request;

const mockRes = {
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
} as unknown as Response;
```

## Skipped Tests

Some tests are skipped with `it.skip()` because they require:
- Full integration testing with real database state
- Complex multi-service interactions
- Hardware wallet simulation

These are marked with explanatory comments indicating what's needed for proper testing.

## Pre-commit Hooks

Tests run automatically on commit via Husky:
- `test:fast` runs on changed files before each commit

## CI/CD Integration

Tests run automatically on:
- Push to `main` branch
- Pull requests to `main` branch
- Manual workflow dispatch

Coverage reports are uploaded as artifacts and summarized in PR comments.
