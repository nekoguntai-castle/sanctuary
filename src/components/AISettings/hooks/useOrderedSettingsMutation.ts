import { useCallback, useRef } from 'react';
import * as adminApi from '../../../api/admin';

export function useOrderedSettingsMutation() {
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve());

  return useCallback((update: adminApi.SystemSettingsUpdate) => {
    const mutation = mutationTailRef.current.then(() =>
      adminApi.updateSystemSettings(update),
    );
    mutationTailRef.current = mutation.then(
      () => undefined,
      () => undefined,
    );
    return mutation;
  }, []);
}
