import React, { useState } from 'react';
import { Monitor, Globe, Palette, Volume2 } from 'lucide-react';
import { AppearanceTab } from './sections/ThemeSection';
import { DisplayTab } from './sections/DisplaySection';
import { ServicesTab } from './sections/ServicesSection';
import { NotificationsTab } from './sections/NotificationsSection';

type SettingsTab = 'appearance' | 'display' | 'services' | 'notifications';

const SETTINGS_TABS: { id: SettingsTab; name: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'appearance', name: 'Appearance', icon: Palette },
  { id: 'display', name: 'Display', icon: Monitor },
  { id: 'services', name: 'Services', icon: Globe },
  { id: 'notifications', name: 'Notifications', icon: Volume2 },
];

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  return (
    <div className="max-w-2xl mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Customize your Sanctuary experience</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 surface-secondary rounded-lg p-1">
          {SETTINGS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'appearance' && <AppearanceTab />}
        {activeTab === 'display' && <DisplayTab />}
        {activeTab === 'services' && <ServicesTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
      </div>
    </div>
  );
};
