import React, { useRef, useState, useEffect, useCallback } from 'react';
import { TabType } from './types';

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  userRole: string;
  draftsCount: number;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  userRole,
  draftsCount,
}) => {
  const tabs: TabType[] = [
    'tx',
    'utxo',
    'addresses',
    ...(userRole !== 'viewer' ? ['drafts' as TabType] : []),
    'stats',
    ...(userRole === 'owner' ? ['access' as TabType] : []),
    'settings',
    'log',
  ];

  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    /* v8 ignore start -- defensive guard; ref is always attached after mount */
    if (!navRef.current) return;
    /* v8 ignore stop */
    const activeEl = navRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      setIndicator({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      });
    }
  }, []);

  useEffect(() => {
    updateIndicator();
  }, [activeTab, updateIndicator]);

  // Recalculate on resize
  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <nav ref={navRef} className="relative flex gap-1 p-1 surface-secondary rounded-xl" aria-label="Tabs">
        {/* Sliding indicator */}
        <div
          className="absolute top-1 bottom-1 rounded-lg bg-white dark:bg-sanctuary-700 shadow-sm transition-all duration-300 ease-out z-0"
          style={{ left: indicator.left, width: indicator.width }}
        />
        {tabs.map((tab) => (
          <button
            key={tab}
            data-active={activeTab === tab}
            onClick={() => onTabChange(tab)}
            className={`${
              activeTab === tab
                ? 'text-primary-700 dark:text-primary-300'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
            } whitespace-nowrap py-2 px-3.5 rounded-lg font-medium text-sm capitalize transition-colors duration-200 relative z-10 focus-visible:ring-2 focus-visible:ring-primary-500`}
          >
            {tab === 'tx' ? 'Transactions' : tab === 'utxo' ? 'UTXOs' : tab}
            {tab === 'drafts' && draftsCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 dark:bg-rose-500 text-[10px] font-bold text-white z-20">
                {draftsCount > 9 ? '9+' : draftsCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
