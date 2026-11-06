#!/usr/bin/env node
// Runs the trusted Playwright browser endpoint in the isolated sibling.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const contractModule = fileURLToPath(import.meta.url) === '/tmp/browser-server.mjs'
  ? '/tmp/browser-sandbox-contract.mjs'
  : '../lib/browser-sandbox-contract.mjs';
const { validateBrowserSandboxEvidence, formatBrowserError } = await import(contractModule);

const IMAGE_PLAYWRIGHT = '/opt/playwright/node_modules/playwright/index.mjs';
const ARTIFACTS = '/home/pwuser/browser-server-artifacts';
const READY_PREFIX = 'SANCTUARY_BROWSER_SERVER_READY=';

function processPolicy() {
  const status = readFile('/proc/self/status', 'utf8');
  return status.then(text => {
    const fields = new Map([...text.matchAll(/^(CapBnd|CapEff|CapPrm|CapInh|CapAmb|NoNewPrivs):\s*(\S+)/gm)].map(row => [row[1], row[2]]));
    const masks = ['CapBnd', 'CapEff', 'CapPrm', 'CapInh', 'CapAmb'];
    if (typeof process.getuid !== 'function' || process.getuid() !== 1000 ||
        masks.some(field => !/^0+$/.test(fields.get(field) ?? '')) || fields.get('NoNewPrivs') !== '1') {
      throw new Error('browser server process policy is not UID 1000 with zero capabilities and no-new-privileges');
    }
    return { uid: process.getuid(), capabilityMasks: Object.fromEntries(masks.map(field => [field, fields.get(field)])), noNewPrivs: 1 };
  });
}

function validateSandboxDiagnostics(text, browserFlags, processInfo) {
  const start = text.indexOf('Sandbox Status');
  if (start < 0) throw new Error('chrome://sandbox did not report Sandbox Status');
  const section = text.slice(start);
  for (const layer of ['PID namespaces', 'Network namespaces', 'Seccomp-BPF sandbox']) {
    const escaped = layer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = section.match(new RegExp(`^\\s*${escaped}\\s+Yes\\s*$`, 'gim')) ?? [];
    if (rows.length !== 1) throw new Error(`Chromium sandbox layer is not active exactly once: ${layer}`);
  }
  if (!/^\s*Layer 1 Sandbox\s+Namespace\s*$/im.test(section)) throw new Error('Chromium layer 1 sandbox is not Namespace');
  if (!Array.isArray(browserFlags) || !browserFlags.includes('--enable-automation') ||
      browserFlags.some(flag => ['--no-sandbox', '--disable-setuid-sandbox', '--disable-namespace-sandbox'].includes(flag.split('=', 1)[0]))) {
    throw new Error('Chromium command line is missing required automation or disables a sandbox');
  }
  const contract = validateBrowserSandboxEvidence({ diagnosticsText: text, browserFlags, processInfo: { processInfo }, effectiveUid: 1000 });
  if (!contract.ok) throw new Error(`Chromium sandbox evidence failed: ${contract.errors.join('; ')}`);
}

export async function verifyServer(chromium, server, policy) {
  const browser = await chromium.connect(server.wsEndpoint());
  try {
    const cdp = await browser.newBrowserCDPSession();
    try {
      const flags = (await cdp.send('Browser.getBrowserCommandLine')).arguments;
      const sandboxPage = await browser.newPage();
      let fixturePage;
      try {
        await sandboxPage.goto('chrome://sandbox', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        const diagnostics = await sandboxPage.locator('body').innerText({ timeout: 5_000 });
        fixturePage = await browser.newPage();
        await fixturePage.goto('about:blank');
        await fixturePage.setContent('<!doctype html><title>sandbox ready</title><p>Sandboxed browser server is ready.</p>');
        const screenshot = await fixturePage.screenshot({ type: 'png' });
        if (screenshot.length < 100) throw new Error('sandbox readiness screenshot is empty');
        const processInfo = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
        validateSandboxDiagnostics(diagnostics, flags, processInfo);
        const expectedVersion = policy.browserVersion ?? process.env.CHROME_VERSION;
        if (browser.version() !== expectedVersion) throw new Error(`Chromium version ${browser.version()} differs from expected ${expectedVersion}`);
        return { browserVersion: browser.version(), policy, diagnostics, rendererCount: processInfo.filter(row => row.type?.toLowerCase() === 'renderer').length };
      } finally {
        if (fixturePage) await fixturePage.close();
        await sandboxPage.close();
      }
    } finally {
      await cdp.detach();
    }
  } finally {
    // A connected Browser.close disconnects the client; BrowserServer.close owns server shutdown.
    await browser.close();
  }
}

async function main() {
  const policy = await processPolicy();
  const playwrightPackage = JSON.parse(await readFile('/opt/playwright/node_modules/playwright/package.json', 'utf8'));
  if (playwrightPackage.version !== process.env.PLAYWRIGHT_VERSION || process.env.SANDBOX_POLICY_REVISION !== '1') {
    throw new Error('browser image Playwright or sandbox policy revision does not match the selected image contract');
  }
  const { chromium } = await import(IMAGE_PLAYWRIGHT);
  await mkdir(ARTIFACTS, { recursive: true, mode: 0o700 });
  const server = await chromium.launchServer({
    host: '127.0.0.1',
    port: 0,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromiumSandbox: true,
    args: ['--enable-automation'],
    env: { ...process.env, TMPDIR: '/tmp' },
    artifactsDir: ARTIFACTS
  });
  let closed = false;
  const closeServer = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  process.once('SIGTERM', () => { void closeServer().catch(error => process.stderr.write(`browser-server cleanup: ${formatBrowserError(error)}\n`)); });
  process.once('SIGINT', () => { void closeServer().catch(error => process.stderr.write(`browser-server cleanup: ${formatBrowserError(error)}\n`)); });
  try {
    const evidence = await verifyServer(chromium, server, { ...policy, browserVersion: process.env.CHROME_VERSION });
    await writeFile(path.join(ARTIFACTS, 'browser-server-evidence.json'), `${JSON.stringify({ ok: true, ...evidence }, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${READY_PREFIX}${JSON.stringify({ endpoint: server.wsEndpoint(), evidence: { browserVersion: evidence.browserVersion, rendererCount: evidence.rendererCount, policy } })}\n`);
    await new Promise(resolve => server.on('close', resolve));
  } finally {
    await closeServer();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`browser-server: ${formatBrowserError(error, { stack: true })}\n`);
    process.exitCode = 1;
  });
}
