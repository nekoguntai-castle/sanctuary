import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSystemSettings = vi.fn();
const mockUpdateSystemSettings = vi.fn();
const mockDetectOllama = vi.fn();
const mockListModels = vi.fn();

vi.mock('../../src/api/admin', () => ({
  getSystemSettings: () => mockGetSystemSettings(),
  updateSystemSettings: (settings: Record<string, unknown>) => mockUpdateSystemSettings(settings),
}));

vi.mock('../../src/api/ai', () => ({
  detectOllama: () => mockDetectOllama(),
  listModels: () => mockListModels(),
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
      <button onClick={() => props.onModelChange('typed-model')}>type-model</button>
      <button onClick={() => props.onSelectModel('llama3.2:3b')}>select-model</button>
      <button onClick={props.onRefreshModels}>refresh-models</button>
      <div data-testid="models-current-model">{props.aiModel}</div>
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
  mockDetectOllama.mockResolvedValue({
    found: true,
    endpoint: 'http://host.docker.internal:11434',
    models: ['llama3.2:3b'],
  });
  mockListModels.mockResolvedValue({ models: [] });
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
    setDefaultMocks();
  });

  it('handles model list load errors when endpoint is configured', async () => {
    mockGetSystemSettings.mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: 'llama3.2:3b',
    });
    mockListModels.mockRejectedValue(new Error('list failed'));

    await renderAndWaitForReady();

    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalled();
    });
  });

  it('handles model entry, selection, and refresh callbacks from models tab', async () => {
    mockGetSystemSettings.mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: '',
    });

    await renderAndWaitForReady();
    clickTopTab('Models');

    fireEvent.click(screen.getByText('type-model'));
    expect(screen.getByTestId('models-current-model')).toHaveTextContent('typed-model');

    fireEvent.click(screen.getByText('select-model'));
    expect(screen.getByTestId('models-current-model')).toHaveTextContent('llama3.2:3b');

    fireEvent.click(screen.getByText('refresh-models'));
    await waitFor(() => {
      expect(mockListModels).toHaveBeenCalled();
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
    mockDetectOllama.mockResolvedValue({
      found: true,
      endpoint: 'http://host.docker.internal:11434',
      models: ['phi3:mini'],
    });

    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('toggle-ai'));
    fireEvent.click(screen.getByText('confirm-enable'));

    await waitFor(() => {
      expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true });
    });

    expect(mockDetectOllama).not.toHaveBeenCalled();
    expect(mockUpdateSystemSettings).not.toHaveBeenCalledWith({
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: 'phi3:mini',
    });
  });

  it('handles manual model selection callback from settings tab', async () => {
    mockGetSystemSettings.mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: '',
    });

    await renderAndWaitForReady();
    fireEvent.click(screen.getByText('go-settings-callback'));
    fireEvent.click(screen.getByText('select-model'));

    expect(screen.getByTestId('settings-model')).toHaveTextContent('manual-model:1b');
  });

  it('covers formatBytes callback passed to models tab', async () => {
    mockGetSystemSettings.mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: 'llama3.2:3b',
    });

    await renderAndWaitForReady();
    clickTopTab('Models');
    expect(screen.getByTestId('models-format-bytes')).toHaveTextContent('0 B|2 KB');
  });

  it('supports navigation callbacks passed into status/settings tabs', async () => {
    mockGetSystemSettings.mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://host.docker.internal:11434',
      aiModel: 'llama3.2:3b',
    });

    await renderAndWaitForReady();

    fireEvent.click(screen.getByText('go-settings-callback'));
    expect(screen.getByTestId('mock-settings-tab')).toBeInTheDocument();

    fireEvent.click(screen.getByText('go-models-callback'));
    expect(screen.getByTestId('mock-models-tab')).toBeInTheDocument();
  });
});
