import { beforeEach, describe, expect, it, vi } from 'vitest';

const walletId = '11111111-1111-4111-8111-111111111111';
const otherWalletId = '22222222-2222-4222-8222-222222222222';
const turnId = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => {
  class MockAssistantToolError extends Error {
    statusCode: number;
    code: number;

    constructor(statusCode: number, message: string, code = -32000) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    AssistantToolError: MockAssistantToolError,
    assistantReadToolRegistry: {
      get: vi.fn(),
      execute: vi.fn(),
    },
    consoleRepository: {
      createToolTrace: vi.fn(),
    },
    walletRepository: {
      findByIdWithAccess: vi.fn(),
    },
  };
});

vi.mock('../../../src/assistant/tools', () => ({
  AssistantToolError: mocks.AssistantToolError,
  assistantReadToolRegistry: mocks.assistantReadToolRegistry,
}));

vi.mock('../../../src/repositories', () => ({
  consoleRepository: mocks.consoleRepository,
  walletRepository: mocks.walletRepository,
}));

import {
  assertScopeAccess,
  executePlannedTool,
  traceForSynthesis,
} from '../../../src/assistant/console/toolExecution';

function actor(isAdmin = false) {
  return { userId: 'user-1', username: 'alice', isAdmin };
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    name: 'get_wallet_overview',
    title: 'Wallet overview',
    description: 'Read wallet overview',
    sensitivity: 'wallet',
    requiredScope: {
      kind: 'wallet',
      description: 'wallet scope',
      walletIdInput: 'walletId',
    },
    inputSchema: { walletId: {} },
    budgets: { maxRows: 5, maxBytes: 4096 },
    ...overrides,
  };
}

function trace(input: Record<string, unknown>) {
  return {
    id: 'trace-1',
    turnId,
    toolName: input.toolName,
    status: input.status,
    input: input.input ?? null,
    facts: input.facts ?? null,
    provenance: input.provenance ?? null,
    redactions: input.redactions ?? null,
    truncation: input.truncation ?? null,
    warnings: input.warnings ?? null,
    sensitivity: input.sensitivity ?? null,
    rowCount: input.rowCount ?? null,
    walletCount: input.walletCount ?? null,
    durationMs: input.durationMs ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    createdAt: new Date(),
  };
}

