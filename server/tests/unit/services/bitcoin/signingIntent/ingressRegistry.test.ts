import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const productionSources = (): Array<{ path: string; text: string }> =>
  (readdirSync(resolve(process.cwd(), 'src'), { recursive: true }) as string[])
    .filter(path => path.endsWith('.ts') && !path.endsWith('.d.ts'))
    .map(path => ({ path: `src/${path}`, text: source(`src/${path}`) }));

describe('signing intent ingress registry', () => {
  it.each([
    ['standard, batch, and hardware', 'src/api/transactions/drafting.ts'],
    ['RBF, CPFP, and advanced batch', 'src/api/bitcoin/transactions.ts'],
    ['agent funding', 'src/services/agentApiService.ts'],
    ['Payjoin supersession', 'src/api/payjoin.ts'],
  ])('%s transaction creation issues a server intent', (_name, path) => {
    expect(source(path)).toContain('createSigningIntent');
  });

  it('draft creation binds and authenticates the issued handle', () => {
    const draftCreate = source('src/services/draftCreate.ts');
    expect(draftCreate).toContain('loadSigningIntent');
    expect(draftCreate).toContain('signingIntentId: data.intentId');
    expect(draftCreate).toContain('signingIntentDigest: data.intentDigest');
  });

  it('only the opaque artifact network boundary invokes the node broadcast method', () => {
    const callers = productionSources()
      .filter(file => file.text.includes('client.broadcastTransaction('))
      .map(file => file.path)
      .sort();
    expect(callers).toEqual([
      'src/services/bitcoin/blockchain/networkOperations.ts',
      'src/services/bitcoin/pooledNodeClient.ts',
    ]);
    expect(source('src/services/bitcoin/blockchain/networkOperations.ts'))
      .toContain('artifact: ValidatedBroadcastArtifact');
    expect(source('src/services/bitcoin/pooledNodeClient.ts'))
      .toContain('this.withClient(undefined, client => client.broadcastTransaction(rawTx))');
  });

  it('restricts authenticated raw broadcast replay to the validated boundary and reconciler', () => {
    const callers = productionSources()
      .filter(file => file.text.includes('broadcastAuthenticatedRawTransaction('))
      .map(file => file.path)
      .sort();
    expect(callers).toEqual([
      'src/services/bitcoin/blockchain/networkOperations.ts',
      'src/services/bitcoin/signingIntent/broadcastReconciliation.ts',
    ]);
  });

  it('has a complete registry for every transaction-construction ingress', () => {
    const constructionCallers = productionSources()
      .filter(file => /(?:txService|advancedTx)\.create(?:Transaction|BatchTransaction|RBFTransaction|CPFPTransaction)\(/.test(file.text))
      .map(file => file.path)
      .sort();
    expect(constructionCallers).toEqual([
      'src/api/bitcoin/transactions.ts',
      'src/api/transactions/drafting.ts',
      'src/services/agentApiService.ts',
    ]);
    for (const path of constructionCallers) expect(source(path)).toContain('createSigningIntent');
  });

  it('has no payload-derived broadcast-intent implementation', () => {
    expect(() => source('src/api/transactions/broadcastIntent.ts')).toThrow();
  });
});
