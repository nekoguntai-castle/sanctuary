export interface VariablesController {
  loading: boolean;
  loadError: string | null;
  retryLoad: () => Promise<void>;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  dustThreshold: number;
  saveSuccess: boolean;
  displayError: string | null;
  isSaving: boolean;
  handleConfirmationThresholdChange: (value: string) => void;
  handleDeepConfirmationThresholdChange: (value: string) => void;
  handleDustThresholdChange: (value: string) => void;
  handleSave: () => Promise<void>;
}
