import { useCallback, useEffect, useRef, useState } from 'react';

interface UseToastDismissParams {
  notificationId: string;
  duration?: number;
  onDismiss: (id: string) => void;
}

export const useToastDismiss = ({
  notificationId,
  duration,
  onDismiss,
}: UseToastDismissParams) => {
  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    if (exitTimeoutRef.current) {
      clearTimeout(exitTimeoutRef.current);
    }
    exitTimeoutRef.current = setTimeout(() => {
      onDismiss(notificationId);
    }, 300);
  }, [notificationId, onDismiss]);

  useEffect(() => {
    if (!duration) return undefined;

    const timer = setTimeout(handleDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, handleDismiss]);

  return { isExiting, handleDismiss };
};
