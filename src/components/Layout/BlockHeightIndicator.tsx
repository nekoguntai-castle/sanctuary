import React, { useEffect, useState } from 'react';
import { Blocks } from 'lucide-react';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import * as bitcoinApi from '../../api/bitcoin';
import { formatNetworkTitle } from '../../app/networks';
import { createLogger } from '../../utils/logger';

const log = createLogger('BlockHeight');

/**
 * Compact block height display for the sidebar footer.
 * Shows the current Bitcoin block height with a subtle tick animation on new blocks.
 */
export const BlockHeightIndicator: React.FC = () => {
  const { selectedNetwork } = useActiveNetwork();
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    let active = true;
    let requestGeneration = 0;
    let tickGeneration = 0;
    let currentHeight: number | null = null;
    let tickResetTimeout: ReturnType<typeof setTimeout> | null = null;

    setBlockHeight(null);
    setTick(false);

    const fetchHeight = async () => {
      const generation = ++requestGeneration;
      try {
        const status = await bitcoinApi.getStatus(selectedNetwork);
        if (!active || generation !== requestGeneration || !status.blockHeight) return;

        if (currentHeight !== null && currentHeight !== status.blockHeight) {
          const currentTickGeneration = ++tickGeneration;
          setTick(true);
          if (tickResetTimeout) clearTimeout(tickResetTimeout);
          tickResetTimeout = setTimeout(() => {
            if (!active || currentTickGeneration !== tickGeneration) return;
            tickResetTimeout = null;
            setTick(false);
          }, 1500);
        }

        currentHeight = status.blockHeight;
        setBlockHeight(status.blockHeight);
      } catch (error) {
        if (active && generation === requestGeneration) {
          log.debug('Failed to fetch block height');
        }
      }
    };

    fetchHeight();
    const interval = setInterval(fetchHeight, 30000);
    return () => {
      active = false;
      tickGeneration++;
      clearInterval(interval);
      if (tickResetTimeout) clearTimeout(tickResetTimeout);
    };
  }, [selectedNetwork]);

  if (blockHeight === null) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-[10px] lg:text-xs text-sanctuary-400 transition-colors ${tick ? 'text-success-500' : ''}`}
      title={`${formatNetworkTitle(selectedNetwork)} block height`}
    >
      <Blocks className={`w-3 h-3 transition-transform ${tick ? 'scale-110' : ''}`} />
      <span className="font-mono tabular-nums">{blockHeight.toLocaleString()}</span>
    </div>
  );
};
