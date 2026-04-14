import { describe } from 'vitest';

import { registerBbqrFormatProcessingContracts } from './useQrScanner/useQrScanner.bbqr.contracts';
import {
  registerErrorRecoveryContracts,
  registerExtractedFieldsAndWarningsContracts,
} from './useQrScanner/useQrScanner.fields-recovery.contracts';
import {
  registerFileContentHandlingContracts,
  registerPlainJsonQrScanningContracts,
} from './useQrScanner/useQrScanner.plain-file.contracts';
import {
  registerCameraErrorHandlingContracts,
  registerCameraStateContracts,
  registerInitialStateContracts,
  registerQrModeSwitchingContracts,
  registerResetFunctionalityContracts,
  registerStopCameraFunctionalityContracts,
} from './useQrScanner/useQrScanner.state.contracts';
import { registerUrBytesFormatProcessingContracts } from './useQrScanner/useQrScanner.ur-bytes.contracts';
import {
  registerCaseInsensitiveUrDetectionContracts,
  registerUrFormatProcessingContracts,
} from './useQrScanner/useQrScanner.ur.contracts';
import { registerUseQrScannerTestHarness } from './useQrScanner/useQrScannerTestHarness';

describe('useQrScanner', () => {
  registerUseQrScannerTestHarness();

  describe('Initial State', () => {
    registerInitialStateContracts();
  });

  describe('QR Mode Switching', () => {
    registerQrModeSwitchingContracts();
  });

  describe('Camera State', () => {
    registerCameraStateContracts();
  });

  describe('Camera Error Handling', () => {
    registerCameraErrorHandlingContracts();
  });

  describe('Reset Functionality', () => {
    registerResetFunctionalityContracts();
  });

  describe('Stop Camera Functionality', () => {
    registerStopCameraFunctionalityContracts();
  });

  describe('Plain JSON QR Scanning', () => {
    registerPlainJsonQrScanningContracts();
  });

  describe('File Content Handling', () => {
    registerFileContentHandlingContracts();
  });

  describe('UR Format Processing', () => {
    registerUrFormatProcessingContracts();
  });

  describe('UR Bytes Format Processing', () => {
    registerUrBytesFormatProcessingContracts();
  });

  describe('BBQr Format Processing', () => {
    registerBbqrFormatProcessingContracts();
  });

  describe('Extracted Fields and Warnings', () => {
    registerExtractedFieldsAndWarningsContracts();
  });

  describe('Error Recovery', () => {
    registerErrorRecoveryContracts();
  });

  describe('Case Insensitive UR Detection', () => {
    registerCaseInsensitiveUrDetectionContracts();
  });
});
