/**
 * System Collector
 *
 * Collects process uptime, memory usage, Node.js version, and OS info.
 */

import os from 'os';
import { registerCollector } from './registry';

registerCollector('system', async () => {
  const mem = process.memoryUsage();

  return {
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      memoryUsage: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
    },
    os: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptimeSeconds: Math.round(os.uptime()),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      cpuCount: os.cpus().length,
    },
    env: {
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  };
});
