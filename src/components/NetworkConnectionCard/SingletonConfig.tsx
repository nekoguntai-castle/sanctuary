import React from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NetworkColors, PresetServer } from './types';

interface SingletonConfigProps {
  singletonHost: string;
  singletonPort: number;
  singletonSsl: boolean;
  colors: NetworkColors;
  presets: PresetServer[];
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  testMessage: string;
  onUpdateConfig: (field: string, value: unknown) => void;
  onTestSingleton: () => void;
}

export const SingletonConfig: React.FC<SingletonConfigProps> = ({
  singletonHost,
  singletonPort,
  singletonSsl,
  colors,
  presets,
  testStatus,
  testMessage,
  onUpdateConfig,
  onTestSingleton,
}) => (
  <div className="space-y-4 p-4 surface-muted rounded-lg">
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2 sm:col-span-1">
        <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Host</label>
        <Input
          type="text"
          value={singletonHost}
          onChange={(e) => onUpdateConfig('singletonHost', e.target.value)}
          className="text-sm"
          placeholder="electrum.example.com"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Port</label>
        <Input
          type="number"
          value={singletonPort}
          onChange={(e) => onUpdateConfig('singletonPort', parseInt(e.target.value, 10) || 50002)}
          className="text-sm"
        />
      </div>
    </div>

    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <label className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Protocol</label>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onUpdateConfig('singletonSsl', true)}
            className={`px-3 py-1 rounded-lg text-sm ${
              singletonSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
            }`}
          >
            SSL
          </button>
          <button
            onClick={() => onUpdateConfig('singletonSsl', false)}
            className={`px-3 py-1 rounded-lg text-sm ${
              !singletonSsl ? `${colors.accent}` : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500'
            }`}
          >
            TCP
          </button>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onTestSingleton}
        disabled={testStatus === 'testing'}
      >
        {testStatus === 'testing' ? (
          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Testing</>
        ) : (
          <>Test Connection</>
        )}
      </Button>
    </div>

    {testMessage && (
      <div className={`p-3 rounded-lg text-sm flex items-center space-x-2 ${
        testStatus === 'success'
          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
      }`}>
        {testStatus === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        <span>{testMessage}</span>
      </div>
    )}

    {/* Presets */}
    <div>
      <label className="block text-xs font-medium text-sanctuary-500 mb-2">Quick Presets</label>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => {
              onUpdateConfig('singletonHost', preset.host);
              onUpdateConfig('singletonPort', preset.port);
              onUpdateConfig('singletonSsl', preset.useSsl);
            }}
            className="px-2 py-1 text-xs rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700"
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  </div>
);
