import { getApiBaseUrl, joinApiBaseUrl } from './baseUrl';

export const API_HEALTH_TIMEOUT_MS = 5_000;

type ApiHealthOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type AbortSignalHandle = {
  signal: AbortSignal;
  cleanup: () => void;
};

function createAbortSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignalHandle {
  const controller = new AbortController();
  const abort = () => controller.abort();

  const timer = setTimeout(abort, Math.max(0, timeoutMs));

  if (externalSignal?.aborted) {
    abort();
  } else {
    externalSignal?.addEventListener('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    },
  };
}

export function isConnectedHealthResponse(response: Pick<Response, 'ok' | 'status'>): boolean {
  return response.ok || response.status === 401;
}

export async function checkApiHealth({
  fetchImpl = fetch,
  signal,
  timeoutMs = API_HEALTH_TIMEOUT_MS,
}: ApiHealthOptions = {}): Promise<boolean> {
  const abortSignal = createAbortSignal(signal, timeoutMs);

  try {
    const response = await fetchImpl(
      joinApiBaseUrl(getApiBaseUrl(), '/health'),
      {
        method: 'GET',
        credentials: 'include',
        signal: abortSignal.signal,
      },
    );

    return isConnectedHealthResponse(response);
  } finally {
    abortSignal.cleanup();
  }
}
