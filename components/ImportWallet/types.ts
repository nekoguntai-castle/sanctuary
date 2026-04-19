import type { useImportState } from './hooks/useImportState';

export type ImportWalletState = ReturnType<typeof useImportState>;

export interface ImportWalletMutation {
  mutateAsync: (input: {
    data: string;
    name: string;
    network: ImportWalletState['network'];
  }) => Promise<{ wallet: { id: string } }>;
}
