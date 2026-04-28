/**
 * useAddAccountFlow Hook
 *
 * Encapsulates all state management and handlers for the AddAccountFlow component.
 * Manages import methods (USB, QR, file, manual), UR decoder refs, and account processing.
 */

import { useState, useRef, useCallback, type MutableRefObject } from "react";
import { URRegistryDecoder } from "@keystonehq/bc-ur-registry";
import { URDecoder as BytesURDecoder } from "@ngraveio/bc-ur";
import {
  DeviceAccount as ParsedDeviceAccount,
  parseDeviceJson,
} from "../../../../services/deviceParsers";
import type { DeviceType } from "../../../../services/hardwareWallet/types";
import { getDevice, addDeviceAccount } from "../../../../src/api/devices";
import { createLogger } from "../../../../utils/logger";
import { extractFromUrResult, normalizeDerivationPath } from "../urHelpers";
import {
  processImportedAccounts,
  parseFileContent,
  createSingleAccount,
} from "../accountImportUtils";
import type { ManualAccountData } from "../../ManualAccountForm";
import type { AccountConflict } from "../ImportReview";
import type {
  AddAccountFlowProps,
  AddAccountMethod,
  QrMode,
  UsbProgress,
} from "../types";

const log = createLogger("DeviceDetail");

type QrScanResult = { rawValue: string }[] | null | undefined;

type ParsedQrImport = {
  accounts: ParsedDeviceAccount[];
  fingerprint: string;
  format?: string;
};

type QrImportContext = {
  urDecoderRef: MutableRefObject<URRegistryDecoder | null>;
  bytesDecoderRef: MutableRefObject<BytesURDecoder | null>;
  setCameraActive: (active: boolean) => void;
  setAddAccountLoading: (loading: boolean) => void;
  setAddAccountError: (error: string | null) => void;
  setUrProgress: (progress: number) => void;
  processImportedAccounts: (
    accounts: ParsedDeviceAccount[],
    fingerprint: string,
  ) => void;
};

const firstQrContent = (result: QrScanResult): string | null => {
  if (!result || result.length === 0) return null;
  return result[0].rawValue;
};

const qrUrType = (contentLower: string): string => {
  const urTypeMatch = contentLower.match(/^ur:([a-z0-9-]+)/);
  return urTypeMatch ? urTypeMatch[1] : "unknown";
};

const qrImportFromBytesPayload = (
  parseResult: ReturnType<typeof parseDeviceJson>,
): ParsedQrImport | null => {
  if (!parseResult) return null;

  if (parseResult.accounts) {
    return {
      accounts: parseResult.accounts,
      fingerprint: parseResult.fingerprint || "",
      format: parseResult.format,
    };
  }

  if (parseResult.xpub) {
    return {
      accounts: [createSingleAccount(parseResult)],
      fingerprint: parseResult.fingerprint || "",
      format: parseResult.format,
    };
  }

  return null;
};

const qrImportFromPlainPayload = (
  parseResult: ReturnType<typeof parseDeviceJson>,
): ParsedQrImport | null => {
  if (parseResult?.accounts && parseResult.accounts.length > 0) {
    return {
      accounts: parseResult.accounts,
      fingerprint: parseResult.fingerprint || "",
      format: parseResult.format,
    };
  }

  if (parseResult?.xpub) {
    return {
      accounts: [createSingleAccount(parseResult)],
      fingerprint: parseResult.fingerprint || "",
      format: parseResult.format,
    };
  }

  return null;
};

const qrImportFromUrExtraction = (
  extracted: ReturnType<typeof extractFromUrResult>,
): ParsedQrImport | null => {
  if (!extracted?.xpub) return null;

  return {
    accounts: [
      {
        purpose: extracted.path.includes("48'") ? "multisig" : "single_sig",
        scriptType: "native_segwit",
        derivationPath:
          normalizeDerivationPath(extracted.path) || "m/84'/0'/0'",
        xpub: extracted.xpub,
      },
    ],
    fingerprint: extracted.fingerprint || "",
  };
};

const receiveBytesUrPart = (
  content: string,
  context: QrImportContext,
): BytesURDecoder | null => {
  if (!context.bytesDecoderRef.current) {
    context.bytesDecoderRef.current = new BytesURDecoder();
  }

  const decoder = context.bytesDecoderRef.current;
  decoder.receivePart(content);
  context.setUrProgress(Math.round(decoder.estimatedPercentComplete() * 100));
  return decoder.isComplete() === true ? decoder : null;
};

