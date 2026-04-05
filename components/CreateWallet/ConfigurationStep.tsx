/**
 * Step 3: Wallet Configuration
 *
 * Configures wallet name, network, script type (for single-sig),
 * and quorum settings (for multi-sig).
 */

import React from 'react';
import { Check } from 'lucide-react';
import { WalletType } from '../../types';
import type { ScriptType, Network } from './types';

interface ConfigurationStepProps {
  walletType: WalletType;
  walletName: string;
  setWalletName: (name: string) => void;
  network: Network;
  setNetwork: (network: Network) => void;
  scriptType: ScriptType;
  setScriptType: (type: ScriptType) => void;
  quorumM: number;
  setQuorumM: (m: number) => void;
  selectedDeviceCount: number;
}

export const ConfigurationStep: React.FC<ConfigurationStepProps> = ({
  walletType,
  walletName,
  setWalletName,
  network,
  setNetwork,
  scriptType,
  setScriptType,
  quorumM,
  setQuorumM,
  selectedDeviceCount,
}) => (
  <div className="space-y-6 animate-fade-in max-w-lg mx-auto">
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-6">Configuration</h2>

      <div className="space-y-4">
          <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Wallet Name</label>
              <input
                  type="text"
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  placeholder={walletType === WalletType.SINGLE_SIG ? "e.g., My ColdCard Wallet" : "e.g., Family Savings"}
                  className="w-full px-4 py-3 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                  autoFocus
              />
          </div>

          {/* Network Selection */}
          <div>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Network</label>
              <div className="flex gap-2">
                  {(['mainnet', 'testnet', 'signet'] as const).map(net => (
                      <button
                          key={net}
                          type="button"
                          onClick={() => setNetwork(net)}
                          className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                              network === net
                                  ? net === 'mainnet'
                                      ? 'bg-mainnet-100/50 dark:bg-mainnet-900/20 text-mainnet-700 dark:text-mainnet-300 border border-mainnet-200 dark:border-mainnet-700'
                                      : net === 'testnet'
                                      ? 'bg-testnet-100/50 dark:bg-testnet-900/20 text-testnet-700 dark:text-testnet-300 border border-testnet-200 dark:border-testnet-700'
                                      : 'bg-signet-100/50 dark:bg-signet-900/20 text-signet-700 dark:text-signet-300 border border-signet-200 dark:border-signet-700'
                                  : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:border-sanctuary-400'
                          }`}
                      >
                          {net.charAt(0).toUpperCase() + net.slice(1)}
                      </button>
                  ))}
              </div>
              {network !== 'mainnet' && (
                  <div className={`mt-2 p-3 rounded-lg border text-xs ${
                      network === 'testnet'
                          ? 'bg-testnet-50 dark:bg-testnet-900/10 border-testnet-300 dark:border-testnet-600 text-testnet-700 dark:text-testnet-800'
                          : 'bg-signet-50 dark:bg-signet-900/10 border-signet-300 dark:border-signet-600 text-signet-700 dark:text-signet-800'
                  }`}>
                      <strong>Warning:</strong> This wallet will operate on {network}. {network === 'testnet' ? 'Testnet coins have no real-world value.' : 'Signet is a controlled testing network.'}
                  </div>
              )}
          </div>

          {walletType === WalletType.SINGLE_SIG && (
              <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Script Type</label>
                  <div className="grid grid-cols-1 gap-2">
                      {[
                          { id: 'native_segwit', label: 'Native Segwit (Bech32)', desc: 'bc1q... (Lowest fees, Recommended)' },
                          { id: 'taproot', label: 'Taproot (Bech32m)', desc: 'bc1p... (Advanced privacy)' },
                          { id: 'nested_segwit', label: 'Nested Segwit (P2SH)', desc: '3... (High compatibility)' },
                          { id: 'legacy', label: 'Legacy (P2PKH)', desc: '1... (Oldest)' },
                      ].map(opt => (
                          <button
                              key={opt.id}
                              onClick={() => setScriptType(opt.id as ScriptType)}
                              className={`text-left p-3 rounded-lg border flex items-center justify-between ${scriptType === opt.id ? 'border-sanctuary-600 bg-sanctuary-50 dark:border-sanctuary-400 dark:bg-sanctuary-800' : 'border-sanctuary-200 dark:border-sanctuary-800'}`}
                          >
                              <div>
                                  <div className="text-sm font-medium">{opt.label}</div>
                                  <div className="text-xs text-sanctuary-500">{opt.desc}</div>
                              </div>
                              {scriptType === opt.id && <Check className="w-4 h-4 text-sanctuary-600 dark:text-sanctuary-400" />}
                          </button>
                      ))}
                  </div>
              </div>
          )}

          {walletType === WalletType.MULTI_SIG && (
              <div>
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Quorum (M of N)</label>
                  <div className="surface-elevated p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                      <div className="flex justify-between items-center mb-4">
                          <span className="text-sm">Required Signatures: <span className="font-bold">{quorumM}</span></span>
                          <span className="text-sm text-sanctuary-500">Total Signers: {selectedDeviceCount}</span>
                      </div>
                      <input
                          type="range"
                          min="1"
                          max={selectedDeviceCount}
                          value={quorumM}
                          onChange={(e) => setQuorumM(parseInt(e.target.value, 10))}
                          className="w-full accent-sanctuary-800 dark:accent-sanctuary-200"
                      />
                      <p className="text-xs text-sanctuary-500 mt-2">
                          {quorumM} out of {selectedDeviceCount} devices will be required to spend funds.
                      </p>
                  </div>
              </div>
          )}
      </div>
  </div>
);
