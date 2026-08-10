/**
 * Consolidated Test Fixtures Index
 *
 * Central export point for all test fixtures and utilities.
 * Import from this file instead of individual fixture files.
 *
 * @example
 * ```typescript
 * import {
 *   testnetAddresses,
 *   sampleUsers,
 *   createTestUser,
 *   generateTxid,
 *   mockPrismaClient,
 * } from '../fixtures';
 * ```
 */

// ========================================
// BITCOIN FIXTURES
// ========================================
export {
  testnetAddresses,
  mainnetAddresses,
  testXpubs,
  sampleTransactions,
  sampleUtxos,
  sampleWallets,
  multisigKeyInfo,
  sampleUsers,
  feeEstimates,
  derivationPaths,
} from './bitcoin';

// ========================================
// VERIFIED ADDRESS VECTORS
// ========================================
export {
  VERIFIED_SINGLESIG_VECTORS,
  VERIFIED_MULTISIG_VECTORS,
  VERIFIER_PROVENANCE,
  type VerifiedSingleSigVector,
  type VerifiedMultisigVector,
  type AccountKeyEvidence,
  type SingleSigScriptType,
  type MultisigScriptType,
  type ChainEnvironment,
} from './verified-address-vectors';

// ========================================
// BITCOIN CORE KEY_IO VECTORS
// ========================================
export {
  KEY_IO_MAINNET_ADDRESSES,
  KEY_IO_INVALID_ADDRESSES,
  type KeyIoAddressVector,
} from './bitcoin-core-key-io-vectors';

// ========================================
// DATA GENERATORS
// ========================================
// Re-export from repository setup for consistency
export {
  generateId,
  generateTestnetAddress,
  generateTxid,
  generateFingerprint,
} from '../integration/repositories/setup';

// ========================================
// MOCK REQUEST/RESPONSE HELPERS
// ========================================
export {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  generateInvalidSignatureToken,
  generate2FATestToken,
  generateRefreshTestToken,
  wait,
  flushPromises,
  deepClone,
  SeededRandom,
  seededRandom,
  randomHex,
  randomTxid,
  randomAddress,
  satsToBtc,
  btcToSats,
} from '../helpers/testUtils';

// ========================================
// PRISMA MOCKS
// ========================================
export {
  mockPrismaClient,
  prismaMock,
  resetPrismaMocks,
  setupPrismaMockReturns,
} from '../mocks/prisma';

// ========================================
// REPOSITORY MOCKS
// ========================================
export {
  mockAuditLogRepository,
  mockPushDeviceRepository,
  mockSessionRepository,
  mockSystemSettingRepository,
  mockDeviceRepository,
  resetRepositoryMocks,
  seedAuditLogs,
  seedSessions,
} from '../mocks/repositories';

// ========================================
// EXTERNAL SERVICE MOCKS
// ========================================
export {
  mockElectrumClient,
  mockElectrumPool,
  createMockTransaction,
  createMockUTXO,
  createMockAddressHistory,
  resetElectrumMocks,
  resetElectrumPoolMocks,
  setupElectrumMockReturns,
  type MockElectrumTransaction,
  type MockUTXO,
  type MockAddressHistory,
} from '../mocks/electrum';

// ========================================
// INTEGRATION TEST HELPERS
// ========================================
export {
  getTestUser,
  getTestAdmin,
  TEST_USER,
  TEST_ADMIN,
  loginTestUser,
  createAndLoginUser,
  createTestWallet as createTestWalletViaApi,
  authHeader,
} from '../integration/setup/helpers';

// ========================================
// REPOSITORY TEST INFRASTRUCTURE
// ========================================
export {
  // Database connection
  canRunIntegrationTests,
  getTestPrisma,
  disconnectTestDatabase,

  // Transaction rollback
  withTestTransaction,

  // Cleanup
  cleanupTestData,

  // Entity factories
  createTestUser,
  createTestGroup,
  addUserToGroup,
  createTestWallet,
  createTestDevice,
  createTestAddress,
  createTestTransaction,
  createTestUtxo,
  createTestLabel,
  createTestDraft,
  createTestAuditLog,
  createTestSession,
  createTestPushDevice,

  // Jest helpers
  describeIfDatabase,
  setupRepositoryTests,

  // Builder pattern
  TestScenarioBuilder,

  // Test suite hooks
  createTestSuite,

  // Assertion helpers
  assertExists,
  assertNotExists,
  assertCount,

  // Types
  type CreateUserOptions,
  type CreateGroupOptions,
  type CreateWalletOptions,
  type CreateDeviceOptions,
  type CreateAddressOptions,
  type CreateTransactionOptions,
  type CreateUtxoOptions,
  type CreateLabelOptions,
  type CreateDraftOptions,
  type CreateAuditLogOptions,
  type CreateSessionOptions,
  type CreatePushDeviceOptions,
  type TestScenario,
  type TestHookOptions,
} from '../integration/repositories/setup';
