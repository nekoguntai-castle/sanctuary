import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface DeployResources {
  limits?: {
    cpus?: string;
    memory?: string;
  };
  reservations?: {
    cpus?: string;
    memory?: string;
  };
}

interface ComposeService {
  command?: string[] | string;
  environment?: Record<string, string>;
  volumes?: string[];
  memswap_limit?: string;
  depends_on?: Record<string, { condition?: string }> | string[];
  deploy?: {
    resources?: DeployResources;
  };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
}

const baseCompose = parse(readFileSync('docker-compose.yml', 'utf8')) as ComposeFile;
const prodCompose = parse(readFileSync('docker/compose/prod.yml', 'utf8')) as ComposeFile;
const monitoringCompose = parse(readFileSync('docker/compose/monitoring.yml', 'utf8')) as ComposeFile;
const sslCompose = parse(readFileSync('docker/compose/ssl.yml', 'utf8')) as ComposeFile;
const promtailRaw = readFileSync('docker/monitoring/promtail-config.yml', 'utf8');

function parseMemoryMiB(raw: string | undefined): number {
  if (!raw) throw new Error('Expected memory limit string');
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)([KMG])B?$/i);
  if (!match) throw new Error(`Unsupported memory value: ${raw}`);
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'G') return value * 1024;
  if (unit === 'M') return value;
  return value / 1024;
}

function getPostgresFlagMiB(command: string[] | string | undefined, key: string): number {
  const args = Array.isArray(command) ? command : [];
  const prefix = `${key}=`;
  const entry = args.find((arg) => arg.startsWith(prefix));
  if (!entry) throw new Error(`Missing postgres flag ${key}`);
  return parseMemoryMiB(entry.slice(prefix.length));
}

