import { expect, it } from 'vitest';
import type { BackupService, SanctuaryBackup } from '../../../../src/services/backupService';
import { mockPrismaClient } from '../../../mocks/prisma';

export function registerRestoreCredentialTests(
  createValidBackup: () => SanctuaryBackup,
  restoreFromBackup: BackupService['restoreFromBackup'],
): void {
  it('should fail closed when a user session version cannot be incremented safely', async () => {
    const backup = createValidBackup();
    backup.data.user[0].sessionVersion = 2_147_483_647;
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot safely invalidate sessions for restored user user-1');
  });

  it('should revoke restored MCP API keys so old bearer tokens fail closed', async () => {
    const backup = createValidBackup();
    backup.data.mcpApiKey = [
      {
        id: 'mcp-key-1',
        userId: 'user-1',
        name: 'LAN client',
        keyHash: 'a'.repeat(64),
        keyPrefix: 'mcp_aaaaaaaaaaa',
        scope: { walletIds: ['wallet-1'] },
        createdAt: new Date().toISOString(),
        revokedAt: null,
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      '1 MCP API key restored revoked. Regenerate MCP client credentials after reviewing external access.',
    );
    expect(capturedData).toHaveLength(1);
    expect(capturedData[0].keyHash).toBe('a'.repeat(64));
    expect(capturedData[0].revokedAt).toBeInstanceOf(Date);
  });

  it('should disable restored AI provider credentials so provider secrets fail closed', async () => {
    const backup = createValidBackup();
    backup.data.systemSetting = [
      {
        id: 'setting-ai-provider-credentials',
        key: 'aiProviderCredentials',
        value: JSON.stringify({
          'lan-ollama': {
            type: 'api-key',
            encryptedApiKey: 'encrypted-provider-secret',
            configuredAt: '2026-04-26T00:00:00.000Z',
          },
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'setting-ai-enabled',
        key: 'aiEnabled',
        value: JSON.stringify(true),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    mockPrismaClient.systemSetting.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    const result = await restoreFromBackup(backup);
    const credentialRecord = capturedData.find((record: any) => record.key === 'aiProviderCredentials');
    const enabledRecord = capturedData.find((record: any) => record.key === 'aiEnabled');
    const restoredCredentials = JSON.parse(credentialRecord.value);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      '1 AI provider credential restored disabled. Re-enter provider credentials in Admin > AI Settings before enabling external model access.',
    );
    expect(restoredCredentials).toEqual({
      'lan-ollama': {
        type: 'api-key',
        configuredAt: '2026-04-26T00:00:00.000Z',
        disabledReason: 'restored',
      },
    });
    expect(credentialRecord.value).not.toContain('encrypted-provider-secret');
    expect(enabledRecord.value).toBe(JSON.stringify(true));
  });

  it('should use plural warning text for multiple restored AI provider credentials', async () => {
    const backup = createValidBackup();
    backup.data.systemSetting = [
      {
        id: 'setting-ai-provider-credentials',
        key: 'aiProviderCredentials',
        value: JSON.stringify({
          'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted-one' },
          'lab-openai': { type: 'api-key', encryptedApiKey: 'encrypted-two' },
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      '2 AI provider credentials restored disabled. Re-enter provider credentials in Admin > AI Settings before enabling external model access.',
    );
  });

  it('should not warn when restored AI provider credentials were already disabled', async () => {
    const backup = createValidBackup();
    backup.data.systemSetting = [
      {
        id: 'setting-ai-provider-credentials',
        key: 'aiProviderCredentials',
        value: JSON.stringify({
          'lan-ollama': {
            type: 'api-key',
            configuredAt: '2026-04-26T00:00:00.000Z',
            disabledReason: 'restored',
          },
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('should keep already revoked MCP API keys revoked without extra warnings', async () => {
    const backup = createValidBackup();
    const revokedAt = '2026-01-02T03:04:05.000Z';
    backup.data.mcpApiKey = [
      {
        id: 'mcp-key-1',
        userId: 'user-1',
        name: 'Old LAN client',
        keyHash: 'b'.repeat(64),
        keyPrefix: 'mcp_bbbbbbbbbbb',
        scope: { walletIds: ['wallet-1'] },
        createdAt: new Date().toISOString(),
        revokedAt,
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 1 };
    });

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(capturedData).toHaveLength(1);
    expect(capturedData[0].revokedAt).toEqual(new Date(revokedAt));
  });

  it('should use plural warning text when multiple restored MCP API keys are revoked', async () => {
    const backup = createValidBackup();
    backup.data.mcpApiKey = [
      {
        id: 'mcp-key-1',
        userId: 'user-1',
        name: 'LAN client',
        keyHash: 'c'.repeat(64),
        keyPrefix: 'mcp_ccccccccccc',
        scope: { walletIds: ['wallet-1'] },
        createdAt: new Date().toISOString(),
        revokedAt: null,
      },
      {
        id: 'mcp-key-2',
        userId: 'user-1',
        name: 'Lab client',
        keyHash: 'd'.repeat(64),
        keyPrefix: 'mcp_ddddddddddd',
        scope: { walletIds: ['wallet-1'] },
        createdAt: new Date().toISOString(),
        revokedAt: null,
      },
    ];

    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));

    let capturedData: any = null;
    Object.keys(mockPrismaClient).forEach((key) => {
      const client = mockPrismaClient as any;
      if (client[key]?.deleteMany) {
        client[key].deleteMany.mockResolvedValue({ count: 0 });
      }
      if (client[key]?.createMany) {
        client[key].createMany.mockResolvedValue({ count: 0 });
      }
    });
    mockPrismaClient.mcpApiKey.createMany.mockImplementation(async ({ data }) => {
      capturedData = data;
      return { count: 2 };
    });

    const result = await restoreFromBackup(backup);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      '2 MCP API keys restored revoked. Regenerate MCP client credentials after reviewing external access.',
    );
    expect(capturedData).toHaveLength(2);
    expect(capturedData[0].revokedAt).toBeInstanceOf(Date);
    expect(capturedData[1].revokedAt).toBe(capturedData[0].revokedAt);
  });
}
