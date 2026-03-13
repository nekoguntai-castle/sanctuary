import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockGetSystemSettings = vi.fn();
const mockUpdateSystemSettings = vi.fn();
const mockDetectOllama = vi.fn();
const mockListModels = vi.fn();
const mockPullModel = vi.fn();
const mockDeleteModel = vi.fn();
const mockGetOllamaContainerStatus = vi.fn();
const mockStartOllamaContainer = vi.fn();
const mockStopOllamaContainer = vi.fn();
const mockGetSystemResources = vi.fn();

let downloadProgressListener: ((progress: any) => void) | null = null;

vi.mock('../../src/api/admin', () => ({
  getSystemSettings: () => mockGetSystemSettings(),
  updateSystemSettings: (settings: Record<string, unknown>) => mockUpdateSystemSettings(settings),
}));

vi.mock('../../src/api/ai', () => ({
  detectOllama: () => mockDetectOllama(),
  listModels: () => mockListModels(),
  pullModel: (model: string) => mockPullModel(model),
  deleteModel: (model: string) => mockDeleteModel(model),
  getOllamaContainerStatus: () => mockGetOllamaContainerStatus(),
  startOllamaContainer: () => mockStartOllamaContainer(),
  stopOllamaContainer: () => mockStopOllamaContainer(),
  getSystemResources: () => mockGetSystemResources(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../hooks/useAIStatus', () => ({
  invalidateAIStatusCache: vi.fn(),
}));

vi.mock('../../components/AISettings/hooks/useAIConnectionStatus', () => ({
  useAIConnectionStatus: () => ({
    aiStatus: 'idle',
    aiStatusMessage: '',
    handleTestConnection: vi.fn(),
  }),
}));

vi.mock('../../hooks/websocket', () => ({
  useModelDownloadProgress: (listener: (progress: any) => void) => {
    downloadProgressListener = listener;
  },
}));

vi.mock('../../components/AISettings/tabs/StatusTab', () => ({
  StatusTab: (props: any) => (
    <div data-testid="mock-status-tab">
      <button onClick={props.onToggleAI}>toggle-ai</button>
      <button onClick={props.onStartContainer}>start-container</button>
      <button onClick={props.onStopContainer}>stop-container</button>
      <button onClick={props.onRefreshContainerStatus}>refresh-container</button>
      <button onClick={props.onNavigateToSettings}>go-settings-callback</button>
      <div data-testid="status-model">{props.aiModel}</div>
      <div data-testid="status-endpoint">{props.aiEndpoint}</div>
      <div data-testid="status-message">{props.containerMessage}</div>
    </div>
  ),
}));

vi.mock('../../components/AISettings/tabs/SettingsTab', () => ({
  SettingsTab: (props: any) => (
    <div data-testid="mock-settings-tab">
      <button onClick={() => props.onSelectModel('manual-model:1b')}>select-model</button>
      <div data-testid="settings-model">{props.aiModel}</div>
      <button onClick={props.onNavigateToModels}>go-models-callback</button>
    </div>
  ),
}));

vi.mock('../../components/AISettings/tabs/ModelsTab', () => ({
  ModelsTab: (props: any) => (
    <div data-testid="mock-models-tab">
      <button onClick={() => props.onPullModel('llama3.2:3b')}>pull-main</button>
      <button onClick={() => props.onDeleteModel('llama3.2:3b')}>delete-main</button>
      <button onClick={props.onLoadPopularModels}>reload-popular</button>
      <div data-testid="models-pull-progress">{props.pullProgress}</div>
      <div data-testid="models-popular-error">{props.popularModelsError || ''}</div>
      <div data-testid="models-format-bytes">{props.formatBytes(0)}|{props.formatBytes(2048)}</div>
    </div>
  ),
}));

vi.mock('../../components/AISettings/components/EnableModal', () => ({
  EnableModal: (props: any) =>
    props.showEnableModal ? (
      <div data-testid="enable-modal">
        <button onClick={props.onEnable}>confirm-enable</button>
        <button onClick={props.onClose}>close-enable</button>
      </div>
    ) : null,
}));

import AISettings from '../../components/AISettings';

function setDefaultMocks() {
  mockGetSystemSettings.mockResolvedValue({
    aiEnabled: false,
    aiEndpoint: '',
    aiModel: '',
  });
  mockUpdateSystemSettings.mockResolvedValue({});
  mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://ollama:11434', models: ['llama3.2:3b'] });
  mockListModels.mockResolvedValue({ models: [] });
  mockPullModel.mockResolvedValue({ success: true });
  mockDeleteModel.mockResolvedValue({ success: true });
  mockGetOllamaContainerStatus.mockResolvedValue({ available: false, exists: false, running: false, status: 'not-available' });
  mockStartOllamaContainer.mockResolvedValue({ success: true, message: 'Started' });
  mockStopOllamaContainer.mockResolvedValue({ success: true, message: 'Stopped' });
  mockGetSystemResources.mockResolvedValue({
    ram: { total: 16384, available: 8192, required: 4096, sufficient: true },
    disk: { total: 512000, available: 100000, required: 8192, sufficient: true },
    gpu: { available: false, name: null },
    overall: { sufficient: true, warnings: [] },
  });
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    } as Response),
  ) as any;
}

