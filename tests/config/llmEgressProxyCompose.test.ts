import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ComposeService {
  environment?: Record<string, string>;
  networks?: string[];
}

const services = (parse(readFileSync('docker-compose.yml', 'utf8')) as {
  services: Record<string, ComposeService>;
}).services;

const PROXY = 'llm-egress-proxy';
const PROXY_NETWORK = 'llm-egress-network';
const APP_NETWORK = 'sanctuary-network';

// Every server process that calls the proxy: the backend (AI settings, Console,
// Intelligence chat) and the worker (scheduled `intelligence:analyze`, which
// calls /analyze and /check-provider under the `worker:intelligence` principal).
const PROXY_CALLERS = ['backend', 'worker'];

function service(name: string): ComposeService {
  const entry = services[name];
  if (!entry) throw new Error(`docker-compose.yml has no ${name} service`);
  return entry;
}

describe('LLM egress proxy compose contract', () => {
  it.each(PROXY_CALLERS)('lets %s reach the proxy on its dedicated network', (caller) => {
    expect(service(caller).networks).toContain(PROXY_NETWORK);
    expect(service(caller).networks).toContain(APP_NETWORK);
  });

  it.each(PROXY_CALLERS)('gives %s the proxy URL and the secret the proxy checks', (caller) => {
    const env = service(caller).environment ?? {};

    expect(env.LLM_EGRESS_PROXY_URL).toBe('${LLM_EGRESS_PROXY_URL:-http://llm-egress-proxy:3100}');
    expect(env.LLM_EGRESS_PROXY_SECRET).toBe(service(PROXY).environment?.LLM_EGRESS_PROXY_SECRET);
  });

  it('keeps the proxy off the app network and the data stores off the proxy network', () => {
    expect(service(PROXY).networks).toEqual([PROXY_NETWORK]);

    const members = Object.entries(services)
      .filter(([, entry]) => entry.networks?.includes(PROXY_NETWORK))
      .map(([name]) => name)
      .sort();
    expect(members).toEqual([...PROXY_CALLERS, PROXY].sort());
  });
});
