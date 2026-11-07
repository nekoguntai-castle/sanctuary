#!/usr/bin/env node
// Execute a caller-selected test command against Chromium in a no-socket sibling.
import { createHash, randomUUID } from 'node:crypto';
import { formatBrowserError, createBrowserErrorRedactor } from '../lib/browser-sandbox-contract.mjs';
import { browserCpuNotice } from './forward-live-annotations.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname as systemHostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertSeccompBrowserContainer,
  BROWSER_CONTAINER_RESOURCES,
  createSeccompBrowserPayload,
  requestBrowserEngineApi,
  runBrowserEngineCli
} from './lib/browser-container-security.mjs';
import {
  assertOwnedBrowserContainer,
  browserContainerOwnershipLabels,
  loadBrowserContainerOwnership,
  recoverBrowserContainerId,
  registerBrowserContainer,
  registerAndReinspectBrowserContainer,
  retireBrowserContainer,
  RUNNER_OWNED_LABEL,
} from './lib/browser-container-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = 'nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright:pw1.64.1-chrome157.0.8103.38-sandbox1@sha256:cf627d37888e1ba12e70a73457fb1a226bd24b6a722892af17752b0c9a09a443';
const PROFILE_FILE = path.join(ROOT, 'config/ci/browser-seccomp/podman-chromium.json');
const IMAGE_USER = '1000:1000';
const READY_PREFIX = 'SANCTUARY_BROWSER_SERVER_READY=';
const OWNED_LABEL = RUNNER_OWNED_LABEL;

function errorMessage(error) { return formatBrowserError(error); }

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('operation was cancelled');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function signalProcessGroup(child, signalName) {
  try { process.kill(-child.pid, signalName); }
  catch (error) { if (error.code !== 'ESRCH') child.kill(signalName); }
}

function createAbortRelay(parentSignal) {
  const controller = new AbortController();
  const relay = () => controller.abort(abortReason(parentSignal));
  if (parentSignal?.aborted) relay();
  else parentSignal?.addEventListener('abort', relay, { once: true });
  return {
    signal: controller.signal,
    abort: error => controller.abort(error),
    dispose: () => parentSignal?.removeEventListener('abort', relay)
  };
}

export function engineSocketFromEnv(env = process.env) {
  const endpoint = env.DOCKER_HOST || 'unix:///var/run/docker.sock';
  const match = /^unix:\/\/(.+)$/.exec(endpoint);
  if (!match || !path.isAbsolute(match[1])) throw new Error('sandboxed Playwright requires a local Unix socket Docker-compatible engine endpoint');
  return match[1];
}

export function parseCommand(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) throw new Error('usage: run-sandboxed-playwright.mjs -- <command> [args...]');
  return argv.slice(separator + 1);
}

export function createBrowserPayload({ image = IMAGE, profile, profileHash, networkContainerId, runId, env, ownership }) {
  if (image !== IMAGE) throw new Error('browser image differs from the reviewed immutable Sanctuary sandbox1 digest');
  if (!/^[a-f0-9]{64}$/.test(profileHash ?? '') || profile !== `/etc/forgejo-runner/browser-seccomp/${profileHash}.json`) {
    throw new Error('seccomp profile must use the installed, hash-named managed path');
  }
  if (!/^[a-f0-9]{64}$/.test(networkContainerId ?? '') || !/^[a-f0-9-]{36}$/.test(runId ?? '')) {
    throw new Error('owned runner container ID or run ID is invalid');
  }
  if (!ownership) throw new Error('browser container ownership authority is required');
  return createSeccompBrowserPayload({
    image,
    user: IMAGE_USER,
    env,
    command: ['node', '/tmp/browser-server.mjs'],
    labels: {
      [OWNED_LABEL]: 'v1', 'com.example.sanctuary.run-id': runId,
      ...browserContainerOwnershipLabels(ownership),
    },
    profile,
    networkMode: `container:${networkContainerId}`,
    resources: BROWSER_CONTAINER_RESOURCES
  });
}

export function assertOuterContainer(inspect, hostname) {
  if (!containerIdentityMatches(inspect, hostname) || inspect?.State?.Running !== true || !runnerNetworkIsUsable(inspect?.HostConfig?.NetworkMode)) {
    throw new Error('HOSTNAME did not resolve to this running, networked orchestration container');
  }
  return inspect.Id.toLowerCase();
}

