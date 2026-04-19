import { useEffect, useState } from 'react';
import * as adminApi from '../../../src/api/admin';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import type { WalletAgentLinkBadge } from '../WalletHeader';

const log = createLogger('WalletDetail');

type WalletAgent = Awaited<ReturnType<typeof adminApi.getWalletAgents>>[number];

export function useWalletAgentLinks(walletId: string | undefined, isAdmin: boolean | undefined): WalletAgentLinkBadge[] {
  const [walletAgentLinks, setWalletAgentLinks] = useState<WalletAgentLinkBadge[]>([]);

  useEffect(() => {
    if (!walletId || !isAdmin) {
      setWalletAgentLinks([]);
      return;
    }

    let cancelled = false;
    adminApi.getWalletAgents({ walletId })
      .then((agents) => {
        if (cancelled) return;
        setWalletAgentLinks(agents.flatMap(agent => buildWalletAgentLinks(agent, walletId)));
      })
      .catch((err) => {
        logError(log, err, 'Failed to load wallet agent links', { silent: true });
        if (!cancelled) setWalletAgentLinks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [walletId, isAdmin]);

  return walletAgentLinks;
}

function buildWalletAgentLinks(agent: WalletAgent, walletId: string): WalletAgentLinkBadge[] {
  const links: WalletAgentLinkBadge[] = [];

  if (agent.fundingWalletId === walletId) {
    links.push({
      agentId: agent.id,
      agentName: agent.name,
      role: 'funding',
      linkedWalletName: agent.operationalWallet?.name ?? agent.operationalWalletId,
      status: agent.status,
    });
  }

  if (agent.operationalWalletId === walletId) {
    links.push({
      agentId: agent.id,
      agentName: agent.name,
      role: 'operational',
      linkedWalletName: agent.fundingWallet?.name ?? agent.fundingWalletId,
      status: agent.status,
    });
  }

  return links;
}
