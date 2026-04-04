import React, { useState, useEffect, useCallback } from 'react';
import { Brain, MessageSquare, Settings, ChevronDown } from 'lucide-react';
import { getWallets } from '../../src/api/wallets';
import type { Wallet } from '../../src/api/wallets';
import { InsightsTab } from './tabs/InsightsTab';
import { ChatTab } from './tabs/ChatTab';
import { SettingsTab } from './tabs/SettingsTab';
import { createLogger } from '../../utils/logger';

const log = createLogger('Intelligence');

type TabId = 'insights' | 'chat' | 'settings';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'insights', label: 'Insights', icon: Brain },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Intelligence: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('insights');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadWallets = useCallback(async () => {
    try {
      const result = await getWallets();
      setWallets(result);
      if (result.length > 0 && !selectedWalletId) {
        setSelectedWalletId(result[0].id);
      }
    } catch (error) {
      log.error('Failed to load wallets', { error });
    } finally {
      setLoading(false);
    }
  }, [selectedWalletId]);

  useEffect(() => {
    loadWallets();
  }, [loadWallets]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!walletDropdownOpen) return;
    const handleClick = () => setWalletDropdownOpen(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [walletDropdownOpen]);

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent dark:border-primary-200 dark:border-t-transparent" />
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sanctuary-500 dark:text-sanctuary-400">
        <Brain className="h-10 w-10" />
        <p className="text-sm">No wallets available for intelligence analysis.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header: title + wallet selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary-600 dark:text-primary-300" />
          <h1 className="text-lg font-semibold text-sanctuary-800 dark:text-sanctuary-200">
            Intelligence
          </h1>
        </div>

        {/* Wallet selector */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setWalletDropdownOpen((prev) => !prev);
            }}
            className="flex items-center gap-2 rounded-lg border border-sanctuary-200 bg-white px-3 py-1.5 text-[11px] font-medium text-sanctuary-700 transition-colors hover:border-sanctuary-300 dark:border-sanctuary-800 dark:bg-sanctuary-900 dark:text-sanctuary-300 dark:hover:border-sanctuary-600"
          >
            <span className="max-w-[160px] truncate">
              {selectedWallet?.name ?? 'Select wallet'}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {walletDropdownOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-sanctuary-200 bg-white py-1 shadow-lg dark:border-sanctuary-800 dark:bg-sanctuary-900">
              {wallets.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => {
                    setSelectedWalletId(wallet.id);
                    setWalletDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 ${
                    wallet.id === selectedWalletId
                      ? 'font-medium text-primary-600 dark:text-primary-300'
                      : 'text-sanctuary-700 dark:text-sanctuary-300'
                  }`}
                >
                  {wallet.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg border border-sanctuary-200 bg-sanctuary-50 p-0.5 dark:border-sanctuary-800 dark:bg-sanctuary-950">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {activeTab === 'insights' && <InsightsTab walletId={selectedWalletId} />}
        {activeTab === 'chat' && <ChatTab walletId={selectedWalletId} />}
        {activeTab === 'settings' && <SettingsTab walletId={selectedWalletId} />}
      </div>
    </div>
  );
};
