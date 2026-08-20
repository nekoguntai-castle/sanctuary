import { describe, expect, it } from 'vitest';
import {
  closeTabLabel,
  panelDomId,
  tabDomId,
  tabTitle,
} from '../../../src/components/TransactionList/TransactionTabs/tabPresentation';
import type { Transaction } from '../../../src/types';

const TXID = `${'a'.repeat(58)}beef12`;
const tx = (amount: number) => ({ amount } as Transaction);

describe('transaction tab presentation', () => {
  it('leads with the direction, which is what tells two tabs apart at a glance', () => {
    expect(tabTitle(TXID, tx(1000))).toBe('Received aaaaaa...beef12');
    expect(tabTitle(TXID, tx(-1000))).toBe('Sent aaaaaa...beef12');
  });

  it('falls back to the shortened txid before the transaction has resolved', () => {
    // A deep link opens a tab for a transaction that is not in the loaded page,
    // so the txid is all the strip has to show.
    expect(tabTitle(TXID, null)).toBe('aaaaaa...beef12');
  });

  it('names the close control, which is otherwise a bare ×', () => {
    expect(closeTabLabel(TXID, tx(1000))).toBe('Close Received aaaaaa...beef12');
  });

  it('scopes tab and panel ids per list instance', () => {
    // Two transaction lists on one page would otherwise cross-wire their
    // aria-controls and aria-labelledby.
    expect(tabDomId(':r1:', TXID)).not.toBe(tabDomId(':r2:', TXID));
    expect(panelDomId(':r1:', TXID)).not.toBe(tabDomId(':r1:', TXID));
  });
});
