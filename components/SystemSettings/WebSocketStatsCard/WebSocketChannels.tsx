import type { WebSocketStats } from '../../../src/api/admin';

interface ChannelGroups {
  walletChannels: string[];
  globalChannels: string[];
  walletIds: string[];
}

function groupChannels(channelList: string[]): ChannelGroups {
  const walletChannels = channelList.filter(c => c.startsWith('wallet:'));
  const globalChannels = channelList.filter(c => !c.startsWith('wallet:'));
  const walletIds = [...new Set(walletChannels.map(c => c.split(':')[1]))];

  return { walletChannels, globalChannels, walletIds };
}

function GlobalChannels({ channels }: { channels: string[] }) {
  if (channels.length === 0) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">Global</div>
      <div className="flex flex-wrap gap-1.5">
        {channels.map((channel) => (
          <span
            key={channel}
            className="px-2 py-0.5 text-[10px] font-mono bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded"
          >
            {channel}
          </span>
        ))}
      </div>
    </div>
  );
}

function WalletChannelRow({ walletId, walletChannels }: { walletId: string; walletChannels: string[] }) {
  const channels = walletChannels.filter(c => c.split(':')[1] === walletId);
  const types = channels.map(c => c.split(':')[2] || 'base').join(', ');

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="font-mono text-sanctuary-500 truncate max-w-[100px]" title={walletId}>
        {walletId.slice(0, 8)}...
      </span>
      <span className="text-sanctuary-400">→</span>
      <span className="text-sanctuary-600 dark:text-sanctuary-400">{types}</span>
    </div>
  );
}

function WalletChannels({ walletIds, walletChannels }: Pick<ChannelGroups, 'walletIds' | 'walletChannels'>) {
  if (walletIds.length === 0) return null;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-sanctuary-400 mb-1.5">
        Wallets ({walletIds.length})
      </div>
      <div className="max-h-32 overflow-y-auto space-y-1">
        {walletIds.map((walletId) => (
          <WalletChannelRow key={walletId} walletId={walletId} walletChannels={walletChannels} />
        ))}
      </div>
    </div>
  );
}

export function ActiveChannels({ stats }: { stats: WebSocketStats }) {
  if (stats.subscriptions.channelList.length === 0) return null;

  const groups = groupChannels(stats.subscriptions.channelList);

  return (
    <details className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <summary className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400">
        Active Channels ({stats.subscriptions.channelList.length})
      </summary>
      <div className="mt-3 space-y-3">
        <GlobalChannels channels={groups.globalChannels} />
        <WalletChannels walletIds={groups.walletIds} walletChannels={groups.walletChannels} />
      </div>
    </details>
  );
}
