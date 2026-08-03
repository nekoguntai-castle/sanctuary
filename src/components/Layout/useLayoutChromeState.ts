import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppShortcuts } from '../../hooks/useAppShortcuts';
import * as adminApi from '../../api/admin';
import type { AppCapabilityStatus } from '../../app/capabilities';
import { logError } from '../../utils/errorHandler';
import { createLogger } from '../../utils/logger';

const log = createLogger('Layout');

interface LayoutChromeUser {
  id?: string;
}

export function useLayoutChromeState({
  capabilities,
  user,
}: {
  capabilities: AppCapabilityStatus;
  user: LayoutChromeUser | null;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showKeyboardShortcutsModal, setShowKeyboardShortcutsModal] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyFeedbackTimeoutRef.current) {
      clearTimeout(copyFeedbackTimeoutRef.current);
    }
  }, []);

  const handleVersionClick = useCallback(async () => {
    setShowVersionModal(true);
    if (versionInfo) return;

    setVersionLoading(true);
    try {
      const info = await adminApi.checkVersion();
      setVersionInfo(info);
    } catch (error) {
      logError(log, error, 'Failed to check version');
    } finally {
      setVersionLoading(false);
    }
  }, [versionInfo]);

  const copyToClipboard = useCallback(async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
      setCopiedAddress(type);
      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedAddress(null);
        copyFeedbackTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      logError(log, error, 'Failed to copy to clipboard');
    }
  }, []);

  const openConsole = useCallback(() => {
    if (!capabilities.console) return;
    setIsMobileMenuOpen(false);
    setIsConsoleOpen(true);
  }, [capabilities.console]);

  const closeConsole = useCallback(() => {
    setIsConsoleOpen(false);
  }, []);

  const openKeyboardShortcuts = useCallback(() => {
    setIsMobileMenuOpen(false);
    setShowKeyboardShortcutsModal(true);
  }, []);

  const toggleKeyboardShortcuts = useCallback(() => {
    setIsMobileMenuOpen(false);
    setShowKeyboardShortcutsModal((isOpen) => !isOpen);
  }, []);

  const closeKeyboardShortcuts = useCallback(() => {
    setShowKeyboardShortcutsModal(false);
  }, []);

  const shortcutBindings = useMemo(
    () => [
      {
        id: 'console.open' as const,
        enabled: !!user && !!capabilities.console,
        handler: openConsole,
      },
      {
        id: 'shortcuts.open' as const,
        enabled: !!user,
        handler: toggleKeyboardShortcuts,
      },
    ],
    [capabilities.console, openConsole, toggleKeyboardShortcuts, user],
  );

  useAppShortcuts(shortcutBindings);

  return {
    copiedAddress,
    closeConsole,
    closeKeyboardShortcuts,
    copyToClipboard,
    handleVersionClick,
    isConsoleOpen,
    isMobileMenuOpen,
    openConsole,
    openKeyboardShortcuts,
    setIsMobileMenuOpen,
    setShowVersionModal,
    showKeyboardShortcutsModal,
    showVersionModal,
    versionInfo,
    versionLoading,
  };
}
