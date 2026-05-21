import { useState } from 'react';
import * as aiApi from '../../../src/api/ai';
import { ApiError } from '../../../src/api/client';
import { createLogger } from '../../../utils/logger';

const log = createLogger('AISettings');

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const responseMessage = error.response?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }
    if (error.message.trim()) return error.message;
  }

  return 'Failed to connect';
}

export function useAIConnectionStatus() {
  const [aiStatus, setAiStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [aiStatusMessage, setAiStatusMessage] = useState('');

  const handleTestConnection = async () => {
    setAiStatus('checking');
    setAiStatusMessage('Testing connection...');

    try {
      const status = await aiApi.testAIConnection();
      if (status.available) {
        setAiStatus('connected');
        setAiStatusMessage(`Connected to ${status.model || 'AI model'}`);
      } else {
        setAiStatus('error');
        setAiStatusMessage(status.error || status.message || 'AI not available');
      }
    } catch (error) {
      log.error('Failed to test AI connection', { error });
      setAiStatus('error');
      setAiStatusMessage(getConnectionErrorMessage(error));
    }
  };

  return {
    aiStatus,
    aiStatusMessage,
    handleTestConnection,
  };
}
