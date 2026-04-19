import { useEffect, useRef, useState } from 'react';
import { useUser } from '../../../contexts/UserContext';
import * as authApi from '../../../src/api/auth';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import {
  buildTelegramPreferences,
  telegramChatIdResultMessage,
  telegramTestResultMessage,
  TelegramTestResult,
} from './telegramSectionData';

const log = createLogger('TelegramSection');

export function useTelegramSettings() {
  const { user, updatePreferences } = useUser();
  const telegramPreferences = user?.preferences?.telegram;
  const [botToken, setBotToken] = useState(telegramPreferences?.botToken || '');
  const [chatId, setChatId] = useState(telegramPreferences?.chatId || '');
  const [enabled, setEnabled] = useState(telegramPreferences?.enabled || false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingChatId, setIsFetchingChatId] = useState(false);
  const [testResult, setTestResult] = useState<TelegramTestResult | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      clearSaveSuccessTimeout(successTimeoutRef);
    };
  }, []);

  const handleTestConnection = async () => {
    if (!botToken || !chatId) {
      setError('Please enter both bot token and chat ID');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await authApi.testTelegramConfig(botToken, chatId);
      setTestResult(telegramTestResultMessage(result));
    } catch (err) {
      const message = logError(log, err, 'Failed to test Telegram connection', {
        fallbackMessage: 'Failed to test connection',
      });
      setTestResult({ success: false, message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchChatId = async () => {
    if (!botToken) {
      setError('Please enter your bot token first');
      return;
    }

    setIsFetchingChatId(true);
    setError(null);
    setTestResult(null);

    try {
      const result = await authApi.fetchTelegramChatId(botToken);
      if (result.success && result.chatId) {
        setChatId(result.chatId);
      }
      setTestResult(telegramChatIdResultMessage(result));
    } catch (err) {
      const message = logError(log, err, 'Failed to fetch Telegram chat ID', {
        fallbackMessage: 'Failed to fetch chat ID',
      });
      setTestResult({ success: false, message });
    } finally {
      setIsFetchingChatId(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      await updatePreferences(buildTelegramPreferences({ botToken, chatId, enabled, user }));
      showSaveSuccess(setSaveSuccess, successTimeoutRef);
    } catch (err) {
      const message = logError(log, err, 'Failed to save Telegram settings', {
        fallbackMessage: 'Failed to save settings',
      });
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);

    try {
      await updatePreferences(buildTelegramPreferences({ botToken, chatId, enabled: newEnabled, user }));
    } catch (err) {
      setEnabled(!newEnabled);
      const message = logError(log, err, 'Failed to toggle Telegram notifications', {
        fallbackMessage: 'Failed to update settings',
      });
      setError(message);
    }
  };

  return {
    botToken,
    chatId,
    enabled,
    error,
    isConfigured: Boolean(botToken && chatId),
    isFetchingChatId,
    isSaving,
    isTesting,
    saveSuccess,
    setBotToken,
    setChatId,
    setShowBotToken,
    showBotToken,
    testResult,
    handleFetchChatId,
    handleSave,
    handleTestConnection,
    handleToggleEnabled,
  };
}

function showSaveSuccess(
  setSaveSuccess: (value: boolean) => void,
  successTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  setSaveSuccess(true);
  clearSaveSuccessTimeout(successTimeoutRef);
  successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
}

function clearSaveSuccessTimeout(
  successTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  if (successTimeoutRef.current) {
    clearTimeout(successTimeoutRef.current);
  }
}