function containerIdentityMatches(inspect, hostname) {
  const id = inspect?.Id;
  return /^[a-f0-9]{12,64}$/i.test(id ?? '') && id.toLowerCase().startsWith(hostname.toLowerCase()) && inspect?.Config?.Hostname === hostname;
}

export function resolveOuterHostname(environmentHostname, kernelHostname = systemHostname()) {
  const envHost = environmentHostname?.trim();
  const kernelHost = kernelHostname?.trim();
  if (envHost && kernelHost && envHost.toLowerCase() !== kernelHost.toLowerCase()) {
    throw new Error('HOSTNAME does not match the kernel hostname');
  }
  const host = envHost || kernelHost;
  if (!/^[a-f0-9]{12,64}$/i.test(host ?? '')) {
    throw new Error('kernel hostname does not identify a Docker orchestration container');
  }
  return host;
}

function runnerNetworkIsUsable(networkMode) {
  return Boolean(networkMode) && networkMode !== 'host' && networkMode !== 'none';
}

export function assertBrowserChild(inspect, { profile, outerId, imageId }) {
  assertSeccompBrowserContainer(inspect, {
    imageId,
    user: IMAGE_USER,
    profile,
    networkMode: `container:${outerId}`,
    resources: BROWSER_CONTAINER_RESOURCES
  });
}

const requestJson = requestBrowserEngineApi;
const docker = runBrowserEngineCli;

function dockerAttached(socket, containerId, onReady, { signal } = {}) {
  throwIfAborted(signal);
  let child;
  let childClosed = false;
  let forceKill;
  const cancel = (signalName = 'SIGTERM') => {
    if (!child || childClosed) return;
    signalProcessGroup(child, signalName);
    forceKill = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), 1_000);
  };
  const promise = new Promise((resolve, reject) => {
    child = spawn('docker', ['--host', `unix://${socket}`, 'start', '--attach', containerId], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdoutBuffer = ''; let ready = false; let stderr = '';
    const stderrRedactor = createBrowserErrorRedactor(text => { stderr = `${stderr}${text}`.slice(-2000); process.stderr.write(text); });
    const handleLine = line => {
      if (!ready && line.startsWith(READY_PREFIX)) {
        try {
          const record = JSON.parse(line.slice(READY_PREFIX.length));
          if (!/^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(record.endpoint) || record.evidence?.policy?.uid !== 1000 || record.evidence?.policy?.noNewPrivs !== 1) {
            throw new Error('browser server readiness record is invalid');
          }
          ready = true; onReady(record.endpoint);
        } catch (error) { reject(error); cancel(); }
      } else process.stdout.write(`${formatBrowserError(line)}\n`);
    };
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n'); stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line.replace(/\r$/, ''));
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderrRedactor.write(chunk); });
    child.once('error', error => { childClosed = true; reject(error); });
    child.once('close', code => {
      stderrRedactor.flush();
      childClosed = true;
      clearTimeout(forceKill);
      if (stdoutBuffer) handleLine(stdoutBuffer);
      if (!ready) reject(new Error(`sandboxed browser server exited before readiness (code ${code}): ${stderr.slice(-2000)}`));
      else resolve(code);
    });
  });
  promise.cancel = cancel;
  return promise;
}

async function runCommand(args, env, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: ['inherit', 'pipe', 'pipe'], detached: true });
    const stdoutRedactor = createBrowserErrorRedactor(text => process.stdout.write(text));
    const stderrRedactor = createBrowserErrorRedactor(text => process.stderr.write(text));
    child.stdout.setEncoding('utf8').on('data', chunk => stdoutRedactor.write(chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => stderrRedactor.write(chunk));
    let cancelled = false;
    let cancellationReason;
    let forceKillPromise;
    const cancel = reason => {
      if (cancelled) return;
      cancelled = true;
      cancellationReason = reason;
      signalProcessGroup(child, 'SIGTERM');
      forceKillPromise = new Promise(resolveKill => setTimeout(() => {
        signalProcessGroup(child, 'SIGKILL');
        resolveKill();
      }, 1_000));
    };
    const timeout = setTimeout(() => cancel(new Error('test command exceeded the 45 minute deadline')), 45 * 60_000);
    const abort = () => cancel(abortReason(signal));
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', error => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      stdoutRedactor.flush();
      stderrRedactor.flush();
      reject(error);
    });
    child.once('close', (code, childSignal) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      stdoutRedactor.flush();
      stderrRedactor.flush();
      if (signal?.aborted && !cancelled) cancel(abortReason(signal));
      if (cancelled) {
        void forceKillPromise.then(() => reject(cancellationReason ?? new Error('test command was cancelled')));
      } else resolve({ code: code ?? 1, signal: childSignal });
    });
  });
}

