import { describe, expect, it, vi } from 'vitest';

const { mockEncrypt } = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock('../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
}));

import {
  applyAIProviderCredentialUpdates,
  attachAIProviderCredentialState,
  disableAIProviderCredentialsForRestore,
  parseAIProviderCredentialUpdates,
  parseAIProviderCredentials,
  pruneAIProviderCredentials,
} from '../../../src/services/ai/providerCredentials';

const now = new Date('2026-04-26T00:00:00.000Z');

describe('AI provider credential boundary', () => {
  it('parses valid credential maps and rejects malformed secret records to an empty map', () => {
    expect(
      parseAIProviderCredentials({
        'lan-ollama': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:secret',
          configuredAt: now.toISOString(),
        },
      }),
    ).toEqual({
      'lan-ollama': {
        type: 'api-key',
        encryptedApiKey: 'encrypted:secret',
        configuredAt: now.toISOString(),
      },
    });

    expect(
      parseAIProviderCredentials({ 'lan-ollama': { encryptedApiKey: '' } }),
    ).toEqual({});
  });

  it('rejects duplicate write-only credential updates', () => {
    expect(
      parseAIProviderCredentialUpdates([
        { profileId: 'lan-ollama', apiKey: 'secret-a' },
        { profileId: 'lan-ollama', apiKey: 'secret-b' },
      ]),
    ).toBeNull();
  });

  it('encrypts plaintext write-only API keys and attaches redacted credential state', () => {
    const credentials = applyAIProviderCredentialUpdates(
      {},
      [{ profileId: 'lan-ollama', apiKey: 'plain-secret' }],
      ['lan-ollama'],
      now,
    );

    expect(mockEncrypt).toHaveBeenCalledWith('plain-secret');
    expect(credentials).toEqual({
      'lan-ollama': {
        type: 'api-key',
        encryptedApiKey: 'encrypted:plain-secret',
        configuredAt: now.toISOString(),
      },
    });
    expect(
      attachAIProviderCredentialState([{ id: 'lan-ollama' }], credentials),
    ).toEqual([
      {
        id: 'lan-ollama',
        credentialState: {
          type: 'api-key',
          configured: true,
          needsReview: false,
          configuredAt: now.toISOString(),
        },
      },
    ]);
  });

  it('marks disabled credential state as needing review without reporting it configured', () => {
    expect(
      attachAIProviderCredentialState([{ id: 'lan-ollama' }], {
        'lan-ollama': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:disabled',
          disabledReason: 'restored',
        },
      }),
    ).toEqual([
      {
        id: 'lan-ollama',
        credentialState: {
          type: 'api-key',
          configured: false,
          needsReview: true,
          disabledReason: 'restored',
        },
      },
    ]);
  });

  it('preserves encrypted values, clears requested credentials, and prunes removed profiles', () => {
    const credentials = applyAIProviderCredentialUpdates(
      {
        'lan-ollama': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:old',
          configuredAt: now.toISOString(),
        },
        removed: {
          type: 'api-key',
          encryptedApiKey: 'encrypted:removed',
        },
      },
      [{ profileId: 'lan-ollama', clear: true }],
      ['lan-ollama'],
      now,
    );

    expect(credentials).toEqual({});
    expect(
      pruneAIProviderCredentials(
        {
          'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted:old' },
          removed: { type: 'api-key', encryptedApiKey: 'encrypted:removed' },
        },
        ['lan-ollama'],
      ),
    ).toEqual({
      'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted:old' },
    });
  });

  it('rejects malformed update payloads and preserves credentials for no-op updates', () => {
    expect(() =>
      applyAIProviderCredentialUpdates(
        {},
        { profileId: 'lan-ollama' },
        ['lan-ollama'],
        now,
      ),
    ).toThrow('AI provider credential updates must be a valid array');

    expect(
      applyAIProviderCredentialUpdates(
        {
          'lan-ollama': {
            type: 'api-key',
            encryptedApiKey: 'encrypted:old',
            configuredAt: now.toISOString(),
          },
        },
        [{ profileId: 'lan-ollama' }],
        ['lan-ollama'],
        now,
      ),
    ).toEqual({
      'lan-ollama': {
        type: 'api-key',
        encryptedApiKey: 'encrypted:old',
        configuredAt: now.toISOString(),
      },
    });
  });

  it('encrypts encrypted-looking write-only API keys instead of trusting client ciphertext', () => {
    const credentials = applyAIProviderCredentialUpdates(
      {},
      [{ profileId: 'lan-ollama', apiKey: 'encrypted:already' }],
      ['lan-ollama'],
      now,
    );

    expect(mockEncrypt).toHaveBeenCalledWith('encrypted:already');
    expect(credentials['lan-ollama'].encryptedApiKey).toBe('encrypted:encrypted:already');
  });

  it('rejects credential updates for unknown profiles', () => {
    expect(() =>
      applyAIProviderCredentialUpdates(
        {},
        [{ profileId: 'missing', apiKey: 'secret' }],
        ['lan-ollama'],
        now,
      ),
    ).toThrow('AI provider credentials must reference an existing profile');
  });

  it('disables restored credentials without retaining encrypted API keys', () => {
    expect(
      disableAIProviderCredentialsForRestore({
        'lan-ollama': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:secret',
          configuredAt: now.toISOString(),
        },
        'already-reviewed': {
          type: 'api-key',
          configuredAt: now.toISOString(),
          disabledReason: 'restored',
        },
        'missing-configured-at': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:without-date',
        },
      }),
    ).toEqual({
      disabledCount: 2,
      credentials: {
        'lan-ollama': {
          type: 'api-key',
          configuredAt: now.toISOString(),
          disabledReason: 'restored',
        },
        'already-reviewed': {
          type: 'api-key',
          configuredAt: now.toISOString(),
          disabledReason: 'restored',
        },
        'missing-configured-at': {
          type: 'api-key',
          disabledReason: 'restored',
        },
      },
    });
  });
});
