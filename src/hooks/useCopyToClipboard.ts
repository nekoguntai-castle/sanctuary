/**
 * useCopyToClipboard Hook
 *
 * Provides clipboard functionality with visual feedback
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { copyToClipboard } from '../utils/clipboard';

export function useCopyToClipboard(resetDelay: number = 2000) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // A pending reset must not outlive the component.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    const success = await copyToClipboard(text);
    if (success && mounted.current) {
      setCopiedText(text);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setCopiedText(null);
      }, resetDelay);
    }
    return success;
  }, [resetDelay]);

  const isCopied = useCallback((text: string) => {
    return copiedText === text;
  }, [copiedText]);

  return { copy, isCopied, copiedText };
}