async function renderAndWaitForReady() {
  render(<AISettings />);
  await waitFor(() => {
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
  });
}

function clickTopTab(label: 'Status' | 'Settings' | 'Models') {
  const tabButton = screen.getAllByRole('button').find((button) => button.textContent?.includes(label));
  expect(tabButton).toBeDefined();
  fireEvent.click(tabButton as HTMLButtonElement);
}

describe('AISettings logic branches', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    downloadProgressListener = null;
    setDefaultMocks();
  });

  it('handles container status load failure on mount', async () => {
    mockGetOllamaContainerStatus.mockRejectedValue(new Error('container offline'));

    await renderAndWaitForReady();

    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
  });

  it('handles model list load errors when endpoint is configured', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });
    mockListModels.mockRejectedValue(new Error('list failed'));

    await renderAndWaitForReady();

    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalled();
    });
  });

  it('shows popular models error for HTTP failure and invalid response format', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: '' });
    (global.fetch as any) = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

    await renderAndWaitForReady();

    clickTopTab('Models');
    await waitFor(() => {
      expect(screen.getByTestId('models-popular-error')).toHaveTextContent('Unable to fetch the latest popular models list');
    });

    fireEvent.click(screen.getByText('reload-popular'));
    await waitFor(() => {
      expect(screen.getByTestId('models-popular-error')).toHaveTextContent('Unable to fetch the latest popular models list');
    });
  });

  it('handles websocket completion updates for the active pull model', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: '' });

    await renderAndWaitForReady();
    clickTopTab('Models');

    fireEvent.click(screen.getByText('pull-main'));
    await waitFor(() => {
      expect(mockPullModel).toHaveBeenCalledWith('llama3.2:3b');
    });
    expect(downloadProgressListener).toBeTypeOf('function');

    await act(async () => {
      downloadProgressListener?.({ model: 'llama3.2:3b', status: 'complete' });
    });

    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalled();
    });

    clickTopTab('Status');
    expect(screen.getByTestId('status-model')).toHaveTextContent('llama3.2:3b');
  });

  it('handles websocket error updates for the active pull model', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: '' });

    await renderAndWaitForReady();
    clickTopTab('Models');

    fireEvent.click(screen.getByText('pull-main'));
    await waitFor(() => {
      expect(mockPullModel).toHaveBeenCalledWith('llama3.2:3b');
    });

    await act(async () => {
      downloadProgressListener?.({ model: 'llama3.2:3b', status: 'error', error: 'disk full' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('models-pull-progress')).toHaveTextContent('Failed: disk full');
    });
  });

  it('opens and closes the enable modal when toggling from disabled state', async () => {
    await renderAndWaitForReady();

    fireEvent.click(screen.getByText('toggle-ai'));
    await waitFor(() => {
      expect(screen.getByTestId('enable-modal')).toBeInTheDocument();
    });
    expect(mockGetSystemResources).toHaveBeenCalled();

    fireEvent.click(screen.getByText('close-enable'));
    await waitFor(() => {
      expect(screen.queryByTestId('enable-modal')).not.toBeInTheDocument();
    });
  });

  it('returns early when enabling fails to start bundled container', async () => {
    mockGetOllamaContainerStatus.mockResolvedValue({ available: true, exists: false, running: false, status: 'stopped' });
    mockStartOllamaContainer.mockResolvedValue({ success: false, message: 'Docker unavailable' });

    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await waitFor(() => {
      expect(mockStartOllamaContainer).toHaveBeenCalled();
    });
    expect(mockUpdateSystemSettings).not.toHaveBeenCalledWith({ aiEnabled: true });
  });

  it('auto-configures endpoint and first model when enabling with running bundled container', async () => {
    mockGetOllamaContainerStatus.mockResolvedValue({ available: true, exists: true, running: true, status: 'running' });
    mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://ollama:11434', models: ['phi3:mini'] });

    await renderAndWaitForReady();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({
      aiEndpoint: 'http://ollama:11434',
      aiModel: 'phi3:mini',
    });
    expect(mockDetectOllama).toHaveBeenCalled();
    expect(mockListModels).toHaveBeenCalled();

    expect(screen.getByTestId('status-endpoint')).toHaveTextContent('http://ollama:11434');
    expect(screen.getByTestId('status-model')).toHaveTextContent('phi3:mini');
  });

  it('saves endpoint only when enabling and detect finds no models', async () => {
    mockGetOllamaContainerStatus.mockResolvedValue({ available: true, exists: true, running: true, status: 'running' });
    mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://ollama:11434', models: [] });

    await renderAndWaitForReady();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEndpoint: 'http://ollama:11434' });
  });

  it('handles delete model confirmation, failure response, and thrown error', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });
    const confirmSpy = vi.spyOn(window, 'confirm');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    await renderAndWaitForReady();
    clickTopTab('Models');

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText('delete-main'));
    expect(mockDeleteModel).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    mockDeleteModel.mockResolvedValueOnce({ success: false, error: 'busy' });
    fireEvent.click(screen.getByText('delete-main'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to delete: busy');
    });

    confirmSpy.mockReturnValueOnce(true);
    mockDeleteModel.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByText('delete-main'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    });
  });

  it('handles manual model selection callback from settings tab', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: '' });

    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('go-settings-callback'));
    fireEvent.click(screen.getByText('select-model'));

    expect(screen.getByTestId('settings-model')).toHaveTextContent('manual-model:1b');
  });

  it('handles refresh container status failure path', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });
    mockGetOllamaContainerStatus
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' })
      .mockRejectedValueOnce(new Error('refresh failed'));

    await renderAndWaitForReady();

    fireEvent.click(screen.getByText('refresh-container'));
    await waitFor(() => {
      expect(mockGetOllamaContainerStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('handles stop container failure and exception paths', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });
    mockStopOllamaContainer
      .mockResolvedValueOnce({ success: false, message: 'busy' })
      .mockRejectedValueOnce(new Error('stop crashed'));

    await renderAndWaitForReady();

    fireEvent.click(screen.getByText('stop-container'));
    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toHaveTextContent('Failed: busy');
    });

    fireEvent.click(screen.getByText('stop-container'));
    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toHaveTextContent('Error:');
    });
  });

  it('handles start container success, failed response, and exception branches', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });
    mockGetOllamaContainerStatus
      .mockResolvedValueOnce({ available: true, exists: true, running: false, status: 'stopped' })
      .mockResolvedValueOnce({ available: true, exists: true, running: true, status: 'running' });
    mockStartOllamaContainer
      .mockResolvedValueOnce({ success: true, message: 'started' })
      .mockResolvedValueOnce({ success: false, message: 'engine unavailable' })
      .mockRejectedValueOnce(new Error('start crashed'));
    mockDetectOllama.mockResolvedValueOnce({ found: false, message: 'not found' });

    await renderAndWaitForReady();
    vi.useFakeTimers();

    fireEvent.click(screen.getByText('start-container'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockStartOllamaContainer).toHaveBeenCalled();
    expect(mockDetectOllama).toHaveBeenCalled();

    fireEvent.click(screen.getByText('start-container'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('status-message')).toHaveTextContent('Failed: engine unavailable');

    fireEvent.click(screen.getByText('start-container'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('status-message')).toHaveTextContent('Error:');
  });

  it('covers formatBytes callback passed to models tab', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });

    await renderAndWaitForReady();
    clickTopTab('Models');
    expect(screen.getByTestId('models-format-bytes')).toHaveTextContent('0 B|2 KB');
  });

  it('supports navigation callbacks passed into status/settings tabs', async () => {
    mockGetSystemSettings.mockResolvedValue({ aiEnabled: true, aiEndpoint: 'http://ollama:11434', aiModel: 'llama3.2:3b' });

    await renderAndWaitForReady();

    fireEvent.click(screen.getByText('go-settings-callback'));
    expect(screen.getByTestId('mock-settings-tab')).toBeInTheDocument();

    fireEvent.click(screen.getByText('go-models-callback'));
    expect(screen.getByTestId('mock-models-tab')).toBeInTheDocument();
  });
});
