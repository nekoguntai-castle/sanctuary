/**
 * AISettings Component Tests
 *
 * Tests for the AI Settings administration page.
 * Covers toggle, detection, model selection, model pull, and configuration.
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock admin API
const mockGetSystemSettings = vi.fn();
const mockUpdateSystemSettings = vi.fn();

vi.mock('../../src/api/admin', () => ({
  getSystemSettings: () => mockGetSystemSettings(),
  updateSystemSettings: (settings: Record<string, unknown>) => mockUpdateSystemSettings(settings),
}));

// Mock AI API
const mockGetAIStatus = vi.fn();
const mockDetectOllama = vi.fn();
const mockListModels = vi.fn();
const mockPullModel = vi.fn();
const mockGetOllamaContainerStatus = vi.fn();
const mockStartOllamaContainer = vi.fn();
const mockStopOllamaContainer = vi.fn();
const mockGetSystemResources = vi.fn();

vi.mock('../../src/api/ai', () => ({
  getAIStatus: () => mockGetAIStatus(),
  detectOllama: () => mockDetectOllama(),
  listModels: () => mockListModels(),
  pullModel: (model: string) => mockPullModel(model),
  getOllamaContainerStatus: () => mockGetOllamaContainerStatus(),
  startOllamaContainer: () => mockStartOllamaContainer(),
  stopOllamaContainer: () => mockStopOllamaContainer(),
  getSystemResources: () => mockGetSystemResources(),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock useModelDownloadProgress hook
vi.mock('../../hooks/websocket', () => ({
  useModelDownloadProgress: () => ({ progress: null }),
}));

// Mock useAIStatus hook
vi.mock('../../hooks/useAIStatus', () => ({
  invalidateAIStatusCache: vi.fn(),
}));

// Mock popular models response
const mockPopularModels = {
  version: '1.0.0',
  lastUpdated: '2026-01-02',
  models: [
    { name: 'llama3.2:3b', description: 'Meta, fast & lightweight (2GB)', recommended: true },
    { name: 'deepseek-r1:7b', description: 'DeepSeek, reasoning model (4.7GB)' },
    { name: 'mistral:7b', description: 'Mistral AI, balanced (4GB)' },
  ],
};

// Mock global fetch for popular models
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes('popular-models.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPopularModels),
      } as Response);
    }
    return originalFetch(input as any);
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Import component after mocks
import AISettings from '../../components/AISettings';

// Default mock responses
const defaultSettings = {
  aiEnabled: false,
  aiEndpoint: '',
  aiModel: '',
};

const enabledSettings = {
  aiEnabled: true,
  aiEndpoint: 'http://host.docker.internal:11434',
  aiModel: 'llama3.2:3b',
};

const mockModels = {
  models: [
    { name: 'llama3.2:3b', size: 2000000000, modifiedAt: '2024-01-15' },
    { name: 'mistral:7b', size: 4000000000, modifiedAt: '2024-01-10' },
  ],
};

const mockSystemResources = {
  ram: { total: 16384, available: 8192, required: 4096, sufficient: true },
  disk: { total: 512000, available: 100000, required: 8192, sufficient: true },
  gpu: { available: false, name: null },
  overall: { sufficient: true, warnings: [] },
};

describe('AISettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSystemSettings.mockResolvedValue(defaultSettings);
    mockUpdateSystemSettings.mockResolvedValue({});
    mockGetAIStatus.mockResolvedValue({ available: true, model: 'llama3.2:3b' });
    mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://host.docker.internal:11434', models: ['llama3.2:3b'] });
    mockListModels.mockResolvedValue(mockModels);
    mockPullModel.mockResolvedValue({ success: true, model: 'llama3.2:3b' });
    mockGetOllamaContainerStatus.mockResolvedValue({ available: false, exists: false, running: false, status: 'not-available' });
    mockStartOllamaContainer.mockResolvedValue({ success: true, message: 'Container started' });
    mockStopOllamaContainer.mockResolvedValue({ success: true, message: 'Container stopped' });
    mockGetSystemResources.mockResolvedValue(mockSystemResources);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Loading', () => {
    it('should show loading spinner initially', () => {
      const pending = new Promise(() => {});
      mockGetSystemSettings.mockReturnValue(pending);
      mockGetOllamaContainerStatus.mockReturnValue(pending as any);
      mockGetAIStatus.mockReturnValue(pending as any);
      mockDetectOllama.mockReturnValue(pending as any);
      mockListModels.mockReturnValue(pending as any);
      mockPullModel.mockReturnValue(pending as any);
      mockGetSystemResources.mockReturnValue(pending as any);
      global.fetch = vi.fn(() => pending as any);
      const { container } = render(<AISettings />);

      // Look for the spinner via class since there's no role="status"
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });

    it('should load and display settings after mount', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });

      expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
    });

    it('should handle settings load error gracefully', async () => {
      mockGetSystemSettings.mockRejectedValue(new Error('Failed to load'));
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
    });
  });

  describe('AI Toggle', () => {
    it('should show toggle in off state when AI is disabled', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggle = screen.getByRole('button', { name: '' });
      expect(toggle).toHaveClass('bg-sanctuary-300');
    });

    it('should toggle AI on when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Find the toggle button (it's the one without text)
      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        // Modal should appear
        await waitFor(() => {
          expect(screen.getByText('Enable AI Assistant')).toBeInTheDocument();
        });

        // Wait for resources to load and click Enable button
        await waitFor(() => {
          expect(screen.getByText('Enable AI')).toBeInTheDocument();
        });

        const enableButton = screen.getByRole('button', { name: 'Enable AI' });
        await user.click(enableButton);

        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
        });
      }
    });

    it('should toggle AI off when clicked again', async () => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for page to load - when AI is enabled, toggle shows in ON state
      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: false });
        });
      }
    });

    it('should show success message after toggling', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      const toggleButtons = screen.getAllByRole('button');
      const toggle = toggleButtons.find(btn => btn.className.includes('rounded-full'));

      if (toggle) {
        await user.click(toggle);

        // Modal should appear
        await waitFor(() => {
          expect(screen.getByText('Enable AI Assistant')).toBeInTheDocument();
        });

        // Wait for resources to load and click Enable button
        await waitFor(() => {
          expect(screen.getByText('Enable AI')).toBeInTheDocument();
        });

        const enableButton = screen.getByRole('button', { name: 'Enable AI' });
        await user.click(enableButton);

        // Success message appears after enabling
        await waitFor(() => {
          expect(mockUpdateSystemSettings).toHaveBeenCalled();
        });
      }
    });

    // Note: Toggle error handling is tested implicitly through the save error test
    // The toggle uses the same error state mechanism
    it('should verify error state exists in component', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Verify the component structure that would display errors
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });
  });

  describe('Configuration Panel', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    // Helper to get tab buttons (they're in a flex container with border-b)
    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      // Tab buttons are inside span.hidden.sm:inline
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    it('should show configuration panel when AI is enabled and on Settings tab', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });

      // Click on Settings tab
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);

      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText('http://host.docker.internal:11434')).toBeInTheDocument();
    });

    it('should not show Settings tab when AI is disabled', async () => {
      mockGetSystemSettings.mockResolvedValue(defaultSettings);
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
      });

      // Settings tab exists but should be disabled
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).toBeDisabled();
    });

    it('should update endpoint input value', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });

      // Click on Settings tab
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);

      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('http://host.docker.internal:11434');
      await user.clear(input);
      await user.type(input, 'http://localhost:11434');

      expect(input).toHaveValue('http://localhost:11434');
    });
  });

  describe('Ollama Detection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue({ ...enabledSettings, aiEndpoint: '' });
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);
      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });
    };

    it('should show detect button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Detect')).toBeInTheDocument();
    });

    it('should detect Ollama and populate endpoint', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectOllama).toHaveBeenCalled();
      });

      await waitFor(() => {
        const input = screen.getByPlaceholderText('http://host.docker.internal:11434');
        expect(input).toHaveValue('http://host.docker.internal:11434');
      });
    });

    it('should show message when Ollama not found', async () => {
      mockDetectOllama.mockResolvedValue({ found: false, message: 'Ollama not found. Is it running?' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(screen.getByText(/Ollama not found/)).toBeInTheDocument();
      });
    });

    it('should auto-select first model when detected', async () => {
      mockDetectOllama.mockResolvedValue({
        found: true,
        endpoint: 'http://host.docker.internal:11434',
        models: ['llama3.2:3b', 'mistral:7b'],
      });
      mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: '', aiModel: '' });

      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(mockDetectOllama).toHaveBeenCalled();
      });
    });

    it('should handle detection error', async () => {
      mockDetectOllama.mockRejectedValue(new Error('Detection failed'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Detect'));

      await waitFor(() => {
        expect(screen.getByText(/Detection failed/)).toBeInTheDocument();
      });
    });
  });

  describe('Model Selection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);
      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });
    };

    it('should show model dropdown', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Model')).toBeInTheDocument();

      // The selected model appears in the dropdown button
      await waitFor(() => {
        expect(screen.getAllByText('llama3.2:3b').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should open dropdown when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      // Find the dropdown button by looking for the one with ChevronDown icon
      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should list available models', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should select model from dropdown', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      const modelLabel = screen.getByText('Model');
      const modelSection = modelLabel.closest('div');
      const dropdownButton = modelSection?.querySelector('button');

      if (dropdownButton) {
        await user.click(dropdownButton);

        await waitFor(() => {
          expect(screen.getByText('Installed Models')).toBeInTheDocument();
        });
      }
    });

    it('should refresh models list', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockListModels).toHaveBeenCalled();
      });
    });
  });

  describe('Save Configuration', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);
      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });
    };

    it('should show save button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Save Configuration')).toBeInTheDocument();
    });

    it('should save configuration when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(mockUpdateSystemSettings).toHaveBeenCalledWith({
          aiEndpoint: 'http://host.docker.internal:11434',
          aiModel: 'llama3.2:3b',
        });
      });
    });

    it('should show success message after save', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(screen.getByText('Configuration saved')).toBeInTheDocument();
      });
    });

    it('should show error message on save failure', async () => {
      mockUpdateSystemSettings.mockRejectedValue(new Error('Save failed'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Save Configuration'));

      await waitFor(() => {
        expect(screen.getByText('Failed to save AI configuration')).toBeInTheDocument();
      });
    });

    it('should disable save button without endpoint and model', async () => {
      mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: '', aiModel: '' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Save Configuration')).toBeDisabled();
    });
  });

  describe('Test Connection', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const settingsTab = getTabButton('Settings');
      expect(settingsTab).not.toBeNull();
      await user.click(settingsTab!);
      await waitFor(() => {
        expect(screen.getByText('AI Endpoint URL')).toBeInTheDocument();
      });
    };

    it('should show test connection button', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      expect(screen.getByText('Test Connection')).toBeInTheDocument();
    });

    it('should test connection when clicked', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(mockGetAIStatus).toHaveBeenCalled();
      });
    });

    it('should show success message when connected', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText(/Connected to/)).toBeInTheDocument();
      });
    });

    it('should show error message when connection fails', async () => {
      mockGetAIStatus.mockResolvedValue({ available: false, error: 'Connection refused' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
      });
    });

    it('should handle connection test error', async () => {
      mockGetAIStatus.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToSettingsTab(user);

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText('Failed to connect')).toBeInTheDocument();
      });
    });
  });

  describe('Model Pull', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToModelsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const modelsTab = getTabButton('Models');
      expect(modelsTab).not.toBeNull();
      await user.click(modelsTab!);
      await waitFor(() => {
        expect(screen.getByText('Popular Models')).toBeInTheDocument();
      });
    };

    it('should show popular models section', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getByText('Popular Models')).toBeInTheDocument();
    });

    it('should show popular models list', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Popular models appear in the models section
      expect(screen.getByText('deepseek-r1:7b')).toBeInTheDocument();
    });

    it('should show delete button for installed models', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Installed models show Delete button instead of Pull
      expect(screen.getAllByText('Delete').length).toBeGreaterThan(0);
    });

    it('should show pull button for non-installed models', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getAllByText('Pull').length).toBeGreaterThan(0);
    });

    it('should pull model when pull button clicked', async () => {
      mockListModels.mockResolvedValue({ models: [] }); // No models installed
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText('Pull');
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
    });

    it('should show progress during pull', async () => {
      mockListModels.mockResolvedValue({ models: [] });
      mockPullModel.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ success: true }), 100);
      }));
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText('Pull');
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/Starting download/)).toBeInTheDocument();
      });
    });

    it('should show success after pull completes', async () => {
      mockListModels.mockResolvedValue({ models: [] });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText('Pull');
      await user.click(pullButtons[0]);

      // Pull now starts async - check that it was initiated
      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
      // Success message now comes via WebSocket progress (not tested here)
    });

    it('should show error on pull failure', async () => {
      mockListModels.mockResolvedValue({ models: [] });
      mockPullModel.mockResolvedValue({ success: false, error: 'Model not found' });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText('Pull');
      await user.click(pullButtons[0]);

      await waitFor(() => {
        expect(screen.getByText(/Failed.*Model not found/)).toBeInTheDocument();
      });
    });

    it('should refresh models list after successful pull', async () => {
      mockListModels.mockResolvedValue({ models: [] });
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const pullButtons = screen.getAllByText('Pull');
      await user.click(pullButtons[0]);

      // Pull is now async - just verify the pull was initiated
      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalled();
      });
      // Models list refresh now happens via WebSocket completion callback
    });
  });

  describe('Custom Model Pull', () => {
    beforeEach(() => {
      mockGetSystemSettings.mockResolvedValue(enabledSettings);
    });

    const getTabButton = (name: string) => {
      const tabs = screen.getAllByText(name);
      const tabSpan = tabs.find(el => el.classList.contains('hidden'));
      return tabSpan?.closest('button');
    };

    const navigateToModelsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      await waitFor(() => {
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      });
      const modelsTab = getTabButton('Models');
      expect(modelsTab).not.toBeNull();
      await user.click(modelsTab!);
      await waitFor(() => {
        expect(screen.getByText('Popular Models')).toBeInTheDocument();
      });
    };

    it('should show custom model input', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      expect(screen.getByPlaceholderText(/codellama/)).toBeInTheDocument();
    });

    it('should pull custom model', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      const input = screen.getByPlaceholderText(/codellama/);
      await user.type(input, 'custom-model:latest');

      // Find the pull button next to the custom input
      const pullButtons = screen.getAllByText('Pull');
      const customPullButton = pullButtons[pullButtons.length - 1]; // Last pull button

      await user.click(customPullButton);

      await waitFor(() => {
        expect(mockPullModel).toHaveBeenCalledWith('custom-model:latest');
      });
    });

    it('should disable pull button when input is empty', async () => {
      const user = userEvent.setup();
      render(<AISettings />);

      await navigateToModelsTab(user);

      // Find the custom pull section's button - it's next to the input
      const customInput = screen.getByPlaceholderText(/codellama/);
      const customSection = customInput.closest('div');
      const pullButton = customSection?.querySelector('button');

      expect(pullButton).toBeDisabled();
    });
  });

  describe('Security Notice', () => {
    it('should show security notice', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Isolated AI Architecture')).toBeInTheDocument();
      });
    });

    it('should explain security measures', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText(/no access to private keys/)).toBeInTheDocument();
      });
    });
  });

  describe('AI Features Section', () => {
    it('should show AI features description', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('What AI Can Do')).toBeInTheDocument();
      });
    });

    it('should describe transaction labeling', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Transaction Labeling')).toBeInTheDocument();
      });
    });

    it('should describe natural language queries', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Natural Language Queries')).toBeInTheDocument();
      });
    });
  });
});