describe('Compose audit parity contracts', () => {
  describe('P2-18: prod.yml memory alignment with base tuning', () => {
    it('keeps backend prod memory limit above inherited NODE_OPTIONS max-old-space-size', () => {
      const nodeOptions =
        prodCompose.services.backend.environment?.NODE_OPTIONS ??
        baseCompose.services.backend.environment?.NODE_OPTIONS ??
        '';
      const heapMatch = nodeOptions.match(/--max-old-space-size=(\d+)/);
      expect(heapMatch).not.toBeNull();
      const heapMiB = Number(heapMatch![1]);

      const prodMemoryMiB = parseMemoryMiB(
        prodCompose.services.backend.deploy?.resources?.limits?.memory ??
          baseCompose.services.backend.deploy?.resources?.limits?.memory,
      );
      const effectiveMemswapMiB = parseMemoryMiB(
        prodCompose.services.backend.memswap_limit ?? baseCompose.services.backend.memswap_limit,
      );

      expect(prodMemoryMiB).toBeGreaterThan(heapMiB);
      expect(effectiveMemswapMiB).toBeGreaterThanOrEqual(prodMemoryMiB);
    });

    it('keeps postgres prod memory limit aligned with inherited PostgreSQL memory flags', () => {
      const command = prodCompose.services.postgres.command ?? baseCompose.services.postgres.command;
      const sharedBuffersMiB = getPostgresFlagMiB(command, 'shared_buffers');
      const maintenanceWorkMemMiB = getPostgresFlagMiB(command, 'maintenance_work_mem');
      const effectiveCacheSizeMiB = getPostgresFlagMiB(command, 'effective_cache_size');

      const prodMemoryMiB = parseMemoryMiB(
        prodCompose.services.postgres.deploy?.resources?.limits?.memory ??
          baseCompose.services.postgres.deploy?.resources?.limits?.memory,
      );
      const effectiveMemswapMiB = parseMemoryMiB(
        prodCompose.services.postgres.memswap_limit ?? baseCompose.services.postgres.memswap_limit,
      );

      expect(prodMemoryMiB).toBeGreaterThanOrEqual(sharedBuffersMiB + maintenanceWorkMemMiB);
      expect(prodMemoryMiB).toBeGreaterThanOrEqual(effectiveCacheSizeMiB);
      expect(effectiveMemswapMiB).toBeGreaterThanOrEqual(prodMemoryMiB);
    });

    it('keeps every prod service memory limit <= effective memswap_limit', () => {
      for (const [name, prodService] of Object.entries(prodCompose.services)) {
        const baseService = baseCompose.services[name];
        const memoryRaw =
          prodService.deploy?.resources?.limits?.memory ??
          baseService?.deploy?.resources?.limits?.memory;
        const memswapRaw = prodService.memswap_limit ?? baseService?.memswap_limit;
        if (memoryRaw && memswapRaw) {
          expect(
            parseMemoryMiB(memswapRaw),
            `${name} memswap_limit (${memswapRaw}) must be >= memory limit (${memoryRaw})`,
          ).toBeGreaterThanOrEqual(parseMemoryMiB(memoryRaw));
        }
      }
    });
  });

  describe('P2-19: docker-compose.yml env var forwarding for gateway and llm-egress-proxy', () => {
    it('forwards documented FCM, APNS, TLS CA, and logging env vars to gateway', () => {
      const env = baseCompose.services.gateway.environment ?? {};

      expect(env.FCM_PROJECT_ID).toBe('${FCM_PROJECT_ID:-}');
      expect(env.FCM_PRIVATE_KEY).toBe('${FCM_PRIVATE_KEY:-}');
      expect(env.FCM_CLIENT_EMAIL).toBe('${FCM_CLIENT_EMAIL:-}');
      expect(env.APNS_PRIVATE_KEY).toBe('${APNS_PRIVATE_KEY:-}');
      expect(env.TLS_CA_PATH).toBe('${TLS_CA_PATH:-}');
      expect(env.LOG_LEVEL).toBe('${LOG_LEVEL:-info}');
    });

    it('forwards logging, rate-limit, and timeout env vars to llm-egress-proxy', () => {
      const env = baseCompose.services['llm-egress-proxy'].environment ?? {};

      expect(env.LOG_LEVEL).toBe('${LOG_LEVEL:-info}');
      expect(env.AI_RATE_LIMIT_WINDOW_MS).toBe('${AI_RATE_LIMIT_WINDOW_MS:-60000}');
      expect(env.AI_RATE_LIMIT_MAX_REQUESTS).toBe('${AI_RATE_LIMIT_MAX_REQUESTS:-10}');
      expect(env.AI_REQUEST_TIMEOUT_MS).toBe('${AI_REQUEST_TIMEOUT_MS:-30000}');
      expect(env.AI_ANALYSIS_TIMEOUT_MS).toBe('${AI_ANALYSIS_TIMEOUT_MS:-120000}');
    });
  });

  describe('P2-12: monitoring.yml enables OpenTelemetry tracing on worker', () => {
    it('configures worker OTEL environment and healthy jaeger dependency', () => {
      const worker = monitoringCompose.services.worker;
      expect(worker).toBeDefined();
      expect(worker.environment).toMatchObject({
        OTEL_TRACING_ENABLED: 'true',
        OTEL_SERVICE_NAME: 'sanctuary-worker',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger:4318',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http',
      });
      expect(worker.depends_on).toEqual({
        jaeger: {
          condition: 'service_healthy',
        },
      });
    });
  });

  describe('P3-9: SSL overlay precedence and Promtail project-label constraint', () => {
    it('aligns docker/compose/ssl.yml SSL volume precedence with docker-compose.yml', () => {
      expect(sslCompose.services.frontend.volumes).toContain(
        '${SANCTUARY_COMPOSE_SSL_DIR:-${SANCTUARY_SSL_DIR:-./docker/nginx/ssl}}:/etc/nginx/ssl:ro',
      );
    });

    it('documents the single-project label constraint in promtail-config.yml', () => {
      expect(promtailRaw).toContain('com.docker.compose.project=sanctuary');
      expect(promtailRaw).toMatch(/COMPOSE_PROJECT_NAME|single-project/i);
    });
  });
});
