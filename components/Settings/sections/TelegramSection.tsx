import React, { useState, useRef, useEffect } from 'react';
import { useUser } from '../../../contexts/UserContext';
import { Send, Eye, EyeOff, RefreshCw, AlertCircle, ExternalLink, Check } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import * as authApi from '../../../src/api/auth';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';

const log = createLogger('TelegramSection');

const TelegramSettings: React.FC = () => {
  const { user, updatePreferences } = useUser();

  const [botToken, setBotToken] = useState(user?.preferences?.telegram?.botToken || '');
  const [chatId, setChatId] = useState(user?.preferences?.telegram?.chatId || '');
  const [enabled, setEnabled] = useState(user?.preferences?.telegram?.enabled || false);
  const [showBotToken, setShowBotToken] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingChatId, setIsFetchingChatId] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
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
      if (result.success) {
        setTestResult({ success: true, message: 'Test message sent successfully!' });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to send test message' });
      }
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
        const username = result.username ? ` (@${result.username})` : '';
        setTestResult({ success: true, message: `Chat ID found${username}!` });
      } else {
        setTestResult({ success: false, message: result.error || 'Failed to fetch chat ID' });
      }
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
      await updatePreferences({
        telegram: {
          botToken,
          chatId,
          enabled,
          wallets: user?.preferences?.telegram?.wallets || {},
        },
      });
      setSaveSuccess(true);
      // Clear any existing timeout and set new one
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
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

    // Save immediately when toggling
    try {
      await updatePreferences({
        telegram: {
          botToken,
          chatId,
          enabled: newEnabled,
          wallets: user?.preferences?.telegram?.wallets || {},
        },
      });
    } catch (err) {
      // Revert on error
      setEnabled(!newEnabled);
      const message = logError(log, err, 'Failed to toggle Telegram notifications', {
        fallbackMessage: 'Failed to update settings',
      });
      setError(message);
    }
  };

  const isConfigured = botToken && chatId;

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Send className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Telegram Notifications</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          Receive transaction notifications via Telegram. Create your own bot using{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
          >
            @BotFather
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
          {' '}and get your chat ID from{' '}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
          >
            @userinfobot
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>.
        </p>

        {/* Bot Token */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Bot Token
          </label>
          <div className="relative">
            <input
              type={showBotToken ? 'text' : 'password'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              className="w-full px-3 py-2 pr-12 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowBotToken(!showBotToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-sanctuary-500">From @BotFather when you create your bot</p>
        </div>

        {/* Chat ID */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
            Chat ID
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789"
              className="flex-1 px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
            />
            <Button
              variant="secondary"
              onClick={handleFetchChatId}
              disabled={!botToken || isFetchingChatId}
              title="Fetch chat ID from bot (send /start to your bot first)"
            >
              {isFetchingChatId ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                'Fetch'
              )}
            </Button>
          </div>
          <p className="text-xs text-sanctuary-500">
            Send <code className="px-1 py-0.5 bg-sanctuary-100 dark:bg-sanctuary-800 rounded">/start</code> to your bot, then click Fetch
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`p-3 rounded-lg flex items-center space-x-2 ${
            testResult.success
              ? 'bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800'
              : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'
          }`}>
            {testResult.success ? (
              <Check className="w-4 h-4 text-success-600 dark:text-success-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            )}
            <span className={`text-sm ${
              testResult.success
                ? 'text-success-600 dark:text-success-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>{testResult.message}</span>
          </div>
        )}

        {/* Save Success */}
        {saveSuccess && (
          <div className="p-3 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-lg flex items-center space-x-2">
            <Check className="w-4 h-4 text-success-600 dark:text-success-400" />
            <span className="text-sm text-success-600 dark:text-success-400">Settings saved successfully</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <Button
              variant="secondary"
              onClick={handleTestConnection}
              disabled={!botToken || !chatId || isTesting}
            >
              {isTesting ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Test
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>
          </div>

          {/* Enable toggle */}
          <label className="flex items-center space-x-3 cursor-pointer">
            <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Toggle
              checked={!!(enabled && isConfigured)}
              onChange={handleToggleEnabled}
              disabled={!isConfigured}
              color="success"
            />
          </label>
        </div>

        {isConfigured && (
          <p className="text-xs text-sanctuary-500 dark:text-sanctuary-500">
            Configure per-wallet notification preferences in each wallet's Settings tab.
          </p>
        )}
      </div>
    </div>
  );
};

export { TelegramSettings };
