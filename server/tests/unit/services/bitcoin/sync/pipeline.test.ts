import { vi } from "vitest";
/**
 * Sync Pipeline Tests
 *
 * Tests for the sync pipeline executor and phase composition.
 */

import { mockPrismaClient, resetPrismaMocks } from "../../../../mocks/prisma";
import {
  mockElectrumClient,
  resetElectrumMocks,
} from "../../../../mocks/electrum";

const { isProxyEnabledMock, getBlockHeightMock } = vi.hoisted(() => ({
  isProxyEnabledMock: vi.fn().mockReturnValue(false),
  getBlockHeightMock: vi.fn().mockResolvedValue(800000),
}));

// Mock Prisma
vi.mock("../../../../../src/models/prisma", () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock node client
vi.mock("../../../../../src/services/bitcoin/nodeClient", () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock("../../../../../src/services/bitcoin/electrumPool", () => ({
  getElectrumPool: vi.fn(() => ({
    isProxyEnabled: isProxyEnabledMock,
  })),
}));

vi.mock("../../../../../src/services/bitcoin/utils/blockHeight", () => ({
  getBlockHeight: getBlockHeightMock,
}));

vi.mock("../../../../../src/services/wallet/canonicalAddressValidation", () => ({
  assertCanonicalAddressesMatchWallet: vi.fn(),
}));

// Mock notifications
vi.mock("../../../../../src/websocket/notifications", () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

import {
  executeSyncPipeline,
  createPhase,
  createSyncContext,
  createTestContext,
  createSyncStats,
  defaultSyncPhases,
  quickSyncPhases,
  type SyncContext,
  type SyncPhase,
} from "../../../../../src/services/bitcoin/sync";
import { createSyncPhaseProgress } from '../../../../../src/services/bitcoin/sync/phaseProgress';
import { SyncRemoteStageBudgetError } from '../../../../../src/services/bitcoin/sync/attemptRuntime';
import { getNodeClient } from "../../../../../src/services/bitcoin/nodeClient";
import { walletLog } from "../../../../../src/websocket/notifications";

describe("Sync Pipeline", () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    isProxyEnabledMock.mockReset();
    isProxyEnabledMock.mockReturnValue(false);
    getBlockHeightMock.mockReset();
    getBlockHeightMock.mockResolvedValue(800000);
  });

  describe("createSyncStats", () => {
    it("should create stats with all counters at zero", () => {
      const stats = createSyncStats();

      expect(stats.historiesFetched).toBe(0);
      expect(stats.transactionsProcessed).toBe(0);
      expect(stats.newTransactionsCreated).toBe(0);
      expect(stats.utxosFetched).toBe(0);
      expect(stats.utxosCreated).toBe(0);
      expect(stats.utxosMarkedSpent).toBe(0);
      expect(stats.addressesUpdated).toBe(0);
      expect(stats.newAddressesGenerated).toBe(0);
      expect(stats.correctedConsolidations).toBe(0);
    });
  });

  describe("createTestContext", () => {
    it("should create context with default values", () => {
      const ctx = createTestContext({});

      expect(ctx.walletId).toBe("test-wallet-id");
      expect(ctx.network).toBe("mainnet");
      expect(ctx.addresses).toEqual([]);
      expect(ctx.historyResults).toBeInstanceOf(Map);
      expect(ctx.txDetailsCache).toBeInstanceOf(Map);
      expect(ctx.allUtxoKeys).toBeInstanceOf(Set);
    });

    it("should allow overriding default values", () => {
      const ctx = createTestContext({
        walletId: "custom-wallet-id",
        network: "testnet3",
        currentBlockHeight: 900000,
      });

      expect(ctx.walletId).toBe("custom-wallet-id");
      expect(ctx.network).toBe("testnet3");
      expect(ctx.currentBlockHeight).toBe(900000);
    });
  });

  describe("createPhase", () => {
    it("should create a phase with name and execute function", () => {
      const execute = vi.fn().mockImplementation((ctx) => Promise.resolve(ctx));
      const phase = createPhase("testPhase", execute);

      expect(phase.name).toBe("testPhase");
      expect(phase.execute).toBe(execute);
    });
  });

  describe('execution stage mapping', () => {
    const expected = {
      rbfCleanup: 'transaction_reconciliation',
      fetchHistories: 'address_history',
      checkExisting: 'transaction_reconciliation',
      processTransactions: 'transaction_reconciliation',
      fetchUtxos: 'utxo_reconciliation',
      reconcileUtxos: 'utxo_reconciliation',
      insertUtxos: 'utxo_reconciliation',
      updateAddresses: 'address_maintenance',
      receiveEvidenceGate: 'address_maintenance',
      gapLimit: 'address_maintenance',
      fixConsolidations: 'address_maintenance',
    } as const;

    it.each([
      ['default', defaultSyncPhases],
      ['quick', quickSyncPhases],
    ] as const)('maps every %s pipeline phase to a closed execution stage', (_name, phases) => {
      expect(Object.fromEntries(phases.map(phase => [phase.name, phase.executionStage])))
        .toEqual(Object.fromEntries(
          Object.entries(expected).filter(([name]) => phases.some(phase => phase.name === name)),
        ));
      expect(phases.every(phase => phase.executionStage !== undefined)).toBe(true);
    });
  });

  describe("executeSyncPipeline", () => {
    const walletId = "test-wallet-id";

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: "testnet3",
        descriptor: "wpkh([12345678/84'/1'/0']tpub...)",
      });

      // Default to having at least one address so phases execute
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: "addr-1",
          address: "tb1qtest",
          derivationPath: "m/84'/1'/0'/0/0",
        },
      ]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800000);
    });

    it("rejects a pre-aborted execution before loading the wallet", async () => {
      const controller = new AbortController();
      controller.abort(new Error("sync cancelled before start"));

      await expect(executeSyncPipeline(walletId, [], {
        signal: controller.signal,
      })).rejects.toThrow("sync cancelled before start");
      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it("does not start the next phase when cancellation arrives during a phase", async () => {
      const controller = new AbortController();
      let phaseStarted!: () => void;
      let finishPhase!: () => void;
      const phaseStartedPromise = new Promise<void>((resolve) => {
        phaseStarted = resolve;
      });
      const finishPhasePromise = new Promise<void>((resolve) => {
        finishPhase = resolve;
      });
      const secondPhase = vi.fn(async (ctx: SyncContext) => ctx);
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
      const phases: SyncPhase[] = [
        createPhase("in-flight-phase", async (ctx) => {
          phaseStarted();
          await finishPhasePromise;
          return ctx;
        }, 'address_history'),
        createPhase("must-not-run", secondPhase),
      ];

      const execution = executeSyncPipeline(walletId, phases, {
        signal: controller.signal,
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      });
      await phaseStartedPromise;
      controller.abort(new Error("sync cancelled mid-phase"));
      finishPhase();

      await expect(execution).rejects.toMatchObject({
        name: "SyncPipelineError",
        failedPhase: "in-flight-phase",
        cause: expect.objectContaining({ message: "sync cancelled mid-phase" }),
      });
      expect(secondPhase).not.toHaveBeenCalled();
      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'address_history',
        'aborted',
        expect.any(Number),
      );
      expect(vi.mocked(walletLog).mock.calls.map(call => call[4])).toContainEqual(
        expect.objectContaining({
          kind: 'sync_phase_progress',
          event: 'stage_aborted',
          stage: 'address_history',
        }),
      );
    });

    it("should execute all phases in order", async () => {
      const executionOrder: string[] = [];

      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => {
          executionOrder.push("phase1");
          return ctx;
        }),
        createPhase("phase2", async (ctx) => {
          executionOrder.push("phase2");
          return ctx;
        }),
        createPhase("phase3", async (ctx) => {
          executionOrder.push("phase3");
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases);

      expect(executionOrder).toEqual(["phase1", "phase2", "phase3"]);
    });

    it('emits only genuine grouped stage transitions in execution order', async () => {
      const stageOrder: string[] = [];
      const telemetry = {
        beginStage: vi.fn((stage: string) => {
          stageOrder.push(`start:${stage}`);
          return true;
        }),
        finishStage: vi.fn((stage: string) => {
          stageOrder.push(`finish:${stage}`);
          return true;
        }),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const controller = new AbortController();
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry as never);
      const pass = async (ctx: SyncContext) => ctx;

      await executeSyncPipeline(walletId, [
        createPhase('setup', pass, 'transaction_reconciliation'),
        createPhase('tail', pass, 'transaction_reconciliation'),
        createPhase('history', pass, 'address_history'),
      ], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry: telemetry as never,
          phaseProgress,
        },
      });

      expect(stageOrder).toEqual([
        'start:initial_network',
        'finish:initial_network',
        'start:transaction_reconciliation',
        'finish:transaction_reconciliation',
        'start:address_history',
        'finish:address_history',
      ]);
    });

    it('marks address history active before awaiting the phase body', async () => {
      let settle!: () => void;
      const deferred = new Promise<void>(resolve => { settle = resolve; });
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const controller = new AbortController();
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
      const pending = executeSyncPipeline(walletId, [
        createPhase('deferredHistory', async (ctx) => {
          await deferred;
          return ctx;
        }, 'address_history'),
      ], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      });

      await vi.waitFor(() => expect(telemetry.beginStage)
        .toHaveBeenCalledWith('address_history', expect.any(Number)));
      expect(telemetry.finishStage).not.toHaveBeenCalledWith(
        'address_history',
        expect.anything(),
        expect.anything(),
      );
      settle();
      await pending;
      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'address_history',
        'completed',
        expect.any(Number),
      );
    });

    it("should pass context between phases", async () => {
      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => {
          ctx.stats.historiesFetched = 5;
          return ctx;
        }),
        createPhase("phase2", async (ctx) => {
          expect(ctx.stats.historiesFetched).toBe(5);
          ctx.stats.transactionsProcessed = 10;
          return ctx;
        }),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(result.stats.historiesFetched).toBe(5);
      expect(result.stats.transactionsProcessed).toBe(10);
    });

    it("should track completed phases", async () => {
      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => ctx),
        createPhase("phase2", async (ctx) => ctx),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(result.stats).toBeDefined();
    });

    it("should handle empty phases array", async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);
      const result = await executeSyncPipeline(walletId, []);

      expect(result.addresses).toBe(0);
      expect(result.transactions).toBe(0);
      expect(result.utxos).toBe(0);
    });

    it("should still run phases for descriptor wallets with no stored addresses", async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);
      const phase = vi.fn(async (ctx: SyncContext) => {
        expect(ctx.addresses).toEqual([]);
        ctx.newAddresses = [
          { address: "tb1qderivedreceive", derivationPath: "m/84'/1'/0'/0/0" },
          { address: "tb1qderivedchange", derivationPath: "m/84'/1'/0'/1/0" },
        ];
        ctx.stats.newAddressesGenerated = 2;
        return ctx;
      });

      const result = await executeSyncPipeline(walletId, [
        createPhase("deriveInitialAddresses", phase),
      ]);

      expect(phase).toHaveBeenCalledTimes(1);
      expect(result.addresses).toBe(2);
      expect(result.stats.newAddressesGenerated).toBe(2);
      expect(walletLog).toHaveBeenCalledWith(
        walletId,
        "info",
        "BLOCKCHAIN",
        "No stored addresses found; deriving wallet addresses before scanning",
      );
    });

    it("should throw error when wallet not found", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(executeSyncPipeline("nonexistent", [])).rejects.toThrow();
    });

    it.each([
      { budget: false, outcome: 'failed' as const },
      { budget: true, outcome: 'budget_expired' as const },
    ])('closes an initial-network $outcome with telemetry', async ({ budget, outcome }) => {
      const controller = new AbortController();
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
      if (budget) {
        getBlockHeightMock.mockImplementationOnce(async (_network, options) => {
          options?.signal?.throwIfAborted();
          return 800000;
        });
      } else {
        getBlockHeightMock.mockRejectedValueOnce(new Error('initial network unavailable'));
      }

      await expect(executeSyncPipeline(walletId, [], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: budget ? Date.now() - 1 : Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      })).rejects.toThrow();

      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'initial_network',
        outcome,
        expect.any(Number),
      );
    });

    it('records a cancelled initial-network check as an aborted stage', async () => {
      const controller = new AbortController();
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
      getBlockHeightMock.mockImplementationOnce(async () => {
        controller.abort(new Error('operator cancelled sync'));
        throw controller.signal.reason;
      });

      await expect(executeSyncPipeline(walletId, [], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      })).rejects.toThrow('operator cancelled sync');

      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'initial_network',
        'aborted',
        expect.any(Number),
      );
    });

    it('records an ordinary phase exception as a failed stage', async () => {
      const controller = new AbortController();
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);

      await expect(executeSyncPipeline(walletId, [
        createPhase('failingHistory', async () => {
          throw new Error('history failed');
        }, 'address_history'),
      ], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      })).rejects.toThrow('history failed');

      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'address_history',
        'failed',
        expect.any(Number),
      );
    });

    it.each([
      {
        label: 'budget exhaustion',
        error: new SyncRemoteStageBudgetError('address_history'),
        outcome: 'budget_expired' as const,
        abort: false,
      },
      {
        label: 'operator cancellation',
        error: new Error('operator cancelled phase'),
        outcome: 'aborted' as const,
        abort: true,
      },
    ])('records phase $label as an $outcome stage', async ({ error, outcome, abort }) => {
      const controller = new AbortController();
      const telemetry = {
        beginStage: vi.fn(() => true),
        finishStage: vi.fn(() => true),
        observeProgress: vi.fn(),
        recordCandidates: vi.fn(),
      };
      const phaseProgress = createSyncPhaseProgress(walletId, telemetry);

      await expect(executeSyncPipeline(walletId, [
        createPhase('interruptedHistory', async () => {
          if (abort) controller.abort(error);
          throw error;
        }, 'address_history'),
      ], {
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: Number.POSITIVE_INFINITY,
          telemetry,
          phaseProgress,
        },
      })).rejects.toMatchObject({ cause: error });

      expect(telemetry.finishStage).toHaveBeenCalledWith(
        'address_history',
        outcome,
        expect.any(Number),
      );
    });

    it("should default to mainnet when wallet network is missing", async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: null,
        descriptor: "wpkh([12345678/84'/0'/0']xpub...)",
      });

      await executeSyncPipeline(walletId, []);

      expect(getNodeClient).toHaveBeenCalledWith("mainnet");
    });

    it("logs address chain counts from parsed derivation metadata", async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        {
          id: "addr-1",
          address: "tb1qreceive",
          derivationPath: "m/84'/1'/0'/0/0",
        },
        {
          id: "addr-2",
          address: "tb1qchange",
          derivationPath: "m/84'/1'/0'/1/0",
        },
        { id: "addr-3", address: "tb1qinvalid", derivationPath: "not-a-path" },
      ]);

      await executeSyncPipeline(walletId, []);

      expect(walletLog).toHaveBeenCalledWith(
        walletId,
        "info",
        "BLOCKCHAIN",
        "Scanning 3 addresses",
        {
          receive: 1,
          change: 1,
          unknown: 1,
        },
      );
    });

    it("should log Tor-specific start message when proxy is enabled", async () => {
      isProxyEnabledMock.mockReturnValueOnce(true);

      await executeSyncPipeline(walletId, []);

      expect(walletLog).toHaveBeenCalledWith(
        walletId,
        "info",
        "SYNC",
        "Starting wallet sync via Tor...",
      );
    });

    it("should propagate phase errors with context", async () => {
      const phases: SyncPhase[] = [
        createPhase("successPhase", async (ctx) => ctx),
        createPhase("failingPhase", async () => {
          throw new Error("Phase failed");
        }),
      ];

      await expect(executeSyncPipeline(walletId, phases)).rejects.toMatchObject(
        {
          name: "SyncPipelineError",
          message: expect.stringContaining("Phase failed"),
          failedPhase: "failingPhase",
        },
      );
    });

    it("should wrap non-Error phase failures in an Error cause", async () => {
      const phases: SyncPhase[] = [
        createPhase("stringFailure", async () => {
          throw "string failure";
        }),
      ];

      await expect(executeSyncPipeline(walletId, phases)).rejects.toMatchObject(
        {
          name: "SyncPipelineError",
          failedPhase: "stringFailure",
          cause: expect.objectContaining({
            message: "string failure",
          }),
        },
      );
    });

    it("should call onPhaseComplete callback after each phase", async () => {
      const completedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => ctx),
        createPhase("phase2", async (ctx) => ctx),
      ];

      await executeSyncPipeline(walletId, phases, {
        onPhaseComplete: (phaseName) => {
          completedPhases.push(phaseName);
        },
      });

      expect(completedPhases).toEqual(["phase1", "phase2"]);
    });

    it("should skip phases listed in skipPhases option", async () => {
      const executedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => {
          executedPhases.push("phase1");
          return ctx;
        }),
        createPhase("phase2", async (ctx) => {
          executedPhases.push("phase2");
          return ctx;
        }),
        createPhase("phase3", async (ctx) => {
          executedPhases.push("phase3");
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases, {
        skipPhases: ["phase2"],
      });

      expect(executedPhases).toEqual(["phase1", "phase3"]);
    });

    it("should only run phases listed in onlyPhases option", async () => {
      const executedPhases: string[] = [];

      const phases: SyncPhase[] = [
        createPhase("phase1", async (ctx) => {
          executedPhases.push("phase1");
          return ctx;
        }),
        createPhase("phase2", async (ctx) => {
          executedPhases.push("phase2");
          return ctx;
        }),
        createPhase("phase3", async (ctx) => {
          executedPhases.push("phase3");
          return ctx;
        }),
      ];

      await executeSyncPipeline(walletId, phases, {
        onlyPhases: ["phase1", "phase3"],
      });

      expect(executedPhases).toEqual(["phase1", "phase3"]);
    });

    it("should return result with correct structure", async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: "addr-1", address: "tb1test", derivationPath: "m/84'/1'/0'/0/0" },
      ]);

      const phases: SyncPhase[] = [
        createPhase("countPhase", async (ctx) => {
          ctx.stats.utxosCreated = 5;
          return ctx;
        }),
      ];

      const result = await executeSyncPipeline(walletId, phases);

      expect(typeof result.addresses).toBe("number");
      expect(typeof result.transactions).toBe("number");
      expect(typeof result.utxos).toBe("number");
      expect(typeof result.elapsedMs).toBe("number");
      expect(result.stats).toBeDefined();
      expect(result.stats.utxosCreated).toBe(5);
    });

    it("should measure elapsed time", async () => {
      let now = 5_000;
      const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
      const phases: SyncPhase[] = [
        createPhase("slowPhase", async (ctx) => {
          now += 50;
          return ctx;
        }),
      ];

      try {
        const result = await executeSyncPipeline(walletId, phases);

        expect(result.elapsedMs).toBe(50);
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });
});
