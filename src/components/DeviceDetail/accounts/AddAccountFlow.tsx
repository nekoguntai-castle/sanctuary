import React from 'react';
import { AddAccountMethodPanel } from './AddAccountFlow/AddAccountMethodPanel';
import { AddAccountMethodPicker } from './AddAccountFlow/AddAccountMethodPicker';
import { AddAccountModalChrome } from './AddAccountFlow/AddAccountModalChrome';
import { useAddAccountFlow } from './hooks/useAddAccountFlow';
import type { AddAccountMethod } from './types';
import type { AddAccountFlowProps } from './types';

export const AddAccountFlow: React.FC<AddAccountFlowProps> = (props) => {
  const { device, onClose } = props;
  const controller = useAddAccountFlow(props);

  const handleClose = () => {
    controller.resetImportState();
    onClose();
  };

  const handleBack = () => {
    controller.setAddAccountMethod(null);
    controller.setAddAccountError(null);
    controller.resetImportState();
  };

  const handleSelectImportMethod = (method: 'sdcard' | 'qr') => {
    controller.setAddAccountMethod(method);
    controller.resetImportState();
  };

  const method = controller.addAccountMethod as Exclude<AddAccountMethod, null> | null;

  return (
    <AddAccountModalChrome
      addAccountMethod={controller.addAccountMethod}
      addAccountLoading={controller.addAccountLoading}
      addAccountError={controller.addAccountError}
      onClose={handleClose}
      onBack={handleBack}
    >
      {method ? (
        <AddAccountMethodPanel method={method} controller={controller} device={device} />
      ) : (
        <AddAccountMethodPicker
          device={device}
          onSelectMethod={controller.setAddAccountMethod}
          onSelectImportMethod={handleSelectImportMethod}
        />
      )}
    </AddAccountModalChrome>
  );
};
