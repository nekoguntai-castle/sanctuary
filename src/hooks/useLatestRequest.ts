import { useEffect, useMemo, useRef, useState } from 'react';
import { createRequestOwnership, type FetchToken } from './requestOwnership';

/** Latest-request ownership with cleanup that also supports StrictMode replay. */
export function useLatestRequest() {
  const [ownership] = useState(() => createRequestOwnership('request'));
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ownership.invalidate();
    };
  }, [ownership]);

  return useMemo(() => ({
    begin: () => ownership.beginFetch('request'),
    isCurrent: (token: FetchToken) => mounted.current && ownership.isFetchOwner(token),
    invalidate: ownership.invalidate,
  }), [ownership]);
}