const receiveRegistryUrPart = (
  content: string,
  context: QrImportContext,
): URRegistryDecoder | null => {
  if (!context.urDecoderRef.current) {
    context.urDecoderRef.current = new URRegistryDecoder();
  }

  const decoder = context.urDecoderRef.current;
  decoder.receivePart(content);
  context.setUrProgress(Math.round(decoder.estimatedPercentComplete() * 100));
  return decoder.isComplete() ? decoder : null;
};

const decodedBytesQrImport = (decoder: BytesURDecoder): ParsedQrImport => {
  if (!decoder.isSuccess()) {
    throw new Error("UR bytes decode failed");
  }

  const decodedUR = decoder.resultUR();
  const rawBytes = decodedUR.decodeCBOR();
  const textDecoder = new TextDecoder("utf-8");
  const parseResult = parseDeviceJson(textDecoder.decode(rawBytes));
  const parsedImport = qrImportFromBytesPayload(parseResult);

  if (!parsedImport) {
    throw new Error("Could not extract accounts from ur:bytes");
  }

  return parsedImport;
};

const decodedRegistryQrImport = (
  decoder: URRegistryDecoder,
): ParsedQrImport => {
  if (!decoder.isSuccess()) {
    throw new Error("UR decode failed");
  }

  const extracted = extractFromUrResult(decoder.resultRegistryType());
  const parsedImport = qrImportFromUrExtraction(extracted);

  if (!parsedImport) {
    throw new Error("Could not extract xpub from UR");
  }

  return parsedImport;
};

const completeQrImport = (
  parsedImport: ParsedQrImport,
  context: QrImportContext,
) => {
  context.processImportedAccounts(
    parsedImport.accounts,
    parsedImport.fingerprint,
  );
  context.setAddAccountLoading(false);
  context.setUrProgress(0);
};

const processBytesUrQr = (
  content: string,
  context: QrImportContext,
): boolean => {
  const decoder = receiveBytesUrPart(content, context);
  if (!decoder) return false;

  context.setCameraActive(false);
  context.setAddAccountLoading(true);
  completeQrImport(decodedBytesQrImport(decoder), context);
  context.bytesDecoderRef.current = null;
  return true;
};

const processRegistryUrQr = (
  content: string,
  context: QrImportContext,
): boolean => {
  const decoder = receiveRegistryUrPart(content, context);
  if (!decoder) return false;

  context.setCameraActive(false);
  context.setAddAccountLoading(true);
  completeQrImport(decodedRegistryQrImport(decoder), context);
  context.urDecoderRef.current = null;
  return true;
};

const resetUrDecodersAfterError = (context: QrImportContext, err: unknown) => {
  log.error("Failed to decode UR QR code", { err });
  context.setAddAccountError(
    err instanceof Error ? err.message : "Failed to decode UR QR code",
  );
  context.setCameraActive(false);
  context.setAddAccountLoading(false);
  context.setUrProgress(0);
  context.urDecoderRef.current = null;
  context.bytesDecoderRef.current = null;
};

const processUrQr = (
  content: string,
  contentLower: string,
  context: QrImportContext,
) => {
  try {
    if (qrUrType(contentLower) === "bytes") {
      processBytesUrQr(content, context);
      return;
    }

    processRegistryUrQr(content, context);
  } catch (err) {
    resetUrDecodersAfterError(context, err);
  }
};

const processPlainQr = (content: string, context: QrImportContext) => {
  context.setCameraActive(false);
  context.setAddAccountLoading(true);

  const parseResult = parseDeviceJson(content);
  const parsedImport = qrImportFromPlainPayload(parseResult);
  if (parsedImport) {
    context.processImportedAccounts(
      parsedImport.accounts,
      parsedImport.fingerprint,
    );
    log.info("QR code parsed successfully", { format: parsedImport.format });
  } else {
    context.setAddAccountError("Could not find valid account data in QR code");
  }

  context.setAddAccountLoading(false);
};

/** Helper to get device type from device model */
const getDeviceTypeFromDeviceModel = (
  device: AddAccountFlowProps["device"],
): DeviceType | null => {
  const type = device.type?.toLowerCase();
  if (type?.includes("trezor")) return "trezor";
  if (type?.includes("ledger")) return "ledger";
  if (type?.includes("coldcard")) return "coldcard";
  if (type?.includes("bitbox")) return "bitbox";
  if (type?.includes("jade")) return "jade";
  return null;
};

export { getDeviceTypeFromDeviceModel };

