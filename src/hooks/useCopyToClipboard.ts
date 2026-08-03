/**
 * useCopyToClipboard Hook
 *
 * Provides clipboard functionality with visual feedback
 */

import { useState, useCallback } from 'react';
import { copyToClipboard } from '../utils/clipboard';

export function useCopyToClipboard(resetDelay: number = 2000) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copy = useCallback(async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), resetDelay);
    }
    return success;
  }, [resetDelay]);

  const isCopied = useCallback((text: string) => {
    return copiedText === text;
  }, [copiedText]);

  return { copy, isCopied, copiedText };
}
