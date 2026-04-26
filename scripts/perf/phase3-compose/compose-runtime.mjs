
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { parseJson } from './common.mjs';

export function createComposeRuntime(context) {
  const {
    repoRoot,
    composeArgs,
    composeEnv,
    sslDir,
    timeoutMs,
    retryMs,
    redactSensitiveText,
  } = context;

  function runDocker(args, options = {}) {
    const result = spawnSync('docker', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: composeEnv,
      maxBuffer: 1024 * 1024 * 40,
      ...options,
    });
  
    if (result.status !== 0) {
      throw new Error([
        redactSensitiveText(`docker ${args.join(' ')} exited with ${result.status}`),
        redactSensitiveText(result.stdout?.trim()),
        redactSensitiveText(result.stderr?.trim()),
      ].filter(Boolean).join('\n'));
    }
  
    return result.stdout || '';
  }
  
  function ensureComposeSslCertificates() {
    const fullchainPath = path.join(sslDir, 'fullchain.pem');
    const privateKeyPath = path.join(sslDir, 'privkey.pem');
    if (existsSync(fullchainPath) && existsSync(privateKeyPath)) {
      return;
    }
  
    mkdirSync(sslDir, { recursive: true });
    const result = spawnSync('bash', ['docker/nginx/ssl/generate-certs.sh', 'localhost'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SANCTUARY_SSL_DIR: sslDir,
      },
      maxBuffer: 1024 * 1024,
    });
  
    if (result.status !== 0) {
      throw new Error(
        `Failed to generate compose SSL certificates in ${sslDir}: ${result.stderr || result.stdout || 'unknown error'}`
      );
    }
  }
  
  function runCompose(args) {
    return runDocker([...composeArgs, ...args]);
  }
  
  function parseJsonLines(output) {
    const trimmed = output.trim();
    if (!trimmed) {
      return [];
    }
  
    if (trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
  
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  
  function collectComposePs(all = false) {
    const args = ['ps'];
    if (all) {
      args.push('--all');
    }
    args.push('--format', 'json');
  
    return parseJsonLines(runCompose(args))
      .map((container) => ({
        service: container.Service,
        state: container.State,
        health: container.Health || '',
        exitCode: container.ExitCode ?? null,
        publishers: container.Publishers || [],
      }));
  }
  
  function getServiceContainerId(serviceName) {
    return runCompose(['ps', '-aq', serviceName]).trim().split('\n').filter(Boolean)[0] || '';
  }
  
  function getServiceContainerIds(serviceName) {
    return runCompose(['ps', '-q', serviceName]).trim().split('\n').filter(Boolean);
  }
  
  function inspectContainer(containerId) {
    const output = runDocker(['inspect', containerId]);
    const inspected = JSON.parse(output);
    if (!inspected?.[0]) {
      throw new Error(`Could not inspect container ${containerId}`);
    }
    return inspected[0];
  }
  
  function inspectContainerState(containerId) {
    return inspectContainer(containerId).State || {};
  }
  
  function getServiceContainers(serviceName) {
    return getServiceContainerIds(serviceName).map((containerId) => {
      const inspected = inspectContainer(containerId);
      return {
        id: containerId,
        shortId: containerId.slice(0, 12),
        name: String(inspected.Name || '').replace(/^\//, ''),
        ip: findComposeNetworkAddress(inspected),
      };
    });
  }
  
  function findComposeNetworkAddress(inspected) {
    const networks = inspected?.NetworkSettings?.Networks || {};
    const entries = Object.entries(networks);
    const entry = entries.find(([name]) => name.endsWith('_sanctuary-network')) || entries[0];
    const ipAddress = entry?.[1]?.IPAddress;
    if (!ipAddress) {
      throw new Error(`Could not find Compose network address for ${inspected?.Name || inspected?.Id || 'container'}`);
    }
    return ipAddress;
  }
  
  async function waitForMigrateExit() {
    const deadline = Date.now() + timeoutMs;
    let latestState = null;
  
    while (Date.now() < deadline) {
      const containerId = getServiceContainerId('migrate');
      if (containerId) {
        latestState = inspectContainerState(containerId);
        if (latestState.Status === 'exited') {
          if (latestState.ExitCode === 0) {
            return latestState;
          }
  
          const logs = runCompose(['logs', '--no-color', '--tail', '200', 'migrate']);
          throw new Error(`migrate exited with ${latestState.ExitCode}\n${logs}`);
        }
      }
  
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  
    throw new Error(`Timed out waiting for migrate service to exit; last state=${JSON.stringify(latestState)}`);
  }
  
  async function waitForComposeHealthy() {
    const deadline = Date.now() + timeoutMs;
    let latestComposePs = [];
    const requiredServices = new Set(['redis', 'postgres', 'worker', 'backend', 'frontend', 'gateway']);
  
    while (Date.now() < deadline) {
      latestComposePs = collectComposePs();
      const seenServices = new Set(latestComposePs.map((container) => container.service));
      const missing = [...requiredServices].filter((service) => !seenServices.has(service));
      const unhealthy = latestComposePs.filter((container) => (
        requiredServices.has(container.service)
        && (container.state !== 'running' || (container.health && container.health !== 'healthy'))
      ));
  
      if (missing.length === 0 && unhealthy.length === 0) {
        return latestComposePs;
      }
  
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  
    const seenServices = new Set(latestComposePs.map((container) => container.service));
    const missing = [...requiredServices].filter((service) => !seenServices.has(service));
    const unhealthy = latestComposePs.filter((container) => (
      requiredServices.has(container.service)
      && (container.state !== 'running' || (container.health && container.health !== 'healthy'))
    ));
    throw new Error(`Unhealthy containers: ${JSON.stringify({ missing, unhealthy })}`);
  }
  
  async function waitForServiceReplicaHealth(serviceName, expectedCount) {
    const deadline = Date.now() + timeoutMs;
    let latestContainers = [];
  
    while (Date.now() < deadline) {
      latestContainers = collectComposePs().filter((container) => container.service === serviceName);
      const unhealthy = latestContainers.filter((container) => (
        container.state !== 'running' || (container.health && container.health !== 'healthy')
      ));
  
      if (latestContainers.length === expectedCount && unhealthy.length === 0) {
        return latestContainers;
      }
  
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  
    const unhealthy = latestContainers.filter((container) => (
      container.state !== 'running' || (container.health && container.health !== 'healthy')
    ));
    throw new Error(`Service ${serviceName} did not reach ${expectedCount} healthy replicas: ${JSON.stringify({ count: latestContainers.length, unhealthy })}`);
  }
  
  function readComposeCaCertificate() {
    const caPath = path.join(sslDir, 'fullchain.pem');
    return existsSync(caPath) ? readFileSync(caPath) : undefined;
  }
  
  function requestText(url) {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const options = {
      headers: { Accept: 'application/json' },
      timeout: 5000,
      ...(parsed.protocol === 'https:' ? { ca: readComposeCaCertificate() } : {}),
    };
  
    return new Promise((resolve, reject) => {
      const req = client(parsed, options, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            ok: response.statusCode ? response.statusCode >= 200 && response.statusCode < 300 : false,
            body,
          });
        });
      });
  
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('HTTP request timeout'));
      });
      req.end();
    });
  }
  
  async function waitForHttpOk(name, url) {
    const deadline = Date.now() + timeoutMs;
    let latestError;
  
    while (Date.now() < deadline) {
      try {
        const response = await requestText(url);
  
        if (response.ok) {
          return {
            status: response.status,
            body: parseJson(response.body),
          };
        }
  
        latestError = new Error(`${name} returned HTTP ${response.status}: ${response.body.slice(0, 200)}`);
      } catch (error) {
        latestError = error;
      }
  
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  
    throw latestError || new Error(`Timed out waiting for ${name}`);
  }

  return {
    runDocker,
    ensureComposeSslCertificates,
    runCompose,
    collectComposePs,
    getServiceContainerId,
    getServiceContainerIds,
    inspectContainer,
    inspectContainerState,
    getServiceContainers,
    waitForMigrateExit,
    waitForComposeHealthy,
    waitForServiceReplicaHealth,
    waitForHttpOk,
  };
}
