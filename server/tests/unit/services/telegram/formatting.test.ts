import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByWalletAccess = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/repositories', () => ({
  userRepository: {
    findByWalletAccess: mockFindByWalletAccess,
  },
}));

import {
  escapeHtml,
  formatDraftMessage,
  formatTransactionMessage,
  getWalletUsers,
} from '../../../../src/services/telegram/formatting';

describe('telegram formatting helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes optional wallet role filters when loading wallet users', async () => {
    mockFindByWalletAccess.mockResolvedValueOnce([{ id: 'user-1' }]);

    await expect(getWalletUsers('wallet-1', { walletRoles: ['owner', 'signer'] })).resolves.toEqual([
      { id: 'user-1' },
    ]);

    expect(mockFindByWalletAccess).toHaveBeenCalledWith('wallet-1', {
      walletRoles: ['owner', 'signer'],
    });
  });

  it('formats agent operational spends with escaped agent and wallet names', () => {
    const message = formatTransactionMessage(
      {
        txid: 'abc123',
        amount: 123456789n,
        type: 'sent',
        agentOperationalSpend: true,
        agentName: 'Ops & Bot <1>',
      },
      { name: 'Agent <Ops>' },
      'https://example.test'
    );

    expect(message).toContain('<b>Agent Operational Spend</b>');
    expect(message).toContain('Agent: Ops &amp; Bot &lt;1&gt;');
    expect(message).toContain('Operational Wallet: Agent &lt;Ops&gt;');
    expect(message).toContain('Amount: 1.23456789 BTC');
    expect(message).toContain('https://example.test/tx/abc123');
  });

  it('formats agent funding draft requests with label and signature state', () => {
    const message = formatDraftMessage(
      {
        amount: 250000n,
        recipient: 'tb1qrecipientaddress0000000000',
        feeRate: 7,
        label: 'Owner <override>',
        agentName: 'Treasury & Agent',
        agentOperationalWalletName: null,
        agentSigned: false,
      },
      { name: 'Funding <Wallet>' },
      'alice'
    );

    expect(message).toContain('<b>Agent Funding Request</b>');
    expect(message).toContain('Agent: Treasury &amp; Agent');
    expect(message).toContain('From: Funding &lt;Wallet&gt;');
    expect(message).toContain('To: Linked operational wallet');
    expect(message).toContain('Agent signature: missing');
    expect(message).toContain('Label: Owner &lt;override&gt;');
    expect(message).toContain('Review in Sanctuary before signing');
  });

  it('escapes HTML metacharacters only', () => {
    expect(escapeHtml('A&B <C> "D"')).toBe('A&amp;B &lt;C&gt; "D"');
  });
});
