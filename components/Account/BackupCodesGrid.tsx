import React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { BackupCodesGridProps } from './types';

export const BackupCodesGrid: React.FC<BackupCodesGridProps> = ({
  backupCodes,
  copiedCode,
  codePrefix,
  onCopyToClipboard,
  onCopyAllBackupCodes,
}) => {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {backupCodes.map((code, index) => (
          <button
            key={code}
            onClick={() => onCopyToClipboard(code, `${codePrefix}-${index}`)}
            className="flex items-center justify-between p-2 font-mono text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded hover:border-primary-500 transition-colors"
          >
            <span>{code}</span>
            {copiedCode === `${codePrefix}-${index}` ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-sanctuary-400" />
            )}
          </button>
        ))}
      </div>
      <Button onClick={onCopyAllBackupCodes} variant="secondary" className="w-full">
        {copiedCode === 'all' ? (
          <>
            <Check className="w-4 h-4 mr-2" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-4 h-4 mr-2" />
            Copy All Codes
          </>
        )}
      </Button>
    </>
  );
};
