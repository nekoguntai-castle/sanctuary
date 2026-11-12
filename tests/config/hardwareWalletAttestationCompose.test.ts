import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The operator attestation is one instance-wide decision, but each server
 * process reads it from its own environment. A service that is not given the
 * variables decides "nothing attested" and disagrees with the others.
 */
const SERVER_PROCESS_SERVICES = ['backend', 'worker', 'mcp'] as const;
const ATTESTATION_ENV_LINES = [
  'HARDWARE_WALLET_OPERATOR_ATTESTED_VENDORS: ${HARDWARE_WALLET_OPERATOR_ATTESTED_VENDORS:-}',
  'HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK: ${HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK:-}',
];

function serviceBlock(service: string): string {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const start = compose.indexOf(`\n  ${service}:\n`);
  if (start === -1) throw new Error(`docker-compose.yml has no ${service} service block`);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n|\n[a-z]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('hardware wallet operator attestation compose contract', () => {
  it.each(SERVER_PROCESS_SERVICES)('forwards the attestation to the %s process', (service) => {
    const block = serviceBlock(service);

    for (const line of ATTESTATION_ENV_LINES) {
      expect(block).toContain(line);
    }
  });
});
