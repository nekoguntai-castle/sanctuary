/**
 * Node API Routes
 *
 * API endpoints for testing connections to Electrum servers
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import net from 'net';
import tls from 'tls';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes } from '../errors/ApiError';

const router = Router();
const log = createLogger('NODE:ROUTE');

const NodeTestBodySchema = z.object({
  nodeType: z.string().optional(),
  host: z.string().min(1),
  port: z.union([z.number(), z.string()]),
  protocol: z.enum(['tcp', 'ssl']),
}).superRefine((data, ctx) => {
  if (data.nodeType && data.nodeType !== 'electrum') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only Electrum connection type is supported',
      path: ['nodeType'],
    });
  }

  const portNum = parseInt(String(data.port), 10);
  if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid port number',
      path: ['port'],
    });
  }
});

const nodeTestValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.message === 'Only Electrum connection type is supported')) {
    return 'Only Electrum connection type is supported';
  }
  if (issues.some(issue => issue.message === 'Invalid port number')) {
    return 'Invalid port number';
  }
  if (issues.some(issue => issue.path === 'protocol')) {
    return 'Missing required field: protocol (tcp or ssl)';
  }
  return 'Missing required fields: host, port';
};

// All routes require authentication
router.use(authenticate);

interface ElectrumTestConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
}

/**
 * Test Electrum server connection
 */
async function testElectrumConnection(config: ElectrumTestConfig): Promise<{ success: boolean; message: string; serverInfo?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const { host, port, protocol } = config;
    let socket: net.Socket | tls.TLSSocket;
    let buffer = '';
    let resolved = false;

    const cleanup = () => {
      if (socket) {
        socket.destroy();
      }
    };

    const handleSuccess = (message: string, serverInfo?: Record<string, unknown>) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: true, message, serverInfo });
      }
    };

    const handleError = (message: string) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, message });
      }
    };

    try {
      // Create socket based on protocol
      if (protocol === 'ssl') {
        socket = tls.connect({
          host,
          port,
          rejectUnauthorized: false, // Allow self-signed certs
          timeout: 10000,
        });
      } else {
        socket = net.connect({
          host,
          port,
          timeout: 10000,
        });
      }

      // Connection timeout
      const timeout = setTimeout(() => {
        handleError('Connection timeout (10 seconds)');
      }, 10000);

      socket.on('connect', () => {
        // Send server.version request
        const request = {
          jsonrpc: '2.0',
          method: 'server.version',
          params: ['Sanctuary', '1.4'],
          id: 1,
        };

        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        // Try to parse JSON response
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line);

            if (response.id === 1) {
              clearTimeout(timeout);

              if (response.error) {
                handleError(`Electrum error: ${response.error.message}`);
              } else if (response.result) {
                const serverInfo = {
                  server: response.result[0] || 'Unknown',
                  protocol: response.result[1] || 'Unknown',
                };
                handleSuccess(
                  `Connected to ${serverInfo.server} (protocol ${serverInfo.protocol})`,
                  serverInfo
                );
              } else {
                handleSuccess('Connected successfully');
              }
            }
          } catch (e) {
            log.debug('Waiting for complete Electrum server JSON response', { error: getErrorMessage(e) });
            // Not valid JSON yet, wait for more data
          }
        }
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timeout);
        handleError(`Connection failed: ${error.message}`);
      });

      socket.on('timeout', () => {
        clearTimeout(timeout);
        handleError('Connection timeout');
      });

    } catch (error) {
      handleError(`Connection error: ${getErrorMessage(error)}`);
    }
  });
}

/**
 * POST /api/v1/node/test
 * Test connection to an Electrum server
 */
router.post('/test', validate(
  { body: NodeTestBodySchema },
  { message: nodeTestValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { nodeType, host, port, protocol } = req.body;

  log.debug('Testing connection', { nodeType, host, port, protocol });

  const portNum = parseInt(port, 10);

  const result = await testElectrumConnection({
    host,
    port: portNum,
    protocol: protocol as 'tcp' | 'ssl',
  });

  log.debug('Test result', { result });
  res.json(result);
}));

export default router;
