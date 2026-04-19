import { AlertCircle, CheckCircle, Loader2, Usb } from 'lucide-react';
import { Button } from '../../ui/Button';
import { getDerivationPath, HardwareDeviceType, ScriptType, scriptTypeOptions } from '../importHelpers';
import { XpubData } from '../hooks/useImportState';

export function HardwareImportHeader() {
  return (
    <>
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        Connect Hardware Device
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        Select your device type and connect via USB.
      </p>
    </>
  );
}

export function DeviceTypeSelection({
  hardwareDeviceType,
  ledgerSupported,
  onDeviceTypeSelect,
}: {
  hardwareDeviceType: HardwareDeviceType;
  ledgerSupported: boolean;
  onDeviceTypeSelect: (type: HardwareDeviceType) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
        Device Type
      </label>
      <div className="grid grid-cols-2 gap-3">
        <HardwareDeviceButton
          type="ledger"
          active={hardwareDeviceType === 'ledger'}
          disabled={!ledgerSupported}
          onClick={() => onDeviceTypeSelect('ledger')}
          title="Ledger"
          description={ledgerSupported ? 'Nano S, S Plus, X, Stax, Flex' : 'Requires HTTPS connection'}
        />
        <HardwareDeviceButton
          type="trezor"
          active={hardwareDeviceType === 'trezor'}
          onClick={() => onDeviceTypeSelect('trezor')}
          title="Trezor"
          description="One, Model T, Safe 3/5/7"
          extraDescription="Via Trezor Suite"
        />
      </div>
    </div>
  );
}

