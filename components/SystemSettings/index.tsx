import React, { useState } from 'react';
import { Shield, Radio, LifeBuoy } from 'lucide-react';

import { AccessControlTab } from './AccessControlTab';
import { WebSocketStatsCard } from './WebSocketStatsCard';
import { SupportPackageCard } from './SupportPackageCard';

// Tab type definition
type SystemSettingsTab = 'access' | 'websocket' | 'support';

// Tab configuration
const SYSTEM_SETTINGS_TABS: { id: SystemSettingsTab; name: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'access', name: 'Access Control', icon: Shield },
  { id: 'websocket', name: 'WebSocket', icon: Radio },
  { id: 'support', name: 'Support', icon: LifeBuoy },
];

export const SystemSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SystemSettingsTab>('access');

  return (
    <div className="max-w-2xl mx-auto animate-fade-in pb-12">
      <div className="mb-6">
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">System Settings</h2>
        <p className="text-sanctuary-500">Configure system-wide settings for Sanctuary</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 surface-secondary rounded-lg p-1">
          {SYSTEM_SETTINGS_TABS.map(tab => (
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
              <span>{tab.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'access' && <AccessControlTab />}
        {activeTab === 'websocket' && <WebSocketStatsCard />}
        {activeTab === 'support' && <SupportPackageCard />}
      </div>
    </div>
  );
};