async function verifyImage(socket, command = docker) {
  const { stdout } = await command(socket, ['image', 'inspect', IMAGE]);
  const image = JSON.parse(stdout)[0];
  const repository = IMAGE.split('@')[0];
  const digest = IMAGE.split('@')[1];
  if (!image?.Id || !Array.isArray(image.RepoDigests) || !image.RepoDigests.some(value => value.split('@')[0] === repository.split(':')[0] && value.endsWith(`@${digest}`)) || image.Config?.User !== IMAGE_USER) {
    throw new Error('pinned browser image digest or default UID does not match inspected image');
  }
  const env = new Map((image.Config.Env ?? []).map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
  if (env.get('PLAYWRIGHT_VERSION') !== '1.64.1' || env.get('CHROME_VERSION') !== '157.0.8103.38' || env.get('SANDBOX_POLICY_REVISION') !== '1' || !path.isAbsolute(env.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH') ?? '')) {
    throw new Error('pinned browser image environment differs from the reviewed browser toolchain');
  }
  return { id: image.Id, env: [...env].map(([key, value]) => `${key}=${value}`).filter(value => /^(CHROME_VERSION|PLAYWRIGHT_VERSION|PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH|SANDBOX_POLICY_REVISION|PATH|HOME|PLAYWRIGHT_BROWSERS_PATH)=/.test(value)) };
}

function verifyClientVersion() {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const version = require('playwright/package.json').version;
  if (version !== '1.64.1') throw new Error(`outer Playwright client ${version} does not match pinned image version 1.64.1`);
}

async function startTest(args, endpoint, signal) {
  return runCommand(args, { ...process.env, SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: endpoint }, signal);
}

async function readReviewedProfile() {
  const profileBytes = await readFile(PROFILE_FILE);
  const profileHash = createHash('sha256').update(profileBytes).digest('hex');
  const profilePath = `/etc/forgejo-runner/browser-seccomp/${profileHash}.json`;
  const profile = JSON.parse(profileBytes);
  if (profileHash !== '97fa67ad55ffa98b8fd918b8cd8693e8f5c2a409962318d9d02e33c72b58f363' || !['SCMP_ACT_ERRNO', 'SCMP_ACT_KILL', 'SCMP_ACT_KILL_PROCESS', 'SCMP_ACT_KILL_THREAD'].includes(profile.defaultAction)) {
    throw new Error('reviewed Podman Chromium seccomp policy is invalid or has changed');
  }
  return { profilePath, profileHash };
}

async function prepareSandbox(env, command, now, kernelHostname, ownershipLoader) {
  const ownership = ownershipLoader(env);
  const socket = engineSocketFromEnv(env);
  if (ownership.engineEndpoint !== `unix://${socket}`) {
    throw new Error('sandboxed browser socket does not match the coordinator-resolved Docker context endpoint');
  }
  const { profilePath, profileHash } = await readReviewedProfile();
  const host = resolveOuterHostname(env.HOSTNAME, kernelHostname());
  const outerResult = await command(socket, ['inspect', host]);
  const outerId = assertOuterContainer(JSON.parse(outerResult.stdout)[0], host);
  const image = await verifyImage(socket, command);
  verifyClientVersion();
  const runId = randomUUID();
  const output = path.resolve(env.SANCTUARY_E2E_OUTPUT_DIR || 'test-results');
  const reportDirectory = path.join(output, `.sandbox-browser-${runId}`);
  const reportFile = path.join(reportDirectory, 'browser-server-report.json');
  await mkdir(output, { recursive: true });
  const name = `sanctuary-browser-${runId}`;
  const payload = createBrowserPayload({ profile: profilePath, profileHash, networkContainerId: outerId, runId, env: image.env, ownership });
  const report = { startedAt: new Date(now()).toISOString(), image: IMAGE, imageId: image.id, outerId, profile: profilePath, containerId: null, endpoint: null, exitCode: null, errors: [] };
  return { socket, profilePath, outerId, image, runId, ownership, output, reportDirectory, reportFile, name, payload, report, containerId: null };
}

const CPU_STATS_TIMEOUT_MS = 3_000;

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`engine stats field ${name} is missing or invalid`);
  return value;
}

