import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { handleNotification } from '../../../../../src/services/bitcoin/electrum/dataHandler';
import type { ElectrumResponse } from '../../../../../src/services/bitcoin/electrum/types';

// A Bitcoin block header is exactly 80 bytes / 160 hex characters.
const VALID_HEADER = 'a'.repeat(160);

function headerNotification(params: unknown): ElectrumResponse {
  return {
    jsonrpc: '2.0',
    id: null,
    method: 'blockchain.headers.subscribe',
    params,
  } as ElectrumResponse;
}

function captureNewBlock(notification: ElectrumResponse) {
  const emitter = new EventEmitter();
  const onNewBlock = vi.fn();
  emitter.on('newBlock', onNewBlock);
  handleNotification(notification, emitter, new Map());
  return onNewBlock;
}

// Header notifications are attacker-influenceable input from an Electrum server
// we do not control. The subscribe *response* is schema-validated
// (`HeadersSubscribeSchema` via `validateResponse`), but the *notification* was
// taken on trust with a bare `as` cast. Everything downstream treats it as fact:
// the height is written into the process tip cache that confirmation counts are
// derived from, and the hex is hashed into the block identity used as the
// confirmation job id. Nothing derived from an unvalidated header may reach
// either, so a malformed notification must emit nothing at all.
describe('electrum header notifications', () => {
  it('emits newBlock for a well-formed header', () => {
    const onNewBlock = captureNewBlock(
      headerNotification([{ height: 800_000, hex: VALID_HEADER }]),
    );

    expect(onNewBlock).toHaveBeenCalledWith({ height: 800_000, hex: VALID_HEADER });
  });

  it('accepts height zero, which is the genesis block and not a missing value', () => {
    const onNewBlock = captureNewBlock(
      headerNotification([{ height: 0, hex: VALID_HEADER }]),
    );

    expect(onNewBlock).toHaveBeenCalledWith({ height: 0, hex: VALID_HEADER });
  });

  it.each([
    ['missing params', undefined],
    ['empty params', []],
    ['null entry', [null]],
    ['non-object entry', ['not-an-object']],
    ['missing height', [{ hex: VALID_HEADER }]],
    ['missing hex', [{ height: 1 }]],
    ['non-integer height', [{ height: 1.5, hex: VALID_HEADER }]],
    ['negative height', [{ height: -1, hex: VALID_HEADER }]],
    ['string height', [{ height: '800000', hex: VALID_HEADER }]],
    ['non-hex payload', [{ height: 1, hex: 'z'.repeat(160) }]],
    ['short hex', [{ height: 1, hex: 'a'.repeat(158) }]],
    ['long hex', [{ height: 1, hex: 'a'.repeat(162) }]],
    ['odd-length hex', [{ height: 1, hex: 'a'.repeat(159) }]],
    ['empty hex', [{ height: 1, hex: '' }]],
  ])('drops a header notification with %s', (_label, params) => {
    expect(captureNewBlock(headerNotification(params))).not.toHaveBeenCalled();
  });
});
