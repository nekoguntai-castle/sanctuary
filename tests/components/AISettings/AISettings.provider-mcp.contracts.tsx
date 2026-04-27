import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AISettings from '../../../components/AISettings';
import {
  enabledSettings,
  mockCreateMcpApiKey,
  mockGetSystemSettings,
  mockGetUsers,
  mockListMcpApiKeys,
  mockRevokeMcpApiKey,
  mockUpdateSystemSettings,
} from './AISettingsTestHarness';

function getTabButton(name: string) {
  const tabSpan = screen
    .getAllByText(name)
    .find((element) => element.classList.contains('hidden'));
  return tabSpan?.closest('button');
}

async function navigateToTab(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  readyText: string,
) {
  await waitFor(() => {
    expect(screen.getByText('AI Settings')).toBeInTheDocument();
  });
  const tab = getTabButton(name);
  expect(tab).not.toBeNull();
  await user.click(tab!);
  await waitFor(() => {
    expect(screen.getByText(readyText)).toBeInTheDocument();
  });
}

export function registerAISettingsProviderMcpContracts() {
  describe('Provider and MCP settings', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    it('saves typed provider profile changes and credential updates', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToTab(user, 'Settings', 'Provider Profile');
      await user.click(screen.getByRole('button', { name: /add/i }));
      expect(screen.getByLabelText('Profile Name')).toHaveValue('New provider');
      await user.selectOptions(
        screen.getByLabelText('Provider Profile'),
        'default-ollama',
      );
      await user.clear(screen.getByLabelText('Profile Name'));
      await user.type(screen.getByLabelText('Profile Name'), 'LAN OpenAI');
      await user.selectOptions(
        screen.getByLabelText('Provider Type'),
        'openai-compatible',
      );
      await user.clear(screen.getByLabelText('AI Endpoint URL'));
      await user.type(
        screen.getByLabelText('AI Endpoint URL'),
        'http://llm.local:11434/v1',
      );
      await user.type(
        screen.getByLabelText('Provider Credential'),
        'secret-key',
      );
      await user.click(screen.getByLabelText('Tool calls'));
      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(mockUpdateSystemSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            aiEndpoint: 'http://llm.local:11434/v1',
            aiModel: 'llama3.2:3b',
            aiProviderCredentialUpdates: [
              {
                profileId: 'default-ollama',
                type: 'api-key',
                apiKey: 'secret-key',
                clear: false,
              },
            ],
            aiProviderProfiles: expect.arrayContaining([
              expect.objectContaining({
                id: 'default-ollama',
                name: 'LAN OpenAI',
                providerType: 'openai-compatible',
                endpoint: 'http://llm.local:11434/v1',
                capabilities: expect.objectContaining({ toolCalls: true }),
              }),
            ]),
          }),
        );
      });
    });

    it('saves a local OpenAI-compatible provider without a credential', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiEndpoint: 'http://lmstudio.local:1234/v1',
        aiModel: '',
        aiProviderProfiles: [
          {
            id: 'lm-studio',
            name: 'LM Studio',
            providerType: 'openai-compatible',
            endpoint: 'http://lmstudio.local:1234/v1',
            model: '',
            capabilities: { chat: true, toolCalls: true, strictJson: true },
            credentialState: {
              type: 'none',
              configured: false,
              needsReview: false,
            },
          },
        ],
        aiActiveProviderProfileId: 'lm-studio',
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToTab(user, 'Settings', 'Provider Profile');
      await user.type(screen.getByLabelText('Model'), 'local-lm-studio-model');
      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        const payload = mockUpdateSystemSettings.mock.calls.at(-1)?.[0];
        expect(payload).toMatchObject({
          aiEndpoint: 'http://lmstudio.local:1234/v1',
          aiModel: 'local-lm-studio-model',
          aiActiveProviderProfileId: 'lm-studio',
        });
        expect(payload).not.toHaveProperty('aiProviderCredentialUpdates');
      });
    });

    it('falls back to a no-credential label when the active profile is not in the editable list', async () => {
      mockGetSystemSettings.mockResolvedValue({
        ...enabledSettings,
        aiProviderProfiles: enabledSettings.aiProviderProfiles,
        aiActiveProviderProfileId: 'remote-openai',
        aiActiveProviderProfile: {
          id: 'remote-openai',
          name: 'Remote OpenAI',
          providerType: 'openai-compatible',
          endpoint: 'http://remote:11434/v1',
          model: 'remote-model',
          capabilities: { chat: true, toolCalls: true, strictJson: true },
          credentialState: {
            type: 'api-key',
            configured: true,
            needsReview: false,
          },
        },
      });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToTab(user, 'Settings', 'Provider Profile');

      expect(screen.getByText('No credential')).toBeInTheDocument();
    });

    it('creates and revokes MCP keys from the MCP Access tab', async () => {
      mockGetUsers.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          email: null,
          emailVerified: true,
          isAdmin: false,
          createdAt: '2026-04-26T00:00:00.000Z',
        },
        {
          id: 'user-2',
          username: 'bob',
          email: null,
          emailVerified: true,
          isAdmin: false,
          createdAt: '2026-04-26T00:00:00.000Z',
        },
      ]);
      mockListMcpApiKeys.mockResolvedValue([
        {
          id: 'key-1',
          userId: 'user-1',
          user: { id: 'user-1', username: 'alice', isAdmin: false },
          name: 'Existing',
          keyPrefix: 'mcp_existing',
          scope: { walletIds: ['wallet-existing'], allowAuditLogs: false },
          createdAt: '2026-04-26T00:00:00.000Z',
          lastUsedAt: '2026-04-26T12:00:00.000Z',
        },
      ]);
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToTab(user, 'MCP Access', 'MCP Server');
      await user.selectOptions(screen.getByLabelText('Target User'), 'user-2');
      await user.type(screen.getByLabelText('Key Name'), 'LAN model');
      await user.type(
        screen.getByLabelText('Wallet Scope'),
        'wallet-1 wallet-1 wallet-2',
      );
      await user.type(screen.getByLabelText('Expires At'), '2026-05-01T12:30');
      await user.click(screen.getByLabelText('Allow audit log reads'));
      await user.click(screen.getByRole('button', { name: /create mcp key/i }));

      await waitFor(() => {
        expect(mockCreateMcpApiKey).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-2',
            name: 'LAN model',
            walletIds: ['wallet-1', 'wallet-2'],
            allowAuditLogs: true,
          }),
        );
      });
      expect(screen.getByText('New MCP key created')).toBeInTheDocument();
      expect(
        screen.getByText(/mcp_test_token_visible_once/),
      ).toBeInTheDocument();

      await user.click(screen.getAllByRole('button', { name: /revoke/i })[0]);
      await waitFor(() => {
        expect(mockRevokeMcpApiKey).toHaveBeenCalledWith('created-key-1');
      });
    });
  });
}
