/**
 * Electrum Connection Module
 *
 * Handles TCP/TLS socket creation, SOCKS5 proxy (Tor) connections,
 * and socket lifecycle management. This module is responsible for
 * establishing the low-level network connection to Electrum servers.
 */

import net from 'net';
import tls from 'tls';
import { SocksClient, SocksClientOptions } from 'socks';
import { createLogger } from '../../../utils/logger';
import type { ProxyConfig } from './types';

const log = createLogger('ELECTRUM');

/**
 * Create a socket connection through a SOCKS5 proxy
 */
export async function createProxiedSocket(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  const socksOptions: SocksClientOptions = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5, // SOCKS5
      ...(proxy.username && proxy.password
        ? { userId: proxy.username, password: proxy.password }
        : {}),
    },
    command: 'connect',
    destination: {
      host: targetHost,
      port: targetPort,
    },
    timeout: timeoutMs,
  };

  log.info(`Connecting through SOCKS5 proxy ${proxy.host}:${proxy.port} to ${targetHost}:${targetPort} (timeout: ${timeoutMs}ms)`);

  const { socket } = await SocksClient.createConnection(socksOptions);
  return socket;
}

/**
 * Create a direct TCP socket connection
 */
export function createDirectSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => resolveSocket(socket));
    socket.once('error', rejectSocket);
  });
}

/**
 * Create a socket connection (direct or via proxy)
 */
export async function createConnection(
  host: string,
  port: number,
  proxy: ProxyConfig | undefined,
  connectionTimeoutMs: number
): Promise<net.Socket> {
  if (proxy?.enabled) {
    return createProxiedSocket(proxy, host, port, connectionTimeoutMs);
  } else {
    return createDirectSocket(host, port);
  }
}

/**
 * Wrap a plain socket in TLS.
 * Returns the TLS socket and a promise that resolves when the TLS handshake completes.
 *
 * Uses the callback-style tls.connect(options, onSecureConnect) to match the
 * original implementation pattern and maintain test compatibility.
 */
export function wrapSocketInTls(
  baseSocket: net.Socket,
  host: string,
  port: number,
  allowSelfSignedCert: boolean,
  isProxied: boolean
): { tlsSocket: tls.TLSSocket; handshakePromise: Promise<void> } {
  if (allowSelfSignedCert) {
    log.warn(`Initiating TLS connection to ${host}:${port} with certificate verification DISABLED (self-signed allowed)${isProxied ? ' via proxy' : ''}`);
  } else {
    log.info(`Initiating TLS connection to ${host}:${port} with certificate verification enabled${isProxied ? ' via proxy' : ''}`);
  }

  let onHandshakeSuccess: () => void;
  let onHandshakeError: (err: Error) => void;

  const handshakePromise = new Promise<void>((resolve, reject) => {
    onHandshakeSuccess = resolve;
    onHandshakeError = reject;
  });

  const tlsSocket = tls.connect(
    {
      socket: baseSocket,
      // Only disable certificate verification if explicitly allowed
      // This protects against MITM attacks by default
      rejectUnauthorized: !allowSelfSignedCert,
      servername: host, // SNI support
      // Enable TLS session resumption for faster reconnects
      session: undefined, // Let Node.js handle session caching
    },
    () => {
      // This callback fires on secureConnect
      log.info(`Connected to ${host}:${port} (ssl) - TLS handshake complete${isProxied ? ' via proxy' : ''}`);

      // Apply socket optimizations after TLS handshake
      // Disable Nagle's algorithm - reduces latency for small packets (JSON-RPC)
      tlsSocket.setNoDelay(true);
      // Enable TCP keepalive - detects dead connections faster (30 second interval)
      tlsSocket.setKeepAlive(true, 30000);

      onHandshakeSuccess();
    }
  );

  tlsSocket.on('error', (err) => {
    log.error(`TLS socket error`, { error: String(err) });
    onHandshakeError(err);
  });

  return { tlsSocket, handshakePromise };
}

/**
 * Apply socket optimizations for a plain TCP connection
 */
export function applySocketOptimizations(socket: net.Socket): void {
  // Disable Nagle's algorithm - reduces latency for small packets (JSON-RPC)
  socket.setNoDelay(true);
  // Enable TCP keepalive - detects dead connections faster (30 second interval)
  socket.setKeepAlive(true, 30000);
}
