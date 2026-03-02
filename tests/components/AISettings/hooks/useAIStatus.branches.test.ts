import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAIStatus } from '../../../../components/AISettings/hooks/useAIStatus';
import * as aiApi from '../../../../src/api/ai';

const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../src/api/ai', () => ({
  getAIStatus: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

describe('useAIStatus branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers connected and unavailable message fallback branches', async () => {
    vi.mocked(aiApi.getAIStatus)
      .mockResolvedValueOnce({ available: true, model: 'llama3.2:1b' } as never)
      .mockResolvedValueOnce({ available: true } as never)
      .mockResolvedValueOnce({ available: false, error: 'service offline' } as never)
      .mockResolvedValueOnce({ available: false, message: 'temporary outage' } as never)
      .mockResolvedValueOnce({ available: false } as never);

    const { result } = renderHook(() => useAIStatus());

    await act(async () => {
      await result.current.handleTestConnection();
    });
    expect(result.current.aiStatus).toBe('connected');
    expect(result.current.aiStatusMessage).toBe('Connected to llama3.2:1b');

    await act(async () => {
      await result.current.handleTestConnection();
    });
    expect(result.current.aiStatus).toBe('connected');
    expect(result.current.aiStatusMessage).toBe('Connected to AI model');

    await act(async () => {
      await result.current.handleTestConnection();
    });
    expect(result.current.aiStatus).toBe('error');
    expect(result.current.aiStatusMessage).toBe('service offline');

    await act(async () => {
      await result.current.handleTestConnection();
    });
    expect(result.current.aiStatus).toBe('error');
    expect(result.current.aiStatusMessage).toBe('temporary outage');

    await act(async () => {
      await result.current.handleTestConnection();
    });
    expect(result.current.aiStatus).toBe('error');
    expect(result.current.aiStatusMessage).toBe('AI not available');
  });

  it('covers exception path and logging', async () => {
    vi.mocked(aiApi.getAIStatus).mockRejectedValueOnce(new Error('network failed'));

    const { result } = renderHook(() => useAIStatus());

    await act(async () => {
      await result.current.handleTestConnection();
    });

    expect(result.current.aiStatus).toBe('error');
    expect(result.current.aiStatusMessage).toBe('Failed to connect');
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to test AI connection', {
      error: expect.any(Error),
    });
  });
});
