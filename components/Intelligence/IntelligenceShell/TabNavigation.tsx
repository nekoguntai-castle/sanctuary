import { INTELLIGENCE_TABS } from './tabDefinitions';
import type { TabId } from './types';

interface TabNavigationProps {
  activeTab: TabId;
  onSelectTab: (tabId: TabId) => void;
}

export function TabNavigation({ activeTab, onSelectTab }: TabNavigationProps) {
  return (
    <div className="flex gap-1 rounded-lg border border-sanctuary-200 bg-sanctuary-50 p-0.5 dark:border-sanctuary-800 dark:bg-sanctuary-950">
      {INTELLIGENCE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all ${
              isActive
                ? 'bg-white text-primary-600 shadow-sm dark:bg-sanctuary-800 dark:text-primary-300'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
