/**
 * Admin Proxy Test Router
 *
 * Endpoint for testing SOCKS5/Tor proxy connectivity with comprehensive verification.
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('ADMIN:PROXY');

/**
 * POST /api/v1/admin/proxy/test
 * Test SOCKS5/Tor proxy with comprehensive verification:
 * 1. Connect to a .onion address (proves Tor routing works)
 * 2. Check torproject.org to confirm Tor exit and get exit IP
 */
router.post('/proxy/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { host, port, username, password } = req.body;

    // Validation
    if (!host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Proxy host and port are required',
      });
    }

    const proxyPort = parseInt(port.toString(), 10);
    const { SocksClient } = await import('socks');

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
      // Dynamic imports for SOCKS proxy agent and node-fetch
      const socksModule = await import('socks-proxy-agent') as Record<string, unknown>;
      const SocksProxyAgent =
        (socksModule as Record<string, unknown>).SocksProxyAgent ??
        ((socksModule as Record<string, Record<string, unknown>>).default)?.SocksProxyAgent ??
        (socksModule as Record<string, unknown>).default;
      const nodeFetchModule = await import('node-fetch') as Record<string, unknown>;
      const nodeFetchCandidate =
        ((nodeFetchModule as Record<string, Record<string, unknown>>).default)?.default ??
        (nodeFetchModule as Record<string, unknown>).default ??
        nodeFetchModule;
      const nodeFetch =
        typeof nodeFetchCandidate === 'function'
          ? nodeFetchCandidate
          : (typeof (nodeFetchCandidate as Record<string, unknown>)?.default === 'function'
            ? (nodeFetchCandidate as Record<string, unknown>).default
            : undefined);
      if (!nodeFetch) {
        throw new Error('node-fetch did not expose a callable function');
      }

      const proxyUrl = username && password
        ? `socks5://${username}:${password}@${host}:${proxyPort}`
        : `socks5://${host}:${proxyPort}`;

      // @ts-expect-error - SocksProxyAgent constructor is dynamically resolved
      const agent = new SocksProxyAgent(proxyUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      // Use node-fetch which properly supports the agent option for SOCKS proxy
      const response = await (nodeFetch as Function)('https://check.torproject.org/api/ip', {
        agent,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if ((response as Response).ok) {
        const data = await (response as Response).json() as { IsTor: boolean; IP: string };
        isTorExit = data.IsTor;
        exitIp = data.IP;
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
  } catch (error) {
    log.error('Tor verification failed', { error: String(error) });
    res.status(500).json({
      success: false,
      error: 'Tor Verification Failed',
      message: getErrorMessage(error, 'Failed to verify Tor connection'),
    });
  }
});

export default router;
