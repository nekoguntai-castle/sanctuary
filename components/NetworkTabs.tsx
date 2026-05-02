import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  TAB_NETWORKS,
  networkConfigs,
  type TabNetwork,
} from '../src/app/networks';

export type { TabNetwork };

interface NetworkTabsProps {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  networkAvailability?: Record<TabNetwork, boolean>;
  className?: string;
  fullWidth?: boolean;
}

const getDisabledTitle = (network: TabNetwork): string => {
  const label = networkConfigs[network].label;
  return `${label} is disabled. Enable ${label} under Node Configuration to select it.`;
};

const getActiveTabIndicator = (nav: HTMLElement | null) => {
  if (!nav) return null;

  const activeEl = nav.querySelector('[data-active="true"]') as HTMLElement | null;
  if (!activeEl) return null;

  return {
    left: activeEl.offsetLeft,
    width: activeEl.offsetWidth,
  };
};

const requestMeasureFrame = (callback: () => void): number | null => {
  if (typeof window.requestAnimationFrame !== 'function') {
    callback();
    return null;
  }

  return window.requestAnimationFrame(callback);
};

const cancelMeasureFrame = (frameId: number | null) => {
  if (frameId !== null && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
  }
};

export const NetworkTabs = ({
  selectedNetwork,
  onNetworkChange,
  networkAvailability,
  className = '',
  fullWidth = false,
}: NetworkTabsProps) => {
  const navRef = useRef<HTMLElement>(null);
  const measureFrameRef = useRef<number | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const nextIndicator = getActiveTabIndicator(navRef.current);
    if (!nextIndicator) return;

    setIndicator((current) => (
      current.left === nextIndicator.left && current.width === nextIndicator.width
        ? current
        : nextIndicator
    ));
  }, []);

  const scheduleIndicatorUpdate = useCallback(() => {
    cancelMeasureFrame(measureFrameRef.current);
    measureFrameRef.current = requestMeasureFrame(() => {
      measureFrameRef.current = null;
      updateIndicator();
    });
  }, [updateIndicator]);

  useLayoutEffect(() => {
    updateIndicator();
    scheduleIndicatorUpdate();
  }, [selectedNetwork, updateIndicator, scheduleIndicatorUpdate]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;

    let cancelled = false;
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleIndicatorUpdate)
      : null;
    const activeEl = nav.querySelector('[data-active="true"]') as HTMLElement | null;

    resizeObserver?.observe(nav);
    if (activeEl) resizeObserver?.observe(activeEl);

    window.addEventListener('resize', scheduleIndicatorUpdate);
    void document.fonts?.ready.then(() => {
      if (!cancelled) scheduleIndicatorUpdate();
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleIndicatorUpdate);
    };
  }, [selectedNetwork, scheduleIndicatorUpdate]);

  useEffect(() => () => {
    cancelMeasureFrame(measureFrameRef.current);
  }, []);

  return (
    <div className={className}>
      <nav
        ref={navRef}
        className={`relative ${fullWidth ? 'flex w-full' : 'inline-flex'} gap-0.5 p-0.5 surface-secondary rounded-md`}
        aria-label="Network tabs"
      >
        {/* Sliding indicator */}
        <div
          className="absolute top-0.5 bottom-0.5 rounded bg-white dark:bg-sanctuary-700 shadow-sm transition-all duration-300 ease-out z-0"
          style={{ left: indicator.left, width: indicator.width }}
        />
        {TAB_NETWORKS.map((network) => {
          const config = networkConfigs[network];
          const isSelected = selectedNetwork === network;
          const isDisabled = networkAvailability?.[network] === false;

          return (
            <button
              key={network}
              type="button"
              data-active={isSelected}
              aria-disabled={isDisabled}
              title={isDisabled ? getDisabledTitle(network) : undefined}
              onClick={() => {
                if (!isDisabled) onNetworkChange(network);
              }}
              className={`
                relative z-10 ${fullWidth ? 'flex-1 px-2' : 'px-3'} py-1.5 text-xs font-medium rounded transition-colors duration-200
                ${isDisabled
                  ? 'cursor-not-allowed text-sanctuary-300 hover:text-sanctuary-300 dark:text-sanctuary-600 dark:hover:text-sanctuary-600'
                  : isSelected
                  ? 'text-sanctuary-900 dark:text-sanctuary-50'
                  : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                }
              `}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isDisabled ? 'bg-sanctuary-300 dark:bg-sanctuary-600' : config.dotColor
                  }`}
                  aria-hidden="true"
                />
                <span>{config.label}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default NetworkTabs;