export function useAddAccountFlow({
  deviceId,
  device,
  onClose,
  onDeviceUpdated,
}: AddAccountFlowProps) {
  // Method selection
  const [addAccountMethod, setAddAccountMethod] =
    useState<AddAccountMethod>(null);
  const [addAccountLoading, setAddAccountLoading] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  const [usbProgress, setUsbProgress] = useState<UsbProgress | null>(null);
  const [manualAccount, setManualAccount] = useState<ManualAccountData>({
    purpose: "multisig",
    scriptType: "native_segwit",
    derivationPath: "m/48'/0'/0'/2'",
    xpub: "",
  });

  // QR scanning state
  const [qrMode, setQrMode] = useState<QrMode>("camera");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState<number>(0);
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null);

  // Parsed accounts from file/QR import
  const [parsedAccounts, setParsedAccounts] = useState<ParsedDeviceAccount[]>(
    [],
  );
  const [selectedParsedAccounts, setSelectedParsedAccounts] = useState<
    Set<number>
  >(new Set());
  const [importFingerprint, setImportFingerprint] = useState<string>("");
  const [accountConflict, setAccountConflict] =
    useState<AccountConflict | null>(null);

  /**
   * Process parsed accounts - compare with existing device accounts using pure utility,
   * then update component state accordingly.
   */
  const handleProcessImportedAccounts = useCallback(
    (accounts: ParsedDeviceAccount[], fingerprint: string) => {
      const result = processImportedAccounts(accounts, fingerprint, device);

      if (result.error) {
        setAddAccountError(result.error);
        return;
      }

      const newAccounts = result.newAccounts!;
      setParsedAccounts(newAccounts);
      setSelectedParsedAccounts(new Set(newAccounts.map((_, i) => i)));
      setImportFingerprint(fingerprint);
      setAccountConflict({
        existingAccounts: device.accounts || [],
        newAccounts,
        matchingAccounts: result.matchingAccounts || [],
      });
    },
    [device],
  );

  /**
   * Handle file upload for SD card import
   */
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setAddAccountLoading(true);
      setAddAccountError(null);

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const parseResult = parseDeviceJson(content);
        const parsed = parseFileContent(parseResult);

        if (parsed) {
          handleProcessImportedAccounts(parsed.accounts, parsed.fingerprint);
          log.info("File parsed with accounts", {
            format: parseResult?.format,
            accountCount: parsed.accounts.length,
          });
          setAddAccountLoading(false);
        } else {
          setAddAccountError("Could not parse file. Please check the format.");
          setAddAccountLoading(false);
        }
      };
      reader.onerror = () => {
        setAddAccountError("Failed to read file.");
        setAddAccountLoading(false);
      };
      reader.readAsText(file);
    },
    [handleProcessImportedAccounts],
  );

  /**
   * Handle QR code scan result
   */
  const handleQrScan = useCallback(
    (result: { rawValue: string }[]) => {
      const content = firstQrContent(result);
      if (content === null) return;

      const contentLower = content.toLowerCase();

      log.info("QR code scanned", {
        length: content.length,
        prefix: content.substring(0, 50),
      });

      const qrContext: QrImportContext = {
        urDecoderRef,
        bytesDecoderRef,
        setCameraActive,
        setAddAccountLoading,
        setAddAccountError,
        setUrProgress,
        processImportedAccounts: handleProcessImportedAccounts,
      };

      if (contentLower.startsWith("ur:")) {
        processUrQr(content, contentLower, qrContext);
        return;
      }

      processPlainQr(content, qrContext);
    },
    [handleProcessImportedAccounts],
  );

  const handleCameraError = useCallback((error: unknown) => {
    log.error("Camera error", { error });
    setCameraActive(false);
    if (error instanceof Error) {
      if (error.name === "NotAllowedError") {
        setCameraError(
          "Camera access denied. Please allow camera permissions.",
        );
      } else if (error.name === "NotFoundError") {
        setCameraError("No camera found on this device.");
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
    } else {
      setCameraError("Failed to access camera. Make sure you are using HTTPS.");
    }
  }, []);

  /**
   * Reset import state
   */
  const resetImportState = useCallback(() => {
    setParsedAccounts([]);
    setSelectedParsedAccounts(new Set());
    setAccountConflict(null);
    setImportFingerprint("");
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
  }, []);

  // Add accounts via USB connection
  const handleAddAccountsViaUsb = useCallback(async () => {
    const deviceType = getDeviceTypeFromDeviceModel(device);
    if (!deviceType) {
      setAddAccountError("USB connection not supported for this device type");
      return;
    }

    setAddAccountLoading(true);
    setAddAccountError(null);
    setUsbProgress(null);
    let disconnectFromDevice: () => Promise<void> = Promise.resolve.bind(
      Promise,
    ) as () => Promise<void>;

    try {
      // Defer hardware runtime import until USB flow is actually used.
      const { hardwareWalletService } =
        await import("../../../../services/hardwareWallet/runtime");
      disconnectFromDevice = hardwareWalletService.disconnect.bind(
        hardwareWalletService,
      );

      // Connect to the device
      await hardwareWalletService.connect(deviceType);

      // Fetch all xpubs
      const allXpubs = await hardwareWalletService.getAllXpubs(
        (current, total, name) => {
          setUsbProgress({ current, total, name });
        },
      );

      // Filter out accounts that already exist on this device
      const existingPaths = new Set(
        device.accounts?.map((a) => a.derivationPath) || [],
      );
      const newAccounts = allXpubs.filter((x) => !existingPaths.has(x.path));

      if (newAccounts.length === 0) {
        setAddAccountError(
          "No new accounts to add. All derivation paths already exist on this device.",
        );
        return;
      }

      // Add each new account
      let addedCount = 0;
      for (const account of newAccounts) {
        try {
          await addDeviceAccount(deviceId, {
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.path,
            xpub: account.xpub,
          });
          addedCount++;
        } catch (err) {
          log.warn("Failed to add account", { path: account.path, err });
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info("Added accounts via USB", {
        addedCount,
        totalFetched: allXpubs.length,
      });
    } catch (err) {
      log.error("Failed to add accounts via USB", { err });
      setAddAccountError(
        err instanceof Error ? err.message : "Failed to connect to device",
      );
    } finally {
      setAddAccountLoading(false);
      setUsbProgress(null);
      try {
        await disconnectFromDevice();
      } catch (error) {
        log.debug("Device disconnect failed after add-account flow", { error });
        // Ignore disconnect errors
      }
    }
  }, [device, deviceId, onClose, onDeviceUpdated]);

  // Add account manually
  const handleAddAccountManually = useCallback(async () => {
    if (!manualAccount.xpub || !manualAccount.derivationPath) return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      await addDeviceAccount(deviceId, manualAccount);

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info("Added account manually", {
        path: manualAccount.derivationPath,
      });
    } catch (err) {
      log.error("Failed to add account manually", { err });
      setAddAccountError(
        err instanceof Error ? err.message : "Failed to add account",
      );
    } finally {
      setAddAccountLoading(false);
    }
  }, [deviceId, manualAccount, onClose, onDeviceUpdated]);

  /**
   * Add selected parsed accounts to the device
   */
  const handleAddParsedAccounts = useCallback(async () => {
    if (parsedAccounts.length === 0 || selectedParsedAccounts.size === 0)
      return;

    setAddAccountLoading(true);
    setAddAccountError(null);

    try {
      let addedCount = 0;
      for (const [index, account] of parsedAccounts.entries()) {
        if (selectedParsedAccounts.has(index)) {
          try {
            await addDeviceAccount(deviceId, {
              purpose: account.purpose,
              scriptType: account.scriptType,
              derivationPath: account.derivationPath,
              xpub: account.xpub,
            });
            addedCount++;
          } catch (err) {
            log.warn("Failed to add account", {
              path: account.derivationPath,
              err,
            });
          }
        }
      }

      // Refresh device data
      const updatedDevice = await getDevice(deviceId);
      onDeviceUpdated(updatedDevice);
      onClose();

      log.info("Added accounts from import", { addedCount });
    } catch (err) {
      log.error("Failed to add accounts", { err });
      setAddAccountError(
        err instanceof Error ? err.message : "Failed to add accounts",
      );
    } finally {
      setAddAccountLoading(false);
    }
  }, [
    deviceId,
    parsedAccounts,
    selectedParsedAccounts,
    onClose,
    onDeviceUpdated,
  ]);

  return {
    // Method selection
    addAccountMethod,
    setAddAccountMethod,
    addAccountLoading,
    addAccountError,
    setAddAccountError,

    // USB
    usbProgress,
    handleAddAccountsViaUsb,

    // Manual
    manualAccount,
    setManualAccount,
    handleAddAccountManually,

    // QR
    qrMode,
    setQrMode,
    cameraActive,
    setCameraActive,
    cameraError,
    setCameraError,
    urProgress,
    setUrProgress,
    urDecoderRef,
    bytesDecoderRef,
    handleQrScan,
    handleCameraError,

    // File import
    handleFileUpload,

    // Import review
    parsedAccounts,
    selectedParsedAccounts,
    setSelectedParsedAccounts,
    importFingerprint,
    accountConflict,
    handleAddParsedAccounts,

    // Utilities
    resetImportState,
    getDeviceTypeFromDeviceModel,
  };
}
