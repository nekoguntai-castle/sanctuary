import type { useImportState } from './hooks/useImportState';
import type { TabNetwork } from '../../src/app/networks';

export type ImportWalletState = ReturnType<typeof useImportState>;

export interface ImportWalletMutation {
  mutateAsync: (input: {
    data: string;
    name: string;
    network: TabNetwork;
  }) => Promise<{ wallet: { id: string } }>;
}
