import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  TAB_NETWORKS,
  networkConfigs,
  type TabNetwork,
} from '../src/app/networks';
import { useTabsA11y } from './ui/useTabsA11y';

export type { TabNetwork };

type NetworkTabsLayout = 'row' | 'grid';

interface NetworkTabButtonProps {
  network: TabNetwork;
  selectedNetwork: TabNetwork;
  networkAvailability?: Record<TabNetwork, boolean>;
  layout: NetworkTabsLayout;
  fullWidth: boolean;
  getTabProps: ReturnType<typeof useTabsA11y<TabNetwork>>['getTabProps'];
}

interface NetworkTabsProps {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  networkAvailability?: Record<TabNetwork, boolean>;
  className?: string;
  fullWidth?: boolean;
  layout?: NetworkTabsLayout;
}

const getDisabledTitle = (network: TabNetwork): string => {
  const label = networkConfigs[network].label;
  return `${label} is disabled. Enable ${label} under Node Configuration to select it.`;
};

const getActiveTabIndicator = (nav: HTMLElement | null) => {
  /* v8 ignore next -- defensive guard; the nav ref is attached before layout/effect measurement. */
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

const getNavClassName = (layout: NetworkTabsLayout, fullWidth: boolean) => {
  const baseClass = 'relative gap-0.5 p-0.5 surface-secondary rounded-md';
  if (layout === 'grid') return `${baseClass} grid grid-cols-2 w-full`;
  return `${baseClass} ${fullWidth ? 'flex w-full' : 'inline-flex'}`;
};

const getButtonBaseClass = (layout: NetworkTabsLayout, fullWidth: boolean) => {
  const widthClass = layout === 'grid'
    ? 'min-w-0 px-2 justify-center'
    : `${fullWidth ? 'flex-1 px-2' : 'px-3'}`;

  return `relative z-10 ${widthClass} py-1.5 text-xs font-medium rounded transition-colors duration-200`;
};

const getButtonStateClass = (isSelected: boolean, isDisabled: boolean, layout: NetworkTabsLayout) => {
  if (isDisabled) {
    return 'cursor-not-allowed text-sanctuary-300 hover:text-sanctuary-300 dark:text-sanctuary-600 dark:hover:text-sanctuary-600';
  }

  if (isSelected && layout === 'grid') {
    return 'bg-white dark:bg-sanctuary-700 shadow-sm text-sanctuary-900 dark:text-sanctuary-50';
  }

  if (isSelected) {
    return 'text-sanctuary-900 dark:text-sanctuary-50';
  }

  return 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300';
};

const getButtonClassName = (
  isSelected: boolean,
  isDisabled: boolean,
  layout: NetworkTabsLayout,
  fullWidth: boolean
) => `${getButtonBaseClass(layout, fullWidth)} ${getButtonStateClass(isSelected, isDisabled, layout)}`;

const createResizeObserver = (callback: ResizeObserverCallback) => (
  typeof ResizeObserver === 'function' ? new ResizeObserver(callback) : null
);

const observeTabResizeTargets = (resizeObserver: ResizeObserver | null, nav: HTMLElement) => {
  const activeEl = nav.querySelector('[data-active="true"]') as HTMLElement | null;

  resizeObserver?.observe(nav);
  if (activeEl) resizeObserver?.observe(activeEl);
};

const scheduleAfterFontsReady = (
  scheduleIndicatorUpdate: () => void,
  isCancelled: () => boolean
) => {
  void document.fonts?.ready.then(() => {
    if (!isCancelled()) scheduleIndicatorUpdate();
  });
};

function setupIndicatorObservers(
  nav: HTMLElement | null,
  scheduleIndicatorUpdate: () => void
) {
  /* v8 ignore next -- defensive guard; effects run only after the nav ref has mounted. */
  if (!nav) return undefined;

  let cancelled = false;
  const resizeObserver = createResizeObserver(scheduleIndicatorUpdate);

  observeTabResizeTargets(resizeObserver, nav);
  window.addEventListener('resize', scheduleIndicatorUpdate);
  scheduleAfterFontsReady(scheduleIndicatorUpdate, () => cancelled);

  return () => {
    cancelled = true;
    resizeObserver?.disconnect();
    window.removeEventListener('resize', scheduleIndicatorUpdate);
  };
}

function useNetworkTabIndicator(layout: NetworkTabsLayout, selectedNetwork: TabNetwork) {
  const navRef = useRef<HTMLElement>(null);
  const measureFrameRef = useRef<number | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    if (layout === 'grid') return;

    const nextIndicator = getActiveTabIndicator(navRef.current);
    if (!nextIndicator) return;

    setIndicator((current) => (
      current.left === nextIndicator.left && current.width === nextIndicator.width
        ? current
        : nextIndicator
    ));
  }, [layout]);

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

  useEffect(
    () => setupIndicatorObservers(navRef.current, scheduleIndicatorUpdate),
    [selectedNetwork, scheduleIndicatorUpdate]
  );

  useEffect(() => () => {
    cancelMeasureFrame(measureFrameRef.current);
  }, []);

  return { navRef, indicator };
}

function SlidingTabIndicator({ indicator }: { indicator: { left: number; width: number } }) {
  return (
    <div
      data-testid="network-tabs-indicator"
      className="absolute top-0.5 bottom-0.5 rounded bg-white dark:bg-sanctuary-700 shadow-sm transition-all duration-300 ease-out z-0"
      style={{ left: indicator.left, width: indicator.width }}
    />
  );
}

function NetworkTabButton({
  network,
  selectedNetwork,
  networkAvailability,
  layout,
  fullWidth,
  getTabProps,
}: NetworkTabButtonProps) {
  const config = networkConfigs[network];
  const isSelected = selectedNetwork === network;
  const isDisabled = networkAvailability?.[network] === false;

  return (
    <button
      key={network}
      {...getTabProps(network, { disabled: isDisabled })}
      title={isDisabled ? getDisabledTitle(network) : undefined}
      className={getButtonClassName(isSelected, isDisabled, layout, fullWidth)}
    >
      <span className="flex min-w-0 items-center justify-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isDisabled ? 'bg-sanctuary-300 dark:bg-sanctuary-600' : config.dotColor
          }`}
          aria-hidden="true"
        />
        <span className="truncate">{config.label}</span>
      </span>
    </button>
  );
}

export const NetworkTabs = ({
  selectedNetwork,
  onNetworkChange,
  networkAvailability,
  className = '',
  fullWidth = false,
  layout = 'row',
}: NetworkTabsProps) => {
  const { navRef, indicator } = useNetworkTabIndicator(layout, selectedNetwork);
  const isTabDisabled = useCallback(
    (network: TabNetwork) => networkAvailability?.[network] === false,
    [networkAvailability]
  );
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: TAB_NETWORKS,
    activeTab: selectedNetwork,
    onTabChange: onNetworkChange,
    isTabDisabled,
  });

  return (
    <div className={className}>
      <nav
        ref={navRef}
        {...getTabListProps('Network tabs')}
        className={getNavClassName(layout, fullWidth)}
      >
        {layout === 'row' && <SlidingTabIndicator indicator={indicator} />}
        {TAB_NETWORKS.map((network) => (
          <NetworkTabButton
            key={network}
            network={network}
            selectedNetwork={selectedNetwork}
            networkAvailability={networkAvailability}
            layout={layout}
            fullWidth={fullWidth}
            getTabProps={getTabProps}
          />
        ))}
      </nav>
    </div>
  );
};

export default NetworkTabs;