// Best-effort evidence for the CPU quota: never throws and is bounded so it cannot delay cleanup.
export async function readBrowserCpuThrottling(context, api, timeoutMs = CPU_STATS_TIMEOUT_MS) {
  if (!context.containerId || !context.endpoint) return { cpuThrottling: null, reason: 'browser container never started' };
  let timer;
  try {
    const stats = await Promise.race([
      api(context.socket, 'GET', `/v1.41/containers/${context.containerId}/stats?stream=false&one-shot=true`, undefined, timeoutMs),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`engine stats timed out after ${timeoutMs}ms`)), timeoutMs); })
    ]);
    const throttling = stats?.cpu_stats?.throttling_data;
    return {
      cpuThrottling: {
        usage_usec: Math.floor(nonNegativeInteger(stats?.cpu_stats?.cpu_usage?.total_usage, 'cpu_usage.total_usage') / 1000),
        nr_throttled: nonNegativeInteger(throttling?.throttled_periods, 'throttling_data.throttled_periods'),
        throttled_usec: Math.floor(nonNegativeInteger(throttling?.throttled_time, 'throttling_data.throttled_time') / 1000)
      }
    };
  } catch (error) {
    return { cpuThrottling: null, reason: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

function printCpuThrottling(throttling) {
  process.stdout.write(`${browserCpuNotice(throttling)}\n`);
}

async function createOwnedBrowserContainer(context, api, command, signal, registerContainer) {
  throwIfAborted(signal);
  let created;
  let createFailure;
  try { created = await api(context.socket, 'POST', `/v1.41/containers/create?name=${context.name}`, context.payload); }
  catch (error) { createFailure = error; }
  if (!/^[a-f0-9]{64}$/i.test(created?.Id ?? '')) {
    createFailure ??= new Error('engine returned an invalid browser sibling ID');
    context.containerId = await recoverBrowserContainerId(context, api, createFailure);
    context.report.containerId = context.containerId;
    await registerAndReinspectBrowserContainer(context, api, registerContainer, assertBrowserChild);
    throw createFailure;
  }
  context.containerId = created.Id;
  context.report.containerId = context.containerId;
  throwIfAborted(signal);
  const inspectResult = await command(context.socket, ['inspect', context.containerId]);
  const inspected = JSON.parse(inspectResult.stdout)[0];
  assertOwnedBrowserContainer(context, inspected);
  assertBrowserChild(inspected, { profile: context.profilePath, outerId: context.outerId, imageId: context.image.id });
  await registerAndReinspectBrowserContainer(context, api, registerContainer, assertBrowserChild);
  await command(context.socket, ['cp', path.join(ROOT, 'scripts/ci/browser-server.mjs'), `${context.containerId}:/tmp/browser-server.mjs`]);
  await command(context.socket, ['cp', path.join(ROOT, 'scripts/lib/browser-sandbox-contract.mjs'), `${context.containerId}:/tmp/browser-sandbox-contract.mjs`]);
}

async function waitForBrowserEndpoint(context, attachPromise, signal, onEndpoint) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const fail = finish(reject);
    const ready = finish(resolve);
    const onAbort = () => fail(abortReason(signal));
    const deadline = setTimeout(() => fail(new Error('browser server did not become ready within 45 seconds')), 45_000);
    attachPromise.then(() => {
      if (!context.endpoint) fail(new Error('browser server exited before readiness'));
    }, fail);
    signal?.addEventListener('abort', onAbort, { once: true });
    const poll = () => context.endpoint ? ready() : !settled && setTimeout(poll, 25);
    poll();
  });
  onEndpoint(context.endpoint);
}

