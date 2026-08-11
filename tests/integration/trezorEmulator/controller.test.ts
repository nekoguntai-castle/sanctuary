import net, { type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { closeBridgeProxy, startLocalBridgeProxy } from './controller';

const originalBridgeHost = process.env.TREZOR_EMULATOR_BRIDGE_HOST;
const originalBridgePort = process.env.TREZOR_EMULATOR_BRIDGE_PORT;

const listenOnEphemeralPort = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address');
  return address.port;
};

const waitForClose = (socket: Socket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once('close', () => resolve());
  });

afterEach(() => {
  if (originalBridgeHost === undefined) delete process.env.TREZOR_EMULATOR_BRIDGE_HOST;
  else process.env.TREZOR_EMULATOR_BRIDGE_HOST = originalBridgeHost;
  if (originalBridgePort === undefined) delete process.env.TREZOR_EMULATOR_BRIDGE_PORT;
  else process.env.TREZOR_EMULATOR_BRIDGE_PORT = originalBridgePort;
});

describe('Trezor emulator bridge proxy', () => {
  it('destroys live client and upstream sockets before closing', async () => {
    let acceptUpstream: ((socket: Socket) => void) | undefined;
    const upstreamAccepted = new Promise<Socket>((resolve) => {
      acceptUpstream = resolve;
    });
    const upstreamServer = net.createServer((socket) => acceptUpstream?.(socket));
    const upstreamPort = await listenOnEphemeralPort(upstreamServer);
    process.env.TREZOR_EMULATOR_BRIDGE_HOST = '127.0.0.1';
    process.env.TREZOR_EMULATOR_BRIDGE_PORT = String(upstreamPort);

    const proxy = await startLocalBridgeProxy();
    expect(proxy).not.toBeNull();
    const client = net.connect(21_325, '127.0.0.1');
    client.on('error', () => undefined);
    const upstream = await upstreamAccepted;
    upstream.on('error', () => undefined);
    const clientClosed = waitForClose(client);
    const upstreamClosed = waitForClose(upstream);

    await closeBridgeProxy(proxy);
    await Promise.all([clientClosed, upstreamClosed]);

    expect(client.destroyed).toBe(true);
    expect(upstream.destroyed).toBe(true);
    await new Promise<void>((resolve, reject) =>
      upstreamServer.close((error) => (error ? reject(error) : resolve()))
    );
  });
});
