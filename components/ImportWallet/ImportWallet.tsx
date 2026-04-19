import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useImportWallet } from '../../hooks/queries/useWallets';
import { useImportState } from './hooks/useImportState';
import { ImportWalletFooter } from './ImportWalletFooter';
import { ImportWalletProgress } from './ImportWalletProgress';
import { ImportWalletStepContent } from './ImportWalletStepContent';
import { useImportWalletActions } from './useImportWalletActions';

export const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const importWalletMutation = useImportWallet();
  const state = useImportState();
  const { handleBack, handleImport, handleNext } = useImportWalletActions({
    state,
    importWalletMutation,
    navigate,
  });

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <ImportWalletProgress step={state.step} onBack={handleBack} />

      <div className="min-h-[400px] flex flex-col justify-between">
        <div className="flex-1">
          <ImportWalletStepContent state={state} />
        </div>

        <ImportWalletFooter
          state={state}
          onNext={handleNext}
          onImport={handleImport}
        />
      </div>
    </div>
  );
};
