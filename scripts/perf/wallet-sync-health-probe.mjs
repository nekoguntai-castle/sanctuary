function classifyRunningState(state) {
  if (state === 'true') return true;
  if (state === 'false') return false;
  throw new Error('Required container running state became unavailable');
}

function sanitizedErrorName(error) {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'Error';
}

export function healthProbeUrl(port, path, environment = process.env) {
  const host = environment.SANCTUARY_DOCKER_PUBLISHED_HOST || '127.0.0.1';
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(host)) throw new Error('Invalid Docker published host');
  const hostname = host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host;
  return new URL(`http://${hostname}:${port}${path}`);
}

export async function collectHealthProbe(port, path, runtime = {}) {
  const request = runtime.request || fetch;
  const wait = runtime.wait
    || (milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)));
  const now = runtime.now || (() => performance.now());
  const started = now();
  const attempts = [];
  const finish = (ok, extra = {}) => ({ path, ok, elapsedMs: now() - started, attempts, ...extra });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await request(healthProbeUrl(port, path), {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status !== 200) {
        attempts.push({ outcome: 'http_error', status: response.status });
        return finish(false);
      }
      await response.arrayBuffer();
      attempts.push({ outcome: 'ok', status: response.status });
      return finish(true);
    } catch (error) {
      const errorName = sanitizedErrorName(error);
      if (errorName === 'TimeoutError' || errorName === 'AbortError') {
        attempts.push({ outcome: 'timeout', error: errorName });
        return finish(false);
      }
      attempts.push({ outcome: 'transport_error', error: errorName });
      if (!(error instanceof TypeError)) return finish(false);
      if (!runtime.running) throw new Error('Required container running state callback is unavailable');
      if (!classifyRunningState(runtime.running())) return finish(false, { subjectStopped: true });
    }
    if (attempt < 3) await wait(100);
  }

  return finish(false);
}