describe('console tool execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.walletRepository.findByIdWithAccess.mockResolvedValue({ id: walletId });
    mocks.consoleRepository.createToolTrace.mockImplementation(async (input: Record<string, unknown>) => trace(input));
    mocks.assistantReadToolRegistry.get.mockReturnValue(definition());
    mocks.assistantReadToolRegistry.execute.mockResolvedValue({
      data: { walletId },
      facts: { summary: 'Wallet overview', items: [] },
      provenance: { sources: [{ type: 'computed', label: 'test' }], computedAt: '2026-04-26T00:00:00.000Z' },
      sensitivity: 'wallet',
      redactions: [],
      truncation: { truncated: false },
      warnings: [],
      audit: {
        operation: 'get_wallet_overview',
        source: 'console',
        sensitivity: 'wallet',
        scope: 'wallet',
        rowCount: 1,
        walletCount: 1,
        durationMs: 12,
      },
    });
  });

  it('validates admin and wallet scope access before tool execution', async () => {
    await expect(assertScopeAccess(actor(false), { kind: 'admin' })).rejects.toMatchObject({ statusCode: 403 });

    mocks.walletRepository.findByIdWithAccess.mockResolvedValueOnce(null);
    await expect(assertScopeAccess(actor(), { kind: 'wallet', walletId })).rejects.toMatchObject({ statusCode: 404 });

    mocks.walletRepository.findByIdWithAccess.mockResolvedValue({ id: walletId });
    await expect(assertScopeAccess(actor(), { kind: 'wallet_set', walletIds: [walletId, otherWalletId] })).resolves.toBeUndefined();
    expect(mocks.walletRepository.findByIdWithAccess).toHaveBeenCalledWith(otherWalletId, 'user-1');
  });

  it('stores denied traces for unknown tools, sensitivity limits, admin requirements, and wallet scope mismatches', async () => {
    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(null);
    await expect(executePlannedTool({
      call: { name: 'missing_tool', input: {} },
      turnId,
      scope: { kind: 'general' },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'denied', errorCode: 'unknown_tool' });

    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'public',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'denied', errorMessage: 'Tool sensitivity wallet exceeds turn limit public' });

    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(definition({
      sensitivity: 'admin',
      requiredScope: { kind: 'admin', description: 'admin scope' },
    }));
    await expect(executePlannedTool({
      call: { name: 'get_admin_operational_summary', input: {} },
      turnId,
      scope: { kind: 'admin' },
      maxSensitivity: 'admin',
      actor: actor(false),
    })).resolves.toMatchObject({ status: 'denied', errorMessage: 'Tool requires admin access' });

    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId: otherWalletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'denied', errorMessage: 'Tool wallet input is outside the selected scope' });

    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(definition({
      requiredScope: { kind: 'wallet', description: 'wallet scope', walletIdInput: 'scopedWalletId' },
    }));
    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'denied', errorMessage: 'Tool wallet input is outside the selected scope' });

    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(definition({
      requiredScope: { kind: 'wallet', description: 'wallet scope', walletIdInput: null },
    }));
    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'completed' });
  });

  it('executes allowed tools with console context and returns compact synthesis traces', async () => {
    mocks.assistantReadToolRegistry.execute.mockImplementation(async (_name: string, _input: unknown, context: any) => {
      await context.authorizeWalletAccess(walletId);
      await expect(context.authorizeWalletAccess(otherWalletId)).rejects.toMatchObject({ statusCode: 403 });
      await context.authorizeAuditAccess();
      return {
        data: { walletId, raw: 'not stored in synthesis' },
        facts: { summary: 'Wallet overview', items: [] },
        provenance: { sources: [{ type: 'computed', label: 'test' }], computedAt: '2026-04-26T00:00:00.000Z' },
        sensitivity: 'wallet',
        redactions: ['device_fingerprints'],
        truncation: { truncated: false },
        warnings: ['bounded'],
        audit: {
          operation: 'get_wallet_overview',
          source: 'console',
          sensitivity: 'wallet',
          scope: 'wallet',
          rowCount: 1,
          walletCount: 1,
          durationMs: 12,
        },
      };
    });

    const storedTrace = await executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(true),
    });

    expect(storedTrace).toMatchObject({
      status: 'completed',
      facts: { summary: 'Wallet overview', items: [] },
      redactions: ['device_fingerprints'],
      rowCount: 1,
      walletCount: 1,
      durationMs: 12,
    });
    expect(traceForSynthesis(storedTrace)).toEqual(expect.objectContaining({
      toolName: 'get_wallet_overview',
      status: 'completed',
      facts: { summary: 'Wallet overview', items: [] },
      warnings: ['bounded'],
    }));
    expect(traceForSynthesis({ ...storedTrace, facts: null, provenance: null, redactions: null, truncation: null, warnings: null, errorMessage: 'denied' })).toEqual({
      toolName: 'get_wallet_overview',
      status: 'completed',
      sensitivity: 'wallet',
      error: 'denied',
    });
    expect(traceForSynthesis({ ...storedTrace, sensitivity: null, errorMessage: null })).toEqual(expect.not.objectContaining({
      sensitivity: expect.anything(),
      error: expect.anything(),
    }));
  });

  it('lets authenticated public tools run without wallet scope', async () => {
    mocks.assistantReadToolRegistry.execute.mockResolvedValueOnce({
      data: {},
      facts: { summary: 'Fees', items: [] },
      provenance: { sources: [], computedAt: '2026-04-26T00:00:00.000Z' },
      sensitivity: 'public',
      redactions: [],
      truncation: { truncated: false },
      warnings: [],
      audit: {
        operation: 'get_fee_estimates',
        source: 'console',
        sensitivity: 'public',
        scope: 'authenticated',
      },
    });
    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(definition({
      name: 'get_fee_estimates',
      sensitivity: 'public',
      requiredScope: { kind: 'authenticated', description: 'signed-in user' },
      inputSchema: {},
    }));

    await expect(executePlannedTool({
      call: { name: 'get_fee_estimates', input: {} },
      turnId,
      scope: { kind: 'general' },
      maxSensitivity: 'public',
      actor: actor(),
    })).resolves.toMatchObject({ status: 'completed' });
    expect(mocks.consoleRepository.createToolTrace).toHaveBeenCalledWith(expect.objectContaining({
      rowCount: null,
      walletCount: null,
      durationMs: null,
    }));
  });

  it('surfaces authorization failures raised from the console tool context', async () => {
    mocks.assistantReadToolRegistry.execute.mockImplementationOnce(async (_name: string, _input: unknown, context: any) => {
      mocks.walletRepository.findByIdWithAccess.mockResolvedValueOnce(null);
      await context.authorizeWalletAccess(walletId);
    });

    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Wallet not found',
    });

    mocks.assistantReadToolRegistry.execute.mockImplementationOnce(async (_name: string, _input: unknown, context: any) => {
      await context.authorizeAuditAccess();
    });
    mocks.assistantReadToolRegistry.get.mockReturnValueOnce(definition({
      name: 'get_fee_estimates',
      sensitivity: 'public',
      requiredScope: { kind: 'authenticated', description: 'signed-in user' },
      inputSchema: {},
    }));

    await expect(executePlannedTool({
      call: { name: 'get_fee_estimates', input: {} },
      turnId,
      scope: { kind: 'general' },
      maxSensitivity: 'public',
      actor: actor(false),
    })).resolves.toMatchObject({
      status: 'denied',
      errorMessage: 'Console audit access requires an admin user',
    });
  });

  it('stores failed and denied traces when registry execution throws', async () => {
    mocks.assistantReadToolRegistry.execute.mockRejectedValueOnce(
      new mocks.AssistantToolError(403, 'scope denied', -32001)
    );
    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({
      status: 'denied',
      errorCode: '-32001',
      errorMessage: 'scope denied',
    });

    mocks.assistantReadToolRegistry.execute.mockRejectedValueOnce(new Error('repository failed'));
    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'tool_failed',
      errorMessage: 'repository failed',
    });

    mocks.assistantReadToolRegistry.execute.mockRejectedValueOnce('string failure');
    await expect(executePlannedTool({
      call: { name: 'get_wallet_overview', input: { walletId } },
      turnId,
      scope: { kind: 'wallet', walletId },
      maxSensitivity: 'wallet',
      actor: actor(),
    })).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Tool execution failed',
    });
  });
});
