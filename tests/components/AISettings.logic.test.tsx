import { act,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockGetSystemSettings = vi.fn();
const mockUpdateSystemSettings = vi.fn();
const mockDetectOllama = vi.fn();
const mockListModels = vi.fn();
const mockPullModel = vi.fn();
const mockDeleteModel = vi.fn();

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
      <button onClick={props.onNavigateToSettings}>go-settings-callback</button>
      <div data-testid="status-model">{props.aiModel}</div>
      <div data-testid="status-endpoint">{props.aiEndpoint}</div>
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
    expect(screen.getByText('AI Settings')).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('close-enable'));
    await waitFor(() => {
      expect(screen.queryByTestId('enable-modal')).not.toBeInTheDocument();
    });
  });

  it('enables AI without starting provider runtimes', async () => {
    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await waitFor(() => {
      expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    });
  });

  it('enables AI without auto-configuring endpoint', async () => {
    mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://ollama:11434', models: ['phi3:mini'] });

    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await waitFor(() => {
      expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    });

    expect(mockDetectOllama).not.toHaveBeenCalled();
    expect(mockUpdateSystemSettings).not.toHaveBeenCalledWith({
      aiEndpoint: 'http://ollama:11434',
      aiModel: 'phi3:mini',
    });
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