async function startBrowserServer(context, attach, signal) {
  throwIfAborted(signal);
  context.attachPromise = attach(context.socket, context.containerId, endpoint => {
    context.endpoint = endpoint;
    context.report.endpoint = '127.0.0.1:<dynamic> (token redacted)';
  }, { signal });
  await waitForBrowserEndpoint(context, context.attachPromise, signal, () => {});
}

async function runClientWithServerGuard(args, context, runTest, parentSignal) {
  const relay = createAbortRelay(parentSignal);
  let deliberateShutdown = false;
  const serverExit = context.attachPromise.then(code => {
    if (deliberateShutdown) return;
    const error = new Error(`sandboxed browser server exited unexpectedly with code ${code}`);
    relay.abort(error);
    throw error;
  }, error => {
    if (deliberateShutdown) return;
    relay.abort(error);
    throw new Error(`sandboxed browser server attachment failed during the test: ${errorMessage(error)}`, { cause: error });
  });
  const cancellation = new Promise((_, reject) => {
    if (relay.signal.aborted) reject(abortReason(relay.signal));
    else relay.signal.addEventListener('abort', () => reject(abortReason(relay.signal)), { once: true });
  });
  try {
    const commandResult = await Promise.race([runTest(args, context.endpoint, relay.signal), serverExit, cancellation]);
    throwIfAborted(relay.signal);
    deliberateShutdown = true;
    return commandResult;
  } finally {
    deliberateShutdown = true;
    relay.dispose();
  }
}

async function runInheritedEndpoint(args, endpoint, runTest, signal) {
  if (!/^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/.test(endpoint)) throw new Error('inherited Playwright endpoint must be a loopback browser-server websocket');
  const result = await runTest(args, endpoint, signal);
  throwIfAborted(signal);
  return { ok: result.code === 0, reusedEndpoint: true, exitCode: result.code };
}

export async function runSandboxedPlaywright(args, { env = process.env, api = requestJson, command = docker, attach = dockerAttached, runTest = startTest, now = Date.now, kernelHostname = systemHostname, ownershipLoader = loadBrowserContainerOwnership, registerContainer = registerBrowserContainer, signal } = {}) {
  throwIfAborted(signal);
  const inheritedEndpoint = env.SANCTUARY_PLAYWRIGHT_WS_ENDPOINT;
  if (inheritedEndpoint) return runInheritedEndpoint(args, inheritedEndpoint, runTest, signal);
  const context = await prepareSandbox(env, command, now, kernelHostname, ownershipLoader);
  let failure;
  let cleanupFailure;
  try {
    await createOwnedBrowserContainer(context, api, command, signal, registerContainer);
    await startBrowserServer(context, attach, signal);
    const commandResult = await runClientWithServerGuard(args, context, runTest, signal);
    context.report.exitCode = commandResult.code;
  } catch (error) {
    failure = error;
  } finally {
    const throttling = await readBrowserCpuThrottling(context, api);
    context.report.cpuThrottling = throttling.cpuThrottling;
    if (!throttling.cpuThrottling) context.report.cpuThrottlingReason = throttling.reason;
    printCpuThrottling(throttling);
    cleanupFailure = await retireBrowserContainer(context, { api, command, assertBrowserChild });
  }
  const report = await writeSandboxReport(context, failure, cleanupFailure, now);
  if (failure || cleanupFailure) throw new AggregateError([failure, cleanupFailure].filter(Boolean), report.errors.join('; '));
  return report;
}

async function writeSandboxReport(context, failure, cleanupFailure, now) {
  const report = context.report;
  report.finishedAt = new Date(now()).toISOString();
  report.ok = !failure && !cleanupFailure && report.exitCode === 0 && Boolean(report.endpoint);
  report.errors = [failure, cleanupFailure].filter(Boolean).map(errorMessage);
  await mkdir(context.reportDirectory, { recursive: true });
  await writeFile(context.reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const abort = signal => controller.abort(new Error(`received ${signal}`));
  const onInt = () => abort('SIGINT');
  const onTerm = () => abort('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const args = parseCommand(process.argv.slice(2));
    const report = await runSandboxedPlaywright(args, { signal: controller.signal });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.exitCode ?? 1;
  } catch (error) {
    process.stderr.write(`run-sandboxed-playwright: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}
