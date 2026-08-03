import { Send, Eye, EyeOff, RefreshCw, AlertCircle, ExternalLink, Check } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toggle } from '../../ui/Toggle';
import type { TelegramTestResult } from './telegramSectionData';
import type { useTelegramSettings } from './useTelegramSettings';

type TelegramSettingsState = ReturnType<typeof useTelegramSettings>;

export function TelegramSectionPanel({
  settings,
}: {
  settings: TelegramSettingsState;
}) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <TelegramHeader />
      <div className="p-6 space-y-6">
        <TelegramIntro />
        <BotTokenField settings={settings} />
        <ChatIdField settings={settings} />
        <TelegramErrorMessage error={settings.error} />
        <TelegramTestResultMessage testResult={settings.testResult} />
        <SaveSuccessMessage saveSuccess={settings.saveSuccess} />
        <TelegramActions settings={settings} />
        <PerWalletTelegramNote isConfigured={settings.isConfigured} />
      </div>
    </div>
  );
}

function TelegramHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
          <Send className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Telegram Notifications</h3>
      </div>
    </div>
  );
}

function TelegramIntro() {
  return (
    <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
      Receive transaction notifications via Telegram. Create your own bot using{' '}
      <TelegramLink href="https://t.me/BotFather">@BotFather</TelegramLink>
      {' '}and get your chat ID from{' '}
      <TelegramLink href="https://t.me/userinfobot">@userinfobot</TelegramLink>.
    </p>
  );
}

function TelegramLink({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
    >
      {children}
      <ExternalLink className="w-3 h-3 ml-1" />
    </a>
  );
}

function BotTokenField({
  settings,
}: {
  settings: TelegramSettingsState;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        Bot Token
      </label>
      <div className="relative">
        <Input
          type={settings.showBotToken ? 'text' : 'password'}
          value={settings.botToken}
          onChange={(event) => settings.setBotToken(event.target.value)}
          placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
          className="pr-12 text-sanctuary-900 dark:text-sanctuary-100 font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => settings.setShowBotToken(!settings.showBotToken)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
        >
          {settings.showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-xs text-sanctuary-500">From @BotFather when you create your bot</p>
    </div>
  );
}

function ChatIdField({
  settings,
}: {
  settings: TelegramSettingsState;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        Chat ID
      </label>
      <div className="flex space-x-2">
        <Input
          type="text"
          value={settings.chatId}
          onChange={(event) => settings.setChatId(event.target.value)}
          placeholder="123456789"
          className="flex-1 text-sanctuary-900 dark:text-sanctuary-100 font-mono text-sm"
        />
        <Button
          variant="secondary"
          onClick={settings.handleFetchChatId}
          disabled={!settings.botToken || settings.isFetchingChatId}
          title="Fetch chat ID from bot (send /start to your bot first)"
        >
          {settings.isFetchingChatId ? (
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
  );
}

function TelegramErrorMessage({
  error,
}: {
  error: string | null;
}) {
  if (!error) return null;

  return (
    <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center space-x-2">
      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
      <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span>
    </div>
  );
}

function TelegramTestResultMessage({
  testResult,
}: {
  testResult: TelegramTestResult | null;
}) {
  if (!testResult) return null;

  return (
    <div className={`p-3 rounded-lg flex items-center space-x-2 ${testResultBoxClass(testResult.success)}`}>
      {testResult.success ? (
        <Check className="w-4 h-4 text-success-600 dark:text-success-400" />
      ) : (
        <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
      )}
      <span className={`text-sm ${testResultTextClass(testResult.success)}`}>
        {testResult.message}
      </span>
    </div>
  );
}

function SaveSuccessMessage({
  saveSuccess,
}: {
  saveSuccess: boolean;
}) {
  if (!saveSuccess) return null;

  return (
    <div className="p-3 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-lg flex items-center space-x-2">
      <Check className="w-4 h-4 text-success-600 dark:text-success-400" />
      <span className="text-sm text-success-600 dark:text-success-400">Settings saved successfully</span>
    </div>
  );
}

function TelegramActions({
  settings,
}: {
  settings: TelegramSettingsState;
}) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-3">
        <Button
          variant="secondary"
          onClick={settings.handleTestConnection}
          disabled={!settings.botToken || !settings.chatId || settings.isTesting}
        >
          {settings.isTesting ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Test
        </Button>
        <Button
          variant="primary"
          onClick={settings.handleSave}
          disabled={settings.isSaving}
        >
          {settings.isSaving ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Check className="w-4 h-4 mr-2" />
          )}
          Save
        </Button>
      </div>
      <TelegramEnabledToggle settings={settings} />
    </div>
  );
}

function TelegramEnabledToggle({
  settings,
}: {
  settings: TelegramSettingsState;
}) {
  return (
    <label className="flex items-center space-x-3 cursor-pointer">
      <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
        {settings.enabled ? 'Enabled' : 'Disabled'}
      </span>
      <Toggle
        checked={!!(settings.enabled && settings.isConfigured)}
        onChange={settings.handleToggleEnabled}
        disabled={!settings.isConfigured}
        color="success"
      />
    </label>
  );
}

function PerWalletTelegramNote({
  isConfigured,
}: {
  isConfigured: boolean;
}) {
  if (!isConfigured) return null;

  return (
    <p className="text-xs text-sanctuary-500 dark:text-sanctuary-500">
      Configure per-wallet notification preferences in each wallet's Settings tab.
    </p>
  );
}

function testResultBoxClass(success: boolean): string {
  return success
    ? 'bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800'
    : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800';
}

function testResultTextClass(success: boolean): string {
  return success
    ? 'text-success-600 dark:text-success-400'
    : 'text-rose-600 dark:text-rose-400';
}
