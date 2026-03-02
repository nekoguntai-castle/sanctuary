/**
 * Core WebSocket Hook
 *
 * React hook for WebSocket connection and subscriptions.
 * Automatically connects to WebSocket server and manages connection state.
 */

import { useEffect, useState, useCallback } from 'react';
import { websocketClient } from '../../services/websocket';
import apiClient from '../../src/api/client';

export interface UseWebSocketReturn {
  connected: boolean;
  state: 'connecting' | 'connected' | 'disconnected';
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  subscribeBatch: (channels: string[]) => void;
  unsubscribeBatch: (channels: string[]) => void;
  subscribeWallet: (walletId: string) => void;
  unsubscribeWallet: (walletId: string) => void;
  subscribeWallets: (walletIds: string[]) => void;
  unsubscribeWallets: (walletIds: string[]) => void;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [connected, setConnected] = useState(websocketClient.isConnected());
  const [state, setState] = useState(websocketClient.getState());

  useEffect(() => {
    // Handle connection state changes
    const handleConnectionChange = (isConnected: boolean) => {
      setConnected(isConnected);
      setState(websocketClient.getState());
    };

    websocketClient.onConnectionChange(handleConnectionChange);

    // Connect if not already connected
    if (!websocketClient.isConnected()) {
      const token = apiClient.getToken();
      websocketClient.connect(token || undefined);
    } else {
      setConnected(true);
      setState('connected');
    }

    // Update state periodically
    const interval = setInterval(() => {
      setState(websocketClient.getState());
    }, 1000);

    return () => {
      websocketClient.offConnectionChange(handleConnectionChange);
      clearInterval(interval);
    };
  }, []);

  const subscribe = useCallback((channel: string) => {
    websocketClient.subscribe(channel);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    websocketClient.unsubscribe(channel);
  }, []);

  const subscribeBatch = useCallback((channels: string[]) => {
    websocketClient.subscribeBatch(channels);
  }, []);

  const unsubscribeBatch = useCallback((channels: string[]) => {
    websocketClient.unsubscribeBatch(channels);
  }, []);

  // Helper to get all channels for a wallet
  const getWalletChannels = (walletId: string): string[] => [
    `wallet:${walletId}`,
    `wallet:${walletId}:transaction`,
    `wallet:${walletId}:balance`,
    `wallet:${walletId}:confirmation`,
    `wallet:${walletId}:sync`,
  ];

  const subscribeWallet = useCallback((walletId: string) => {
    websocketClient.subscribeBatch(getWalletChannels(walletId));
  }, []);

  const unsubscribeWallet = useCallback((walletId: string) => {
    websocketClient.unsubscribeBatch(getWalletChannels(walletId));
  }, []);

  // Batch subscribe to multiple wallets in a single message (most efficient)
  const subscribeWallets = useCallback((walletIds: string[]) => {
    const channels = walletIds.flatMap(getWalletChannels);
    websocketClient.subscribeBatch(channels);
  }, []);

  // Batch unsubscribe from multiple wallets in a single message
  const unsubscribeWallets = useCallback((walletIds: string[]) => {
    const channels = walletIds.flatMap(getWalletChannels);
    websocketClient.unsubscribeBatch(channels);
  }, []);

  return {
    connected,
    state,
    subscribe,
    unsubscribe,
    subscribeBatch,
    unsubscribeBatch,
    subscribeWallet,
    unsubscribeWallet,
    subscribeWallets,
    unsubscribeWallets,
  };
};
