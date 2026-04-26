function getBackendScaleOutProofConfigScript() {
  return `
const proofId = process.env.PHASE3_BACKEND_SCALE_OUT_PROOF_ID || String(Date.now());
const timeoutMs = Number(process.env.PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');
const username = process.env.SANCTUARY_BENCHMARK_USERNAME || 'admin';
const password = process.env.SANCTUARY_BENCHMARK_PASSWORD || 'sanctuary';
const backends = JSON.parse(process.env.PHASE3_BACKEND_SCALE_OUT_TARGETS || '[]');
const fanoutClientCount = Math.max(backends.length * 2, Number(process.env.PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS || '8'));
const proofStartedAt = Date.now();
const walletDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)";

if (backends.length < 2) {
  throw new Error('At least two backend targets are required for backend scale-out proof');
}

const websocketTarget = backends[0];
const triggerTarget = backends.find((target) => target.ip !== websocketTarget.ip) || backends[1];

function backendHttpUrl(target, path) {
  return 'http://' + target.ip + ':3001' + path;
}

function backendWsUrl(target) {
  return 'ws://' + target.ip + ':3001/ws';
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatBody(value) {
  return typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300);
}

function summarizeDurations(values) {
  if (values.length === 0) {
    return { minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    minMs: sorted[0],
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return Math.round((sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight) * 100) / 100;
}
`;
}

function getBackendScaleOutProofApiScript() {
  return `
async function apiJson(target, path, options = {}, expectedStatuses = [200]) {
  const headers = { Accept: 'application/json' };
  let body;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = 'Bearer ' + options.token;
  }

  const response = await fetch(backendHttpUrl(target, path), {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error((options.method || 'GET') + ' ' + path + ' on ' + target.name + ' returned ' + response.status + ': ' + formatBody(parsed));
  }
  // Phase 6: expose Set-Cookie so login callers can read sanctuary_access.
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie');
  return { status: response.status, body: parsed, setCookie };
}

function extractAccessTokenFromSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return null;
  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const cookie of cookies) {
    if (typeof cookie !== 'string') continue;
    if (!cookie.startsWith('sanctuary_access=')) continue;
    const firstAttr = cookie.split(';')[0];
    const value = firstAttr.slice('sanctuary_access='.length);
    if (value) return value;
  }
  return null;
}

async function login(target) {
  const response = await apiJson(target, '/api/v1/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
    },
  });

  if (response.body && typeof response.body === 'object' && response.body.requires2FA) {
    throw new Error('benchmark user requires 2FA; provide a non-2FA local proof user');
  }

  const token = extractAccessTokenFromSetCookie(response.setCookie);
  if (!token) {
    throw new Error('login response from ' + target.name + ' did not include an access token in Set-Cookie');
  }

  return token;
}

async function createProofWallet(target, token) {
  const walletName = 'Phase 3 Scale-Out Wallet ' + proofId;
  const response = await apiJson(target, '/api/v1/wallets', {
    method: 'POST',
    token,
    body: {
      name: walletName,
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet',
      descriptor: walletDescriptor,
    },
  }, [201]);

  if (!response.body || typeof response.body !== 'object' || typeof response.body.id !== 'string') {
    throw new Error('wallet creation response from ' + target.name + ' did not include an id');
  }

  return {
    id: response.body.id,
    name: response.body.name || walletName,
    addressCount: response.body.addressCount ?? null,
  };
}
`;
}

