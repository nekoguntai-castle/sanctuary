import net, { type Server, type Socket } from 'node:net';

const BRIDGE_PROXY_CLOSE_TIMEOUT_MS = 2_000;
const bridgeProxySockets = new WeakMap<Server, Set<Socket>>();

export interface ControllerResponse extends Record<string, unknown> {
  id?: unknown;
  success?: unknown;
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required Trezor emulator environment ${name}`);
  return value;
}

export async function controllerCommand(
  payload: Record<string, unknown> & { id: number }
): Promise<ControllerResponse> {
  const url = requiredEnvironment('TREZOR_EMULATOR_CONTROLLER_URL');
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url);
    let sent = false;
    let finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      websocket.close();
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error(`Trezor controller timed out for ${String(payload.type)}`));
    }, 10_000);
    websocket.addEventListener('error', () =>
      fail(new Error('Trezor controller websocket failed'))
    );
    websocket.addEventListener('message', (event) => {
      if (!sent) {
        sent = true;
        websocket.send(JSON.stringify(payload));
        return;
      }
      let response: ControllerResponse;
      try {
        response = JSON.parse(String(event.data)) as ControllerResponse;
      } catch {
        fail(new Error(`Trezor controller returned malformed JSON for ${String(payload.type)}`));
        return;
      }
      if (response.id !== payload.id) {
        fail(
          new Error(
            `Trezor controller response id ${String(response.id)} differs from request ${payload.id}`
          )
        );
        return;
      }
      if (response.success !== true) {
        fail(
          new Error(
            `Trezor controller rejected ${String(payload.type)}: ${JSON.stringify(response)}`
          )
        );
        return;
      }
      finished = true;
      clearTimeout(timeout);
      websocket.close();
      resolve(response);
    });
  });
}

export async function confirmOnEmulator<T>(operation: Promise<T>, idBase: number): Promise<T> {
  let settled = false;
  void operation
    .finally(() => {
      settled = true;
    })
    .catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !settled; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (!settled) {
      await controllerCommand({
        type: 'emulator-press-yes',
        id: idBase + attempt,
      });
    }
  }
  return operation;
}

export async function startLocalBridgeProxy(): Promise<Server | null> {
  const host = requiredEnvironment('TREZOR_EMULATOR_BRIDGE_HOST');
  const port = Number(requiredEnvironment('TREZOR_EMULATOR_BRIDGE_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Trezor emulator bridge port: ${String(port)}`);
  }
  if ((host === '127.0.0.1' || host === 'localhost') && port === 21_325) return null;
  const sockets = new Set<Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(port, host);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.once('error', closeBoth);
    upstream.once('error', closeBoth);
    client.once('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.once('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
  });
  bridgeProxySockets.set(server, sockets);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(21_325, '127.0.0.1', resolve);
  });
  return server;
}

export async function closeBridgeProxy(server: Server | null): Promise<void> {
  if (!server) return;
  const sockets = bridgeProxySockets.get(server);
  const closeResult = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out closing Trezor bridge proxy')),
      BRIDGE_PROXY_CLOSE_TIMEOUT_MS
    );
    server.close((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
  });
  sockets?.forEach((socket) => socket.destroy());
  try {
    await closeResult;
  } finally {
    sockets?.clear();
    bridgeProxySockets.delete(server);
  }
}
