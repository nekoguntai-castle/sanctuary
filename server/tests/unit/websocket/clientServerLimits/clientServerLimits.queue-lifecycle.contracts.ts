import { expect, it, vi } from 'vitest';
import { activeServers, createClient, loadServer } from './clientServerLimitsTestHarness';
import type { AuthenticatedWebSocket } from '../../../../src/websocket/types';

interface QueueLifecycleServer {
  clients: Set<AuthenticatedWebSocket>;
  sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean;
  handleDisconnect(client: AuthenticatedWebSocket): void;
  revokeClient(client: AuthenticatedWebSocket): void;
}

export function registerQueueLifecycleContracts() {
  it.each(['disconnect', 'unregistered-disconnect', 'revoke', 'shutdown'] as const)(
    'retires pending sends before %s can leave the transport appearing open', async action => {
      const Server = await loadServer();
      const server = new Server();
      activeServers.push(server);
      const internal = server as unknown as QueueLifecycleServer;
      const callbacks: Array<() => void> = [];
      const client = createClient({
        send: vi.fn((_message: string, callback: () => void) => callbacks.push(callback)),
      });
      if (action !== 'unregistered-disconnect') internal.clients.add(client);
      internal.sendToClient(client, 'first');
      internal.sendToClient(client, 'pending');
      client.close.mockImplementation(() => {
        expect(client.isQueueStopped).toBe(true);
        expect(client.messageQueue).toEqual([]);
      });
      if (action === 'shutdown') server.close();
      else if (action === 'revoke') internal.revokeClient(client);
      else internal.handleDisconnect(client);
      callbacks[0]();
      await Promise.resolve();
      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.isQueueStopped).toBe(true);
      expect(client.messageQueue).toEqual([]);
      expect(internal.sendToClient(client, 'late')).toBe(false);
    },
  );
}
