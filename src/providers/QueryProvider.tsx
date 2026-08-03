import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Create a client with sensible defaults for a wallet application
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30_000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Only retry once on failure
      retry: 1,
      // Don't refetch on window focus (user controls refresh)
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect automatically
      refetchOnReconnect: false,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
    },
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

// Export the query client for use in invalidation helpers
export { queryClient };

// Getter function for easier mocking in tests
// This avoids dynamic import timing issues in test environments
export const getQueryClient = () => queryClient;
