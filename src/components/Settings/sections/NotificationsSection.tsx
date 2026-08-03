import React, { useState } from 'react';
import { Volume2, Send } from 'lucide-react';
import { NotificationSoundSettings } from './SoundSection';
import { TelegramSettings } from './TelegramSection';
import { useTabsA11y } from '../../ui/useTabsA11y';

type NotificationSubTab = 'sound' | 'telegram';

const NOTIFICATION_SUB_TABS: readonly NotificationSubTab[] = ['sound', 'telegram'];

const NotificationsTab: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<NotificationSubTab>('sound');
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: NOTIFICATION_SUB_TABS,
    activeTab: activeSubTab,
    onTabChange: setActiveSubTab,
  });

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div
        {...getTabListProps('Notification settings sections')}
        className="flex space-x-1 surface-secondary rounded-lg p-1"
      >
        <button
          {...getTabProps('sound')}
          className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeSubTab === 'sound'
              ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
          }`}
        >
          <Volume2 className="w-4 h-4" />
          <span>Sound</span>
        </button>
        <button
          {...getTabProps('telegram')}
          className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
            activeSubTab === 'telegram'
              ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
          }`}
        >
          <Send className="w-4 h-4" />
          <span>Telegram</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeSubTab === 'sound' && <NotificationSoundSettings />}
      {activeSubTab === 'telegram' && <TelegramSettings />}
    </div>
  );
};

export { NotificationsTab };