function getBackendScaleOutProofWebSocketScript() {
  return `
function connectSubscribedWebSocket(target, token, walletId, clientIndex) {
  return new Promise((resolve, reject) => {
    const channels = ['wallet:' + walletId, 'wallet:' + walletId + ':sync', 'sync:all'];
    const startedAt = Date.now();
    const socket = new WebSocket(backendWsUrl(target));
    let setupDone = false;
    let eventWait = null;
    let settled = false;

    const setupTimer = setTimeout(() => {
      fail(new Error('websocket setup timeout on ' + target.name));
    }, timeoutMs);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(setupTimer);
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
      reject(error);
    }

    function finishSetup() {
      if (settled) return;
      settled = true;
      setupDone = true;
      clearTimeout(setupTimer);
      resolve({
        clientIndex,
        target,
        channels,
        setupDurationMs: Date.now() - startedAt,
        waitForSyncEvent,
        close: () => {
          try {
            socket.close();
          } catch {
            // Socket may already be closed.
          }
        },
      });
    }

    function waitForSyncEvent() {
      if (!setupDone) {
        return Promise.resolve({ ok: false, error: 'websocket setup did not finish' });
      }

      if (eventWait) {
        return Promise.resolve({ ok: false, error: 'event wait already registered' });
      }

      return new Promise((waitResolve) => {
        const eventStartedAt = Date.now();
        const eventTimer = setTimeout(() => {
          eventWait = null;
          waitResolve({
            clientIndex,
            target,
            ok: false,
            durationMs: Date.now() - eventStartedAt,
            error: 'cross-instance sync event timeout',
          });
        }, timeoutMs);

        eventWait = {
          resolve: (record) => {
            clearTimeout(eventTimer);
            eventWait = null;
            waitResolve({
              clientIndex,
              target,
              durationMs: Date.now() - eventStartedAt,
              ...record,
            });
          },
        };
      });
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', data: { token } }));
    });

    socket.addEventListener('message', (event) => {
      const parsed = parseJson(String(event.data));

      if (
        setupDone
        && eventWait
        && parsed
        && typeof parsed === 'object'
        && parsed.type === 'event'
        && parsed.event === 'sync'
        && (parsed.channel === 'wallet:' + walletId || parsed.channel === 'wallet:' + walletId + ':sync')
      ) {
        eventWait.resolve({
          ok: true,
          event: parsed.event,
          channel: parsed.channel,
          data: parsed.data,
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'authenticated') {
        if (parsed.data && parsed.data.success === false) {
          fail(new Error('websocket authentication failed on ' + target.name));
          return;
        }
        socket.send(JSON.stringify({ type: 'subscribe_batch', data: { channels } }));
        return;
      }

      if (parsed.type === 'subscribed_batch') {
        const subscribed = Array.isArray(parsed.data?.subscribed) ? parsed.data.subscribed : [];
        const errors = Array.isArray(parsed.data?.errors) ? parsed.data.errors : [];
        const required = ['wallet:' + walletId, 'wallet:' + walletId + ':sync'];
        const missing = required.filter((channel) => !subscribed.includes(channel));

        if (missing.length > 0 || errors.length > 0) {
          fail(new Error('subscription failed on ' + target.name + '; missing=' + (missing.join(',') || 'none') + ' errors=' + JSON.stringify(errors)));
          return;
        }

        finishSetup();
        return;
      }

      if (!setupDone && parsed.type === 'error') {
        fail(new Error(parsed.data?.message || 'websocket error message received during setup'));
      }
    });

    socket.addEventListener('error', () => {
      if (!setupDone) {
        fail(new Error('websocket setup error on ' + target.name + ' for client ' + clientIndex));
      } else if (eventWait) {
        eventWait.resolve({ ok: false, error: 'websocket error before sync event' });
      }
    });

    socket.addEventListener('close', () => {
      if (!setupDone) {
        fail(new Error('websocket closed during setup on ' + target.name + ' for client ' + clientIndex));
      } else if (eventWait) {
        eventWait.resolve({ ok: false, error: 'websocket closed before sync event' });
      }
    });
  });
}
`;
}

function getBackendScaleOutProofExecutionScript() {
  return `
const token = await login(triggerTarget);
const wallet = await createProofWallet(triggerTarget, token);
const socketProofs = await Promise.all(
  Array.from({ length: fanoutClientCount }, (_value, index) => (
    connectSubscribedWebSocket(backends[index % backends.length], token, wallet.id, index)
  ))
);
const eventPromises = socketProofs.map((socketProof) => socketProof.waitForSyncEvent());
const triggerStartedAt = Date.now();
const triggerResponse = await apiJson(triggerTarget, '/api/v1/sync/queue/' + encodeURIComponent(wallet.id), {
  method: 'POST',
  token,
  body: { priority: 'high' },
});
const events = await Promise.all(eventPromises);
socketProofs.forEach((socketProof) => socketProof.close());
const successfulEvents = events.filter((eventRecord) => eventRecord.ok);
const failedEvents = events.filter((eventRecord) => !eventRecord.ok);

console.log(JSON.stringify({
  proofId,
  totalDurationMs: Date.now() - proofStartedAt,
  backends,
  websocketTarget,
  triggerTarget,
  wallet,
  websocket: {
    clientCount: socketProofs.length,
    targets: socketProofs.map((socketProof) => ({
      clientIndex: socketProof.clientIndex,
      target: socketProof.target,
      url: backendWsUrl(socketProof.target),
      setupDurationMs: socketProof.setupDurationMs,
      channels: socketProof.channels,
    })),
  },
  trigger: {
    url: backendHttpUrl(triggerTarget, '/api/v1/sync/queue/' + encodeURIComponent(wallet.id)),
    status: triggerResponse.status,
    durationMs: Date.now() - triggerStartedAt,
    body: triggerResponse.body,
  },
  fanout: {
    clientCount: socketProofs.length,
    successes: successfulEvents.length,
    errors: failedEvents.length,
    latency: summarizeDurations(events.map((eventRecord) => eventRecord.durationMs)),
    events,
  },
  event: events[0] || null,
}));
`;
}

export function getBackendScaleOutProofScript() {
  return [
    getBackendScaleOutProofConfigScript(),
    getBackendScaleOutProofApiScript(),
    getBackendScaleOutProofWebSocketScript(),
    getBackendScaleOutProofExecutionScript(),
  ].join('\n');
}
