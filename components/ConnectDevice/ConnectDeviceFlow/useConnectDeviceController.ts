import { useState } from 'react';
import type { HardwareDeviceModel } from '../../../src/api/devices';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { useDeviceConnection } from '../../../hooks/useDeviceConnection';
import { useDeviceModels } from '../../../hooks/useDeviceModels';
import { useDeviceSave } from '../../../hooks/useDeviceSave';
import { useQrScanner } from '../../../hooks/qr/useQrScanner';
import { getAvailableMethods } from '../../../utils/deviceConnection';
import { useDeviceForm } from '../hooks/useDeviceForm';

export function useConnectDeviceController() {
  const [selectedModel, setSelectedModel] = useState<HardwareDeviceModel | null>(null);
  const models = useDeviceModels();
  const save = useDeviceSave();
  const qr = useQrScanner();
  const usb = useDeviceConnection();
  const form = useDeviceForm({
    selectedModel,
    scanResult: qr.scanResult,
    connectionResult: usb.connectionResult,
    saveDevice: save.saveDevice,
    mergeDevice: save.mergeDevice,
    resetQr: qr.reset,
    resetUsb: usb.reset,
    resetSave: save.reset,
  });
  const secureContext = isSecureContext();
  const availableMethods = selectedModel ? getAvailableMethods(selectedModel.connectivity, secureContext) : [];
  const error = save.error || qr.error || usb.error || models.error;

  return {
    availableMethods,
    error,
    form: {
      ...form,
      toggleQrDetails: () => form.setShowQrDetails(!form.showQrDetails),
    },
    models,
    qr,
    save,
    secureContext,
    selectedModel,
    setSelectedModel,
    usb,
  };
}

export type ConnectDeviceController = ReturnType<typeof useConnectDeviceController>;
