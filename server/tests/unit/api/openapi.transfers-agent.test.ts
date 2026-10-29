/**
 * Transfer and agent OpenAPI contract text (bug-scrub iteration 10, phase B).
 *
 * Standalone so phase-owned assertions do not grow openapi.gateway.contracts.ts.
 */
import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../../src/api/openapi/spec';

type SchemaMap = Record<string, { properties: Record<string, { description?: string }> }>;

const schemas = openApiSpec.components.schemas as unknown as SchemaMap;
const paths = openApiSpec.paths as unknown as Record<string, Record<string, { description?: string }>>;

describe('OpenAPI transfer keepExistingUsers contract', () => {
  it('documents that false removes every other member and the group grant', () => {
    for (const schema of ['OwnershipTransfer', 'TransferCreateRequest']) {
      const description = schemas[schema].properties.keepExistingUsers.description;
      expect(description).toMatch(/false.*removes all existing access/i);
      expect(description).toMatch(/group grant/i);
    }
    expect(paths['/transfers/{id}/confirm'].post.description).toMatch(
      /keepExistingUsers=false.*every other direct member and any group grant/i,
    );
  });
});

type OperationMap = Record<string, { responses?: Record<string, { description?: string }> }>;

describe('OpenAPI agent 403 contract', () => {
  it('documents the lost-wallet-access and funding-role refusals on every agent operation', () => {
    const agentRoutes = Object.entries(openApiSpec.paths as unknown as Record<string, OperationMap>)
      .filter(([path]) => path.startsWith('/agent/'));
    expect(agentRoutes.length).toBeGreaterThan(0);
    for (const [, operations] of agentRoutes) {
      for (const operation of Object.values(operations)) {
        expect(operation.responses?.['403']?.description).toMatch(/agent_user_wallet_access_lost/);
        expect(operation.responses?.['403']?.description).toMatch(/agent_user_wallet_role_insufficient/);
      }
    }
  });
});
