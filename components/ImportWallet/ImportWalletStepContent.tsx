import { DeviceResolutionStep } from './DeviceResolution';
import { ImportReview } from './ImportReview';
import type { ImportWalletState } from './types';
import { DescriptorInput } from './steps/DescriptorInput';
import { FormatSelection } from './steps/FormatSelection';
import { HardwareImport } from './steps/HardwareImport';
import { QrScanStep } from './steps/QrScanStep';

export function ImportWalletStepContent({
  state,
}: {
  state: ImportWalletState;
}) {
  if (state.step === 1) {
    return (
      <FormatSelection
        format={state.format}
        setFormat={state.setFormat}
      />
    );
  }

  if (state.step === 2) {
    return <ImportDataStep state={state} />;
  }

  if (state.step === 3 && state.validationResult) {
    return (
      <DeviceResolutionStep
        validationResult={state.validationResult}
        walletName={state.walletName}
        setWalletName={state.setWalletName}
        network={state.network}
        setNetwork={state.setNetwork}
      />
    );
  }

  if (state.step === 4 && state.validationResult) {
    return (
      <ImportReview
        validationResult={state.validationResult}
        walletName={state.walletName}
        network={state.network}
        importError={state.importError}
      />
    );
  }

  return null;
}

function ImportDataStep({
  state,
}: {
  state: ImportWalletState;
}) {
  if (state.format === 'hardware') {
    return (
      <HardwareImport
        hardwareDeviceType={state.hardwareDeviceType}
        setHardwareDeviceType={state.setHardwareDeviceType}
        deviceConnected={state.deviceConnected}
        setDeviceConnected={state.setDeviceConnected}
        deviceLabel={state.deviceLabel}
        setDeviceLabel={state.setDeviceLabel}
        scriptType={state.scriptType}
        setScriptType={state.setScriptType}
        accountIndex={state.accountIndex}
        setAccountIndex={state.setAccountIndex}
        xpubData={state.xpubData}
        setXpubData={state.setXpubData}
        isFetchingXpub={state.isFetchingXpub}
        setIsFetchingXpub={state.setIsFetchingXpub}
        isConnecting={state.isConnecting}
        setIsConnecting={state.setIsConnecting}
        hardwareError={state.hardwareError}
        setHardwareError={state.setHardwareError}
      />
    );
  }

  if (state.format === 'qr_code') {
    return (
      <QrScanStep
        cameraActive={state.cameraActive}
        setCameraActive={state.setCameraActive}
        cameraError={state.cameraError}
        setCameraError={state.setCameraError}
        urProgress={state.urProgress}
        setUrProgress={state.setUrProgress}
        qrScanned={state.qrScanned}
        setQrScanned={state.setQrScanned}
        setImportData={state.setImportData}
        validationError={state.validationError}
        setValidationError={state.setValidationError}
        bytesDecoderRef={state.bytesDecoderRef}
      />
    );
  }

  return (
    <DescriptorInput
      format={state.format}
      importData={state.importData}
      setImportData={state.setImportData}
      validationError={state.validationError}
      setValidationError={state.setValidationError}
    />
  );
}
