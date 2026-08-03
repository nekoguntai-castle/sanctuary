/**
 * TextExportTab
 *
 * Output-descriptor panel for {@link ExportModal}: a read-only textarea plus a
 * copy-to-clipboard button. Extracted to keep the modal body's cyclomatic
 * complexity below threshold; DOM unchanged.
 */

import React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '../../../ui/Button';

interface TextExportTabProps {
  descriptor: string;
  isCopied: (value: string) => boolean;
  onCopy: (value: string) => void;
}

export const TextExportTab: React.FC<TextExportTabProps> = ({
  descriptor,
  isCopied,
  onCopy,
}) => (
  <div className="w-full">
    <label className="block text-xs font-medium text-sanctuary-500 mb-1">
      Output Descriptor
    </label>
    <textarea
      readOnly
      className="w-full h-32 p-3 text-xs font-mono surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded-md resize-none focus:outline-none"
      value={descriptor}
    />
    <Button
      className="w-full mt-4"
      variant={isCopied(descriptor) ? 'primary' : 'secondary'}
      onClick={() => onCopy(descriptor)}
    >
      {isCopied(descriptor) ? (
        <Check className="w-4 h-4 mr-2" />
      ) : (
        <Copy className="w-4 h-4 mr-2" />
      )}
      {isCopied(descriptor) ? 'Copied!' : 'Copy to Clipboard'}
    </Button>
  </div>
);
