import React, { useState } from 'react';
import { Button } from '../ui/Button';
import {
  Check,
  Key,
  Copy,
  Eye,
  EyeOff,
  Shield,
  FileText,
  Lock,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { EncryptionKeysResponse } from '../../src/api/admin';

type CopiedKey = string | null;

interface EncryptionKeyDisplayProps {
  encryptionKeys: EncryptionKeysResponse | null;
  isLoadingKeys: boolean;
  keysError: string | null;
  onRevealKeys: (password: string) => Promise<void>;
  showEncryptionKey: boolean;
  setShowEncryptionKey: (show: boolean) => void;
  showEncryptionSalt: boolean;
  setShowEncryptionSalt: (show: boolean) => void;
  copiedKey: string | null;
  copyToClipboard: (text: string, keyName: string) => void;
  downloadEncryptionKeys: () => void;
}

interface SecretFieldProps {
  label: string;
  value: string;
  maskedValue: string;
  isRevealed: boolean;
  onToggle: () => void;
  copiedKey: CopiedKey;
  copyKeyName: string;
  copyToClipboard: (text: string, keyName: string) => void;
}

function EncryptionKeysHeader() {
  return (
    <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 bg-warning-50 dark:bg-warning-900/20">
      <div className="flex items-center space-x-3">
        <div className="p-2 surface-secondary rounded-lg text-warning-600 dark:text-warning-400">
          <Key className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Encryption Keys</h3>
          <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400">Required for restoring backups on a new instance</p>
        </div>
      </div>
    </div>
  );
}

function EncryptionKeysWarning() {
  return (
    <div className="flex items-start space-x-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
      <Shield className="w-4 h-4 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-warning-700 dark:text-warning-300">
        <strong>Important:</strong> These keys encrypt your node passwords and 2FA secrets.
        Without them, encrypted data cannot be restored on a new Sanctuary instance.
        <strong className="block mt-1">Back up these keys along with your backup file!</strong>
      </div>
    </div>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? <Check className="w-4 h-4 text-success-500" /> : <Copy className="w-4 h-4" />;
}

function VisibilityIcon({ isRevealed }: { isRevealed: boolean }) {
  return isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />;
}

function SecretField({
  label,
  value,
  maskedValue,
  isRevealed,
  onToggle,
  copiedKey,
  copyKeyName,
  copyToClipboard,
}: SecretFieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400">
        {label}
      </label>
      <div className="flex items-center space-x-2">
        <div className="flex-1 font-mono text-sm bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg px-3 py-2 text-sanctuary-900 dark:text-sanctuary-100 overflow-x-auto">
          {isRevealed ? value : maskedValue}
        </div>
        <button
          onClick={onToggle}
          className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
          title={isRevealed ? 'Hide' : 'Show'}
        >
          <VisibilityIcon isRevealed={isRevealed} />
        </button>
        <button
          onClick={() => copyToClipboard(value, copyKeyName)}
          className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
          title="Copy to clipboard"
        >
          <CopyIcon copied={copiedKey === copyKeyName} />
        </button>
      </div>
    </div>
  );
}

function KeyActionButtons({
  encryptionKeys,
  copiedKey,
  copyToClipboard,
  downloadEncryptionKeys,
}: Pick<EncryptionKeyDisplayProps, 'encryptionKeys' | 'copiedKey' | 'copyToClipboard' | 'downloadEncryptionKeys'> & {
  encryptionKeys: EncryptionKeysResponse;
}) {
  const combinedKeys = `ENCRYPTION_KEY=${encryptionKeys.encryptionKey}\nENCRYPTION_SALT=${encryptionKeys.encryptionSalt}`;

  return (
    <div className="flex space-x-2">
      <Button
        variant="secondary"
        onClick={() => copyToClipboard(combinedKeys, 'both')}
        className="flex-1"
      >
        {copiedKey === 'both' ? (
          <>
            <Check className="w-4 h-4 mr-2 text-success-500" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-4 h-4 mr-2" />
            Copy Both
          </>
        )}
      </Button>
      <Button
        variant="secondary"
        onClick={downloadEncryptionKeys}
        className="flex-1"
      >
        <FileText className="w-4 h-4 mr-2" />
        Download .txt
      </Button>
    </div>
  );
}

function RevealedKeysPanel({
  encryptionKeys,
  showEncryptionKey,
  setShowEncryptionKey,
  showEncryptionSalt,
  setShowEncryptionSalt,
  copiedKey,
  copyToClipboard,
  downloadEncryptionKeys,
}: Omit<EncryptionKeyDisplayProps, 'isLoadingKeys' | 'keysError' | 'onRevealKeys'> & {
  encryptionKeys: EncryptionKeysResponse;
}) {
  return (
    <div className="space-y-3">
      <SecretField
        label="ENCRYPTION_KEY"
        value={encryptionKeys.encryptionKey}
        maskedValue="••••••••••••••••••••••••••••••••"
        isRevealed={showEncryptionKey}
        onToggle={() => setShowEncryptionKey(!showEncryptionKey)}
        copiedKey={copiedKey}
        copyKeyName="key"
        copyToClipboard={copyToClipboard}
      />
      <SecretField
        label="ENCRYPTION_SALT"
        value={encryptionKeys.encryptionSalt}
        maskedValue="••••••••••••••••••••••••"
        isRevealed={showEncryptionSalt}
        onToggle={() => setShowEncryptionSalt(!showEncryptionSalt)}
        copiedKey={copiedKey}
        copyKeyName="salt"
        copyToClipboard={copyToClipboard}
      />
      <KeyActionButtons
        encryptionKeys={encryptionKeys}
        copiedKey={copiedKey}
        copyToClipboard={copyToClipboard}
        downloadEncryptionKeys={downloadEncryptionKeys}
      />
    </div>
  );
}

function KeysErrorMessage({ keysError }: { keysError: string }) {
  return (
    <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm">{keysError}</span>
    </div>
  );
}

function RevealKeysForm({
  isLoadingKeys,
  keysError,
  onRevealKeys,
}: Pick<EncryptionKeyDisplayProps, 'isLoadingKeys' | 'keysError' | 'onRevealKeys'>) {
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    await onRevealKeys(password);
    setPassword('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
        Enter your password to reveal encryption keys.
      </p>
      <div className="flex space-x-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          className="flex-1 px-3 py-2 rounded-md surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          disabled={isLoadingKeys}
        />
        <Button type="submit" disabled={isLoadingKeys || !password.trim()}>
          {isLoadingKeys ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Lock className="w-4 h-4 mr-2" />
              Reveal
            </>
          )}
        </Button>
      </div>
      {keysError && <KeysErrorMessage keysError={keysError} />}
    </form>
  );
}

export const EncryptionKeyDisplay: React.FC<EncryptionKeyDisplayProps> = ({
  encryptionKeys,
  isLoadingKeys,
  keysError,
  onRevealKeys,
  showEncryptionKey,
  setShowEncryptionKey,
  showEncryptionSalt,
  setShowEncryptionSalt,
  copiedKey,
  copyToClipboard,
  downloadEncryptionKeys,
}) => {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <EncryptionKeysHeader />

      <div className="p-6 space-y-6">
        <EncryptionKeysWarning />

        {encryptionKeys ? (
          <RevealedKeysPanel
            encryptionKeys={encryptionKeys}
            showEncryptionKey={showEncryptionKey}
            setShowEncryptionKey={setShowEncryptionKey}
            showEncryptionSalt={showEncryptionSalt}
            setShowEncryptionSalt={setShowEncryptionSalt}
            copiedKey={copiedKey}
            copyToClipboard={copyToClipboard}
            downloadEncryptionKeys={downloadEncryptionKeys}
          />
        ) : (
          <RevealKeysForm
            isLoadingKeys={isLoadingKeys}
            keysError={keysError}
            onRevealKeys={onRevealKeys}
          />
        )}
      </div>
    </div>
  );
};
