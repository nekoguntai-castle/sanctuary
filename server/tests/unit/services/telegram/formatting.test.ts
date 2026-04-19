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

  it('loads wallet users without role filters by default', async () => {
    mockFindByWalletAccess.mockResolvedValueOnce([{ id: 'user-2' }]);

    await expect(getWalletUsers('wallet-2')).resolves.toEqual([{ id: 'user-2' }]);

    expect(mockFindByWalletAccess).toHaveBeenCalledWith('wallet-2');
  });

  it('formats agent operational spends with escaped agent and wallet names', () => {
    const message = formatTransactionMessage(
      {
        txid: 'abc123',
        amount: 123456789n,
        type: 'sent',
        agentOperationalSpend: true,
        agentName: 'Ops & Bot <1>',
        agentDestinationClassification: 'unknown_destination',
        agentUnknownDestinationHandlingMode: 'notify_and_pause',
      },
      { name: 'Agent <Ops>' },
      'https://example.test'
    );

    expect(message).toContain('<b>Agent Operational Spend</b>');
    expect(message).toContain('Agent: Ops &amp; Bot &lt;1&gt;');
    expect(message).toContain('Operational Wallet: Agent &lt;Ops&gt;');
    expect(message).toContain('Amount: 1.23456789 BTC');
    expect(message).toContain('Destination: Unknown destination');
    expect(message).toContain('Handling: Notify and pause');
    expect(message).toContain('Sanctuary does not sign or broadcast operational wallet spends');
    expect(message).toContain('https://example.test/tx/abc123');
  });

  it('formats all operational-spend destination and handling labels', () => {
    const cases = [
      ['external_spend', 'notify_only', 'External spend', 'Notify only'],
      ['known_self_transfer', 'pause_agent', 'Known self-transfer', 'Pause agent'],
      ['change_like_movement', 'record_only', 'Change-like movement', 'Record only'],
      ['custom_classification', 'custom_mode', 'custom classification', 'custom mode'],
    ];

    for (const [classification, mode, classificationLabel, modeLabel] of cases) {
      const message = formatTransactionMessage(
        {
          txid: `tx-${classification}`,
          amount: 100_000_000n,
          type: 'sent',
          agentOperationalSpend: true,
          agentName: 'Agent',
          agentDestinationClassification: classification,
          agentUnknownDestinationHandlingMode: mode,
        },
        { name: 'Wallet' }
      );

      expect(message).toContain(`Destination: ${classificationLabel}`);
      expect(message).toContain(`Handling: ${modeLabel}`);
    }
  });

  it('omits optional operational-spend destination lines when metadata is absent', () => {
    const message = formatTransactionMessage(
      {
        txid: 'abc124',
        amount: 50_000n,
        type: 'sent',
        agentOperationalSpend: true,
        agentName: 'Agent',
      },
      { name: 'Wallet' }
    );

    expect(message).not.toContain('Destination:');
    expect(message).not.toContain('Handling:');
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