function HardwareDeviceButton({
  active,
  description,
  disabled,
  extraDescription,
  onClick,
  title,
  type,
}: {
  active: boolean;
  description: string;
  disabled?: boolean;
  extraDescription?: string;
  onClick: () => void;
  title: string;
  type: HardwareDeviceType;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-4 rounded-lg border text-left transition-colors ${hardwareDeviceButtonClass({ active, disabled })}`}
    >
      <p className={`text-sm font-medium ${hardwareDeviceTitleClass(active)}`}>
        {title}
      </p>
      <p className="text-xs text-sanctuary-500 mt-0.5">{description}</p>
      {extraDescription && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{extraDescription}</p>
      )}
      <span className="sr-only">{type}</span>
    </button>
  );
}

export function TrezorWorkflowNotice({
  hardwareDeviceType,
}: {
  hardwareDeviceType: HardwareDeviceType;
}) {
  if (hardwareDeviceType !== 'trezor') return null;

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-amber-800 dark:text-amber-200">
        <p className="font-medium mb-1">Trezor Suite Required</p>
        <p className="text-amber-700 dark:text-amber-300">
          You'll need to switch between Sanctuary and Trezor Suite to approve requests on your device.
          Keep Trezor Suite open and check it when prompted.
        </p>
      </div>
    </div>
  );
}

export function DeviceConnectionPanel({
  deviceConnected,
  deviceLabel,
  hardwareDeviceType,
  isConnecting,
  ledgerSupported,
  onConnectDevice,
}: {
  deviceConnected: boolean;
  deviceLabel: string | null;
  hardwareDeviceType: HardwareDeviceType;
  isConnecting: boolean;
  ledgerSupported: boolean;
  onConnectDevice: () => void;
}) {
  return (
    <div className="surface-secondary rounded-lg p-6">
      {!deviceConnected ? (
        <DisconnectedDevicePrompt
          hardwareDeviceType={hardwareDeviceType}
          isConnecting={isConnecting}
          ledgerSupported={ledgerSupported}
          onConnectDevice={onConnectDevice}
        />
      ) : (
        <ConnectedDeviceSummary deviceLabel={deviceLabel} />
      )}
    </div>
  );
}

function DisconnectedDevicePrompt({
  hardwareDeviceType,
  isConnecting,
  ledgerSupported,
  onConnectDevice,
}: {
  hardwareDeviceType: HardwareDeviceType;
  isConnecting: boolean;
  ledgerSupported: boolean;
  onConnectDevice: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto w-16 h-16 surface-elevated rounded-full flex items-center justify-center mb-4">
        <Usb className="w-8 h-8 text-sanctuary-400" />
      </div>
      <p className="text-sm text-sanctuary-500 mb-4">
        {hardwareDeviceType === 'trezor'
          ? 'Make sure Trezor Suite desktop app is running and your device is connected.'
          : 'Make sure your Ledger is connected and the Bitcoin app is open.'}
      </p>
      <Button
        onClick={onConnectDevice}
        isLoading={isConnecting}
        disabled={isConnecting || (hardwareDeviceType === 'ledger' && !ledgerSupported)}
      >
        {isConnecting ? 'Connecting...' : 'Connect Device'}
      </Button>
    </div>
  );
}

function ConnectedDeviceSummary({
  deviceLabel,
}: {
  deviceLabel: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-success-100 dark:bg-success-900/30 rounded-full flex items-center justify-center">
        <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />
      </div>
      <div className="flex-1">
        <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
          {deviceLabel}
        </p>
        <p className="text-xs text-success-600 dark:text-success-400">Connected</p>
      </div>
    </div>
  );
}

export function ConnectedHardwareOptions({
  accountIndex,
  isFetchingXpub,
  scriptType,
  xpubData,
  onAccountIndexChange,
  onFetchXpub,
  onScriptTypeSelect,
}: {
  accountIndex: number;
  isFetchingXpub: boolean;
  scriptType: ScriptType;
  xpubData: XpubData | null;
  onAccountIndexChange: (value: string) => void;
  onFetchXpub: () => void;
  onScriptTypeSelect: (type: ScriptType) => void;
}) {
  return (
    <>
      <ScriptTypeSelection
        scriptType={scriptType}
        onScriptTypeSelect={onScriptTypeSelect}
      />
      <AccountIndexInput
        accountIndex={accountIndex}
        onAccountIndexChange={onAccountIndexChange}
      />
      <DerivationPathDisplay scriptType={scriptType} accountIndex={accountIndex} />
      <FetchXpubButton
        isFetchingXpub={isFetchingXpub}
        xpubData={xpubData}
        onFetchXpub={onFetchXpub}
      />
      <XpubResult xpubData={xpubData} />
    </>
  );
}

function ScriptTypeSelection({
  scriptType,
  onScriptTypeSelect,
}: {
  scriptType: ScriptType;
  onScriptTypeSelect: (type: ScriptType) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">
        Script Type
      </label>
      <div className="grid grid-cols-2 gap-3">
        {scriptTypeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onScriptTypeSelect(option.value)}
            className={`p-3 rounded-lg border text-left transition-colors ${scriptTypeButtonClass(scriptType === option.value)}`}
          >
            <p className={`text-sm font-medium ${hardwareDeviceTitleClass(scriptType === option.value)}`}>
              {option.label}
            </p>
            <p className="text-xs text-sanctuary-500 mt-0.5">{option.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountIndexInput({
  accountIndex,
  onAccountIndexChange,
}: {
  accountIndex: number;
  onAccountIndexChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
        Account Index
      </label>
      <input
        type="number"
        min={0}
        max={100}
        value={accountIndex}
        onChange={(event) => onAccountIndexChange(event.target.value)}
        className="w-32 px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <p className="text-xs text-sanctuary-500 mt-1">
        Use 0 for first account, 1 for second, etc.
      </p>
    </div>
  );
}

function DerivationPathDisplay({
  accountIndex,
  scriptType,
}: {
  accountIndex: number;
  scriptType: ScriptType;
}) {
  return (
    <div className="surface-secondary rounded-lg p-4">
      <p className="text-xs text-sanctuary-500 mb-1">Derivation Path</p>
      <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
        {getDerivationPath(scriptType, accountIndex)}
      </p>
    </div>
  );
}

function FetchXpubButton({
  isFetchingXpub,
  xpubData,
  onFetchXpub,
}: {
  isFetchingXpub: boolean;
  xpubData: XpubData | null;
  onFetchXpub: () => void;
}) {
  return (
    <div className="text-center">
      <Button
        onClick={onFetchXpub}
        isLoading={isFetchingXpub}
        disabled={isFetchingXpub}
        variant="secondary"
      >
        {fetchXpubButtonContent(isFetchingXpub, xpubData)}
      </Button>
    </div>
  );
}

function fetchXpubButtonContent(isFetchingXpub: boolean, xpubData: XpubData | null) {
  if (isFetchingXpub) {
    return (
      <>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Fetching from device...
      </>
    );
  }

  return xpubData ? 'Fetch Again' : 'Fetch Xpub from Device';
}

function XpubResult({
  xpubData,
}: {
  xpubData: XpubData | null;
}) {
  if (!xpubData) return null;

  return (
    <div className="surface-secondary rounded-lg p-4 border border-success-200 dark:border-success-800">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle className="w-4 h-4 text-success-600 dark:text-success-400" />
        <p className="text-sm font-medium text-success-700 dark:text-success-400">
          Xpub Retrieved Successfully
        </p>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-sanctuary-500">Fingerprint</p>
          <p className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100">
            {xpubData.fingerprint}
          </p>
        </div>
        <div>
          <p className="text-xs text-sanctuary-500">Extended Public Key</p>
          <p className="font-mono text-xs text-sanctuary-700 dark:text-sanctuary-300 break-all">
            {shortXpub(xpubData.xpub)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function HardwareErrorMessage({
  hardwareError,
}: {
  hardwareError: string | null;
}) {
  if (!hardwareError) return null;

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <span className="text-sm">{hardwareError}</span>
    </div>
  );
}

function hardwareDeviceButtonClass({
  active,
  disabled,
}: {
  active: boolean;
  disabled?: boolean;
}): string {
  if (active) {
    return 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20';
  }

  if (disabled) {
    return 'border-sanctuary-200 dark:border-sanctuary-700 opacity-50 cursor-not-allowed';
  }

  return 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400';
}

function hardwareDeviceTitleClass(active: boolean): string {
  return active
    ? 'text-primary-700 dark:text-primary-400'
    : 'text-sanctuary-900 dark:text-sanctuary-100';
}

function scriptTypeButtonClass(active: boolean): string {
  return active
    ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
    : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400';
}

function shortXpub(xpub: string): string {
  return `${xpub.substring(0, 20)}...${xpub.substring(xpub.length - 20)}`;
}
