import { ChatTab } from '../tabs/ChatTab';
import { InsightsTab } from '../tabs/InsightsTab';
import { SettingsTab } from '../tabs/SettingsTab';
import type { TabId } from './types';

interface TabPanelProps {
  activeTab: TabId;
  walletId: string;
}

export function TabPanel({ activeTab, walletId }: TabPanelProps) {
  return (
    <div className="min-h-0 flex-1">
      {activeTab === 'insights' && <InsightsTab walletId={walletId} />}
      {activeTab === 'chat' && <ChatTab walletId={walletId} />}
      {activeTab === 'settings' && <SettingsTab walletId={walletId} />}
    </div>
  );
}
