/**
 * Admin Proxy Test Router
 *
 * Endpoint for testing SOCKS5/Tor proxy connectivity with comprehensive verification.
 */

import { Router } from 'express';
import https from 'node:https';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { SocksClient } from 'socks';

const router = Router();
const log = createLogger('ADMIN_PROXY:ROUTE');
type SocksProxyAgentConstructor = new (proxyUrl: string) => https.Agent;

/**
 * POST /api/v1/admin/proxy/test
 * Test SOCKS5/Tor proxy with comprehensive verification:
 * 1. Connect to a .onion address (proves Tor routing works)
 * 2. Check torproject.org to confirm Tor exit and get exit IP
 */
router.post('/proxy/test', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { host, port, username, password } = req.body;

  // Validation
  if (!host || !port) {
    throw new InvalidInputError('Proxy host and port are required');
  }

  const proxyPort = parseInt(port.toString(), 10);
  // Step 1: Test .onion connectivity (definitive proof Tor works)
  const onionTarget = {
    host: 'explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion',
    port: 143, // TCP Electrum port
  };

  const socksOptions = {
    proxy: {
      host,
      port: proxyPort,
      type: 5 as const,
      ...(username && password ? { userId: username, password } : {}),
    },
    command: 'connect' as const,
    destination: onionTarget,
    timeout: 30000,
  };

  try {
    const { socket } = await SocksClient.createConnection(socksOptions);
    socket.destroy();
  } catch (onionError) {
    log.error('.onion connection failed', { error: String(onionError) });
    return res.status(500).json({
      success: false,
      error: 'Tor Verification Failed',
      message: 'Could not reach .onion address - Tor may not be working',
    });
  }

  // Step 2: Check torproject.org to get exit IP
  let exitIp = 'unknown';
  let isTorExit = false;

  try {
    // Keep dynamic import for ESM package compatibility in CommonJS output.
    const socksProxyAgentModuleId = 'socks-proxy-agent';
    const { SocksProxyAgent } = await import(socksProxyAgentModuleId) as {
      SocksProxyAgent: SocksProxyAgentConstructor;
    };

    const proxyUrl = username && password
      ? `socks5://${username}:${password}@${host}:${proxyPort}`
      : `socks5://${host}:${proxyPort}`;

    const agent = new SocksProxyAgent(proxyUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = https.get(
          'https://check.torproject.org/api/ip',
          { agent, signal: controller.signal },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk; });
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`HTTP ${res.statusCode}`));
              }
            });
          }
        );
        req.on('error', reject);
      });

      const parsed = JSON.parse(body) as { IsTor: boolean; IP: string };
      isTorExit = parsed.IsTor;
      exitIp = parsed.IP;
    } finally {
      clearTimeout(timer);
    }
  } catch (ipError) {
    // Non-fatal - .onion test already passed, just couldn't get exit IP
    log.warn('Could not fetch exit IP from torproject.org', { error: String(ipError) });
  }

  res.json({
    success: true,
    message: isTorExit
      ? `Tor verified! Exit node IP: ${exitIp}`
      : `.onion reachable, but exit check inconclusive. IP: ${exitIp}`,
    exitIp,
    isTorExit,
  });
}));

export default router;
