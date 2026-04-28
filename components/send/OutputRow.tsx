/**
 * OutputRow Component
 *
 * Single output row for multi-output transactions including:
 * - Address input (with consolidation dropdown option)
 * - Amount input with send-max toggle
 * - QR scanner trigger
 * - Validation display
 * - Payjoin indicator
 *
 * Extracted from SendTransaction.tsx for maintainability.
 */

import { useState, useCallback, useEffect } from "react";
import { Scanner, IDetectedBarcode } from "@yudiel/react-qr-scanner";
import {
  Check,
  X,
  Shield,
  QrCode,
  ChevronDown,
  Trash2,
  Camera,
  AlertCircle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { FiatDisplaySubtle } from "../FiatDisplay";
import type { OutputEntry, WalletAddress } from "../../contexts/send/types";
import {
  getAddressBorderClass,
  getAmountInputClass,
  getAmountInputValue,
  getCameraErrorMessage,
  getMaxButtonClass,
  getReceiveAddresses,
  isAmountInputValueAllowed,
  isSecureBrowserContext,
} from "./OutputRowModel";

export interface OutputRowProps {
  // Output data
  output: OutputEntry;
  index: number;
  totalOutputs: number;
  isValid: boolean | null;

  // Handlers
  onAddressChange: (index: number, value: string) => void;
  onAmountChange: (
    index: number,
    displayValue: string,
    satsValue: string,
  ) => void;
  onAmountBlur: (index: number) => void;
  onRemove: (index: number) => void;
  onToggleSendMax: (index: number) => void;
  onScanQR: (index: number) => void;

  // Consolidation mode
  isConsolidation?: boolean;
  walletAddresses?: WalletAddress[];

  // State flags
  disabled?: boolean;
  showScanner?: boolean;
  scanningOutputIndex?: number | null;

  // Payjoin
  payjoinUrl?: string | null;
  payjoinStatus?: "idle" | "attempting" | "success" | "failed";

  // Currency display
  unit: string;
  unitLabel: string;
  displayValue: string;

  // Max amount calculation
  maxAmount: number;
  formatAmount: (sats: number) => string;

  // Fiat display - amount in sats for fiat conversion
  fiatAmount?: number;
}

function OutputHeader({
  isMultiOutput,
  index,
  disabled,
  onRemove,
}: {
  isMultiOutput: boolean;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  if (!isMultiOutput) {
    return null;
  }

  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-sanctuary-500">
        Output #{index + 1}
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-sanctuary-400 hover:text-rose-500 transition-colors"
          title="Remove output"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ConsolidationAddressSelect({
  output,
  index,
  walletAddresses,
  disabled,
  onAddressChange,
}: {
  output: OutputEntry;
  index: number;
  walletAddresses: WalletAddress[];
  disabled: boolean;
  onAddressChange: (index: number, value: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={output.address}
        onChange={(e) => onAddressChange(index, e.target.value)}
        disabled={disabled}
        className={`block w-full px-4 py-3 rounded-md border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors appearance-none pr-10 font-mono text-sm ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {getReceiveAddresses(walletAddresses).map((addr) => (
          <option
            key={addr.address}
            value={addr.address}
            className={addr.used ? "text-sanctuary-400" : ""}
          >
            #{addr.index}: {addr.address.slice(0, 12)}...
            {addr.address.slice(-8)}
            {addr.used ? " (used)" : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-4 top-3.5 w-5 h-5 text-sanctuary-400 pointer-events-none" />
    </div>
  );
}

function AddressStatusIcon({
  hasPayjoin,
  isValid,
}: {
  hasPayjoin: boolean;
  isValid: boolean | null;
}) {
  if (hasPayjoin) {
    return (
      <Shield className="absolute right-4 top-3 w-4 h-4 text-zen-indigo" />
    );
  }

  if (isValid === true) {
    return <Check className="absolute right-4 top-3 w-4 h-4 text-green-500" />;
  }

  if (isValid === false) {
    return <X className="absolute right-4 top-3 w-4 h-4 text-rose-500" />;
  }

  return null;
}

function StandardAddressInput({
  output,
  index,
  isValid,
  disabled,
  hasPayjoin,
  isScanningThis,
  onAddressChange,
  onScanQR,
}: {
  output: OutputEntry;
  index: number;
  isValid: boolean | null;
  disabled: boolean;
  hasPayjoin: boolean;
  isScanningThis: boolean;
  onAddressChange: (index: number, value: string) => void;
  onScanQR: (index: number) => void;
}) {
  return (
    <div className="flex space-x-2">
      <div className="flex-1 relative">
        <input
          type="text"
          value={output.address}
          onChange={(e) => onAddressChange(index, e.target.value)}
          disabled={disabled}
          placeholder="bc1q... or bitcoin:..."
          className={`block w-full px-4 py-2.5 rounded-md border ${getAddressBorderClass(isValid, hasPayjoin)} surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors text-sm ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        />
        <AddressStatusIcon hasPayjoin={hasPayjoin} isValid={isValid} />
      </div>
      {!disabled && (
        <Button variant="secondary" size="sm" onClick={() => onScanQR(index)}>
          {isScanningThis ? (
            <X className="w-4 h-4" />
          ) : (
            <QrCode className="w-4 h-4" />
          )}
        </Button>
      )}
    </div>
  );
}

function AddressSection({
  output,
  index,
  isValid,
  disabled,
  hasPayjoin,
  isScanningThis,
  isConsolidation,
  walletAddresses,
  onAddressChange,
  onScanQR,
}: {
  output: OutputEntry;
  index: number;
  isValid: boolean | null;
  disabled: boolean;
  hasPayjoin: boolean;
  isScanningThis: boolean;
  isConsolidation: boolean;
  walletAddresses: WalletAddress[];
  onAddressChange: (index: number, value: string) => void;
  onScanQR: (index: number) => void;
}) {
  if (isConsolidation && index === 0) {
    return (
      <ConsolidationAddressSelect
        output={output}
        index={index}
        walletAddresses={walletAddresses}
        disabled={disabled}
        onAddressChange={onAddressChange}
      />
    );
  }

  return (
    <StandardAddressInput
      output={output}
      index={index}
      isValid={isValid}
      disabled={disabled}
      hasPayjoin={hasPayjoin}
      isScanningThis={isScanningThis}
      onAddressChange={onAddressChange}
      onScanQR={onScanQR}
    />
  );
}

function ValidationError({
  isConsolidation,
  isValid,
}: {
  isConsolidation: boolean;
  isValid: boolean | null;
}) {
  if (isConsolidation || isValid !== false) {
    return null;
  }

  return <p className="text-xs text-rose-500">Invalid Bitcoin address</p>;
}

function PayjoinIndicator({
  hasPayjoin,
  payjoinStatus,
}: {
  hasPayjoin: boolean;
  payjoinStatus: NonNullable<OutputRowProps["payjoinStatus"]>;
}) {
  if (!hasPayjoin) {
    return null;
  }

  return (
    <div className="flex items-center space-x-1.5 mt-1">
      <Shield className="w-3 h-3 text-zen-indigo" />
      <p className="text-xs text-zen-indigo">
        Payjoin enabled - enhanced privacy for this transaction
        {payjoinStatus === "attempting" && " (attempting...)"}
        {payjoinStatus === "success" && " ✓"}
        {payjoinStatus === "failed" && " (fell back to regular send)"}
      </p>
    </div>
  );
}

function ScannerStartPanel({
  isSecure,
  onStartCamera,
  onStopCamera,
}: {
  isSecure: boolean;
  onStartCamera: () => void;
  onStopCamera: () => void;
}) {
  return (
    <div className="text-center py-6">
      <Camera className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
      <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-3 px-4">
        Scan a Bitcoin address or BIP21 payment URI
      </p>
      {!isSecure && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 px-4">
          Camera access requires HTTPS. Please use https://localhost:8443
        </p>
      )}
      <div className="flex justify-center gap-2">
        <Button size="sm" onClick={onStartCamera}>
          Start Camera
        </Button>
        <Button size="sm" variant="secondary" onClick={onStopCamera}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ActiveCameraPanel({
  onQrScan,
  onCameraError,
  onStopCamera,
}: {
  onQrScan: (detectedCodes: IDetectedBarcode[]) => void;
  onCameraError: (error: unknown) => void;
  onStopCamera: () => void;
}) {
  return (
    <div className="relative">
      <div className="aspect-square max-w-xs mx-auto">
        <Scanner
          onScan={onQrScan}
          onError={onCameraError}
          constraints={{ facingMode: "environment" }}
          scanDelay={100}
          styles={{
            container: { width: "100%", height: "100%" },
            video: { width: "100%", height: "100%", objectFit: "cover" },
          }}
        />
      </div>
      <button
        onClick={onStopCamera}
        className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-xs text-center text-sanctuary-500 py-2">
        Position the QR code within the frame
      </p>
    </div>
  );
}

function CameraErrorPanel({
  cameraError,
  onStartCamera,
  onStopCamera,
}: {
  cameraError: string;
  onStartCamera: () => void;
  onStopCamera: () => void;
}) {
  return (
    <div className="text-center py-6">
      <AlertCircle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
      <p className="text-sm text-rose-600 dark:text-rose-400 mb-3 px-4">
        {cameraError}
      </p>
      <div className="flex justify-center gap-2">
        <Button size="sm" onClick={onStartCamera}>
          Try Again
        </Button>
        <Button size="sm" variant="secondary" onClick={onStopCamera}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ScannerPanel({
  isScanningThis,
  cameraActive,
  cameraError,
  isSecure,
  onQrScan,
  onCameraError,
  onStartCamera,
  onStopCamera,
}: {
  isScanningThis: boolean;
  cameraActive: boolean;
  cameraError: string | null;
  isSecure: boolean;
  onQrScan: (detectedCodes: IDetectedBarcode[]) => void;
  onCameraError: (error: unknown) => void;
  onStartCamera: () => void;
  onStopCamera: () => void;
}) {
  if (!isScanningThis) {
    return null;
  }

  return (
    <div className="surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
      {!cameraActive && !cameraError && (
        <ScannerStartPanel
          isSecure={isSecure}
          onStartCamera={onStartCamera}
          onStopCamera={onStopCamera}
        />
      )}
      {cameraActive && (
        <ActiveCameraPanel
          onQrScan={onQrScan}
          onCameraError={onCameraError}
          onStopCamera={onStopCamera}
        />
      )}
      {cameraError && (
        <CameraErrorPanel
          cameraError={cameraError}
          onStartCamera={onStartCamera}
          onStopCamera={onStopCamera}
        />
      )}
    </div>
  );
}

function AmountSection({
  output,
  index,
  unit,
  unitLabel,
  displayValue,
  maxAmount,
  disabled,
  formatAmount,
  fiatAmount,
  onAmountChange,
  onAmountBlur,
  onToggleSendMax,
}: {
  output: OutputEntry;
  index: number;
  unit: string;
  unitLabel: string;
  displayValue: string;
  maxAmount: number;
  disabled: boolean;
  formatAmount: (sats: number) => string;
  fiatAmount?: number;
  onAmountChange: (
    index: number,
    displayValue: string,
    satsValue: string,
  ) => void;
  onAmountBlur: (index: number) => void;
  onToggleSendMax: (index: number) => void;
}) {
  function handleAmountChange(value: string) {
    if (isAmountInputValueAllowed(value, unit)) {
      onAmountChange(index, value, value);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <div className="flex-1 relative">
          <input
            type="text"
            inputMode={unit === "btc" ? "decimal" : "numeric"}
            value={getAmountInputValue(
              output,
              maxAmount,
              displayValue,
              formatAmount,
            )}
            onChange={(e) => handleAmountChange(e.target.value)}
            onBlur={() => onAmountBlur(index)}
            placeholder="0"
            readOnly={output.sendMax || disabled}
            disabled={disabled}
            className={getAmountInputClass(output, disabled)}
          />
          <div className="absolute right-3 top-2.5 text-sanctuary-400 text-xs flex items-center">
            {output.sendMax && !disabled && (
              <button
                type="button"
                onClick={() => onToggleSendMax(index)}
                className="mr-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-primary-500 dark:bg-sanctuary-600 text-white dark:text-sanctuary-100 rounded hover:bg-primary-600 dark:hover:bg-sanctuary-500 transition-colors"
                title="Click to exit MAX mode"
              >
                MAX
              </button>
            )}
            <span className="pointer-events-none">{unitLabel}</span>
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onToggleSendMax(index)}
            className={getMaxButtonClass(Boolean(output.sendMax))}
          >
            MAX
          </button>
        )}
      </div>
      {fiatAmount !== undefined && fiatAmount > 0 && (
        <div className="pl-1">
          <FiatDisplaySubtle sats={fiatAmount} size="xs" showApprox />
        </div>
      )}
    </div>
  );
}

export function OutputRow({
  output,
  index,
  totalOutputs,
  isValid,
  onAddressChange,
  onAmountChange,
  onAmountBlur,
  onRemove,
  onToggleSendMax,
  onScanQR,
  isConsolidation = false,
  walletAddresses = [],
  disabled = false,
  showScanner = false,
  scanningOutputIndex = null,
  payjoinUrl = null,
  payjoinStatus = "idle",
  unit,
  unitLabel,
  displayValue,
  maxAmount,
  formatAmount,
  fiatAmount,
}: OutputRowProps) {
  const isMultiOutput = totalOutputs > 1;
  const isScanningThis = showScanner && scanningOutputIndex === index;
  const hasPayjoin = Boolean(payjoinUrl && index === 0);

  // QR Scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isSecure = isSecureBrowserContext();

  // Reset scanner state when toggled off externally (e.g., parent changes scanningOutputIndex)
  useEffect(() => {
    if (!isScanningThis) {
      setCameraActive(false);
      setCameraError(null);
    }
  }, [isScanningThis]);

  // Handle QR scan result
  const handleQrScan = useCallback(
    (detectedCodes: IDetectedBarcode[]) => {
      if (detectedCodes.length > 0) {
        const scannedValue = detectedCodes[0].rawValue;
        if (scannedValue) {
          // Update the address field with the scanned value
          onAddressChange(index, scannedValue);
          // Close the scanner
          setCameraActive(false);
          onScanQR(index); // Toggle off the scanner
        }
      }
    },
    [index, onAddressChange, onScanQR],
  );

  // Handle camera error
  const handleCameraError = useCallback((error: unknown) => {
    setCameraError(getCameraErrorMessage(error));
  }, []);

  // Start camera
  const handleStartCamera = useCallback(() => {
    setCameraError(null);
    setCameraActive(true);
  }, []);

  // Stop camera
  const handleStopCamera = useCallback(() => {
    setCameraActive(false);
    setCameraError(null);
    onScanQR(index); // Toggle off the scanner
  }, [index, onScanQR]);

  return (
    <div
      className={`space-y-2 ${isMultiOutput ? "p-3 rounded-lg surface-secondary border border-sanctuary-200 dark:border-sanctuary-700" : ""}`}
    >
      <OutputHeader
        isMultiOutput={isMultiOutput}
        index={index}
        disabled={disabled}
        onRemove={onRemove}
      />
      <AddressSection
        output={output}
        index={index}
        isValid={isValid}
        disabled={disabled}
        hasPayjoin={hasPayjoin}
        isScanningThis={isScanningThis}
        isConsolidation={isConsolidation}
        walletAddresses={walletAddresses}
        onAddressChange={onAddressChange}
        onScanQR={onScanQR}
      />
      <ValidationError isConsolidation={isConsolidation} isValid={isValid} />
      <PayjoinIndicator hasPayjoin={hasPayjoin} payjoinStatus={payjoinStatus} />
      <ScannerPanel
        isScanningThis={isScanningThis}
        cameraActive={cameraActive}
        cameraError={cameraError}
        isSecure={isSecure}
        onQrScan={handleQrScan}
        onCameraError={handleCameraError}
        onStartCamera={handleStartCamera}
        onStopCamera={handleStopCamera}
      />
      <AmountSection
        output={output}
        index={index}
        unit={unit}
        unitLabel={unitLabel}
        displayValue={displayValue}
        maxAmount={maxAmount}
        disabled={disabled}
        formatAmount={formatAmount}
        fiatAmount={fiatAmount}
        onAmountChange={onAmountChange}
        onAmountBlur={onAmountBlur}
        onToggleSendMax={onToggleSendMax}
      />
    </div>
  );
}
