/**
 * ExportModal Component
 *
 * Modal for exporting wallet configuration in various formats:
 * - QR Code (Passport/Coldcard compatible or raw descriptor)
 * - JSON backup
 * - Text descriptor
 * - BIP 329 Labels
 * - Device-specific formats (for multisig)
 */

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X,
  QrCode,
  FileJson,
  FileText,
  Tag,
  HardDrive,
  Download,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import * as walletsApi from '../../../src/api/wallets';
import { isMultisigType, getQuorumM, getQuorumN, type Quorum } from '../../../types';

interface ExportDevice {
  fingerprint: string;
  derivationPath?: string;
  xpub?: string;
}
import { createLogger } from '../../../utils/logger';

const log = createLogger('ExportModal');

type ExportTab = 'qr' | 'json' | 'text' | 'labels' | 'device';
type QrFormat = 'passport' | 'descriptor';

interface ExportFormat {
  id: string;
  name: string;
  extension: string;
}

interface ExportModalProps {
  walletId: string;
  walletName: string;
  walletType: string;
  scriptType?: string;
  descriptor?: string;
  quorum?: Quorum | number | null;
  totalSigners?: number | null;
  devices: ExportDevice[];
  onClose: () => void;
  onError: (error: unknown, title: string) => void;
}

/**
 * Generate Coldcard/Passport compatible multisig config text.
 */
export function generateMultisigConfigText(
  name: string,
  quorum: number,
  totalSigners: number,
  scriptType: string,
  devices: ExportDevice[]
): string {
  const lines: string[] = [];

  lines.push(`Name: ${name}`);
  lines.push(`Policy: ${quorum} of ${totalSigners}`);

  const formatMap: Record<string, string> = {
    native_segwit: 'P2WSH',
    nested_segwit: 'P2SH-P2WSH',
    legacy: 'P2SH',
  };
  lines.push(`Format: ${formatMap[scriptType] || 'P2WSH'}`);
  lines.push('');

  if (devices.length > 0) {
    const normalizedPath = (devices[0].derivationPath || '').replace(/'/g, 'h');
    lines.push(`Derivation: ${normalizedPath}`);
    lines.push('');
  }

  const sortedDevices = [...devices].sort((a, b) =>
    a.fingerprint.toLowerCase().localeCompare(b.fingerprint.toLowerCase())
  );

  for (const device of sortedDevices) {
    lines.push(`${device.fingerprint.toUpperCase()}: ${device.xpub || ''}`);
  }

  return lines.join('\n').trim();
}

export const ExportModal: React.FC<ExportModalProps> = ({
  walletId,
  walletName,
  walletType,
  scriptType,
  descriptor,
  quorum,
  totalSigners,
  devices,
  onClose,
  onError,
}) => {
  const { copy, isCopied } = useCopyToClipboard();
  const [exportTab, setExportTab] = useState<ExportTab>('qr');
  const [qrFormat, setQrFormat] = useState<QrFormat>('passport');
  const [qrSize, setQrSize] = useState(280);
  const [exportFormats, setExportFormats] = useState<ExportFormat[]>([]);
  const [loadingFormats, setLoadingFormats] = useState(false);

  const isMultisig = isMultisigType(walletType);

  // Fetch export formats when device tab is selected
  useEffect(() => {
    if (exportTab === 'device' && isMultisig) {
      setLoadingFormats(true);
      walletsApi
        .getExportFormats(walletId)
        .then((response) => setExportFormats(response.formats))
        .catch((err) => {
          log.error('Failed to fetch export formats', { error: err });
          setExportFormats([]);
        })
        .finally(() => setLoadingFormats(false));
    }
  }, [exportTab, walletId, isMultisig]);

  const downloadJson = async () => {
    try {
      await walletsApi.exportWallet(walletId);
    } catch (err) {
      log.error('Failed to export wallet', { error: err });
      onError(err, 'Export Failed');
    }
  };

  const downloadLabels = async () => {
    try {
      await walletsApi.exportLabelsBip329(walletId, walletName);
    } catch (err) {
      log.error('Failed to export labels', { error: err });
      onError(err, 'Export Labels Failed');
    }
  };

  const downloadDeviceFormat = async (formatId: string, formatName: string) => {
    try {
      await walletsApi.exportWalletFormat(walletId, formatId, walletName);
    } catch (err) {
      log.error(`Failed to export wallet in ${formatName} format`, { error: err });
      onError(err, 'Export Failed');
    }
  };

  const getQrValue = () => {
    if (isMultisig && qrFormat === 'passport' && devices.length > 0) {
      return generateMultisigConfigText(
        walletName,
        getQuorumM(quorum),
        getQuorumN(quorum, totalSigners ?? undefined),
        scriptType || 'native_segwit',
        devices
      );
    }
    return descriptor || '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="surface-elevated rounded-xl max-w-lg w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-medium">Export Wallet</h3>
          <button
            onClick={onClose}
            className="text-sanctuary-400 hover:text-sanctuary-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Export Tabs */}
        <div className="flex border-b border-sanctuary-200 dark:border-sanctuary-800 mb-6">
          <button
            onClick={() => setExportTab('qr')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 ${
              exportTab === 'qr'
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-sanctuary-400'
            }`}
          >
            <QrCode className="w-4 h-4 mx-auto mb-1" />
            QR Code
          </button>
          <button
            onClick={() => setExportTab('json')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 ${
              exportTab === 'json'
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-sanctuary-400'
            }`}
          >
            <FileJson className="w-4 h-4 mx-auto mb-1" />
            JSON File
          </button>
          <button
            onClick={() => setExportTab('text')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 ${
              exportTab === 'text'
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-sanctuary-400'
            }`}
          >
            <FileText className="w-4 h-4 mx-auto mb-1" />
            Descriptor
          </button>
          <button
            onClick={() => setExportTab('labels')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 ${
              exportTab === 'labels'
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-sanctuary-400'
            }`}
          >
            <Tag className="w-4 h-4 mx-auto mb-1" />
            Labels
          </button>
          {isMultisig && (
            <button
              onClick={() => setExportTab('device')}
              className={`flex-1 py-2 text-sm font-medium border-b-2 ${
                exportTab === 'device'
                  ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-sanctuary-400'
              }`}
            >
              <HardDrive className="w-4 h-4 mx-auto mb-1" />
              Device
            </button>
          )}
        </div>

        <div className="flex flex-col items-center space-y-6">
          {/* QR Tab */}
          {exportTab === 'qr' && (
            <div className="w-full">
              {isMultisig && devices.length > 0 && (
                <div className="flex gap-2 mb-4 justify-center">
                  <button
                    onClick={() => setQrFormat('passport')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      qrFormat === 'passport'
                        ? 'bg-primary-600 text-white'
                        : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    Passport/Coldcard
                  </button>
                  <button
                    onClick={() => setQrFormat('descriptor')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      qrFormat === 'descriptor'
                        ? 'bg-primary-600 text-white'
                        : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                    }`}
                  >
                    Raw Descriptor
                  </button>
                </div>
              )}

              <div className="w-full mb-4">
                <div className="flex items-center justify-between text-xs text-sanctuary-500 mb-1">
                  <span>QR Code Size</span>
                  <span>{qrSize}px</span>
                </div>
                <input
                  type="range"
                  min="180"
                  max="400"
                  step="20"
                  value={qrSize}
                  onChange={(e) => setQrSize(Number(e.target.value))}
                  className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
                />
              </div>

              <div className="p-4 bg-white rounded-lg shadow-inner border border-sanctuary-100 flex flex-col items-center overflow-auto max-h-[500px]">
                <QRCodeSVG value={getQrValue()} size={qrSize} level="M" />
                <p className="text-center text-xs text-sanctuary-400 mt-2">
                  {isMultisig && qrFormat === 'passport'
                    ? 'Coldcard/Passport compatible format'
                    : 'Scan to import into another device'}
                </p>
              </div>

              {isMultisig && qrFormat === 'passport' && devices.length === 0 && (
                <p className="text-center text-xs text-amber-500 mt-2">
                  Note: No devices found. Using raw descriptor format instead.
                </p>
              )}
            </div>
          )}

          {/* JSON Tab */}
          {exportTab === 'json' && (
            <div className="text-center w-full">
              <FileJson className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
              <p className="text-sm text-sanctuary-500 mb-6">
                Download the full wallet backup in JSON format. Store this file
                securely.
              </p>
              <Button onClick={downloadJson} className="w-full">
                <Download className="w-4 h-4 mr-2" /> Download Backup
              </Button>
            </div>
          )}

          {/* Text/Descriptor Tab */}
          {exportTab === 'text' && (
            <div className="w-full">
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                Output Descriptor
              </label>
              <textarea
                readOnly
                className="w-full h-32 p-3 text-xs font-mono surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded-md resize-none focus:outline-none"
                value={descriptor || ''}
              />
              <Button
                className="w-full mt-4"
                variant={isCopied(descriptor || '') ? 'primary' : 'secondary'}
                onClick={() => copy(descriptor || '')}
              >
                {isCopied(descriptor || '') ? (
                  <Check className="w-4 h-4 mr-2" />
                ) : (
                  <Copy className="w-4 h-4 mr-2" />
                )}
                {isCopied(descriptor || '') ? 'Copied!' : 'Copy to Clipboard'}
              </Button>
            </div>
          )}

          {/* Labels Tab */}
          {exportTab === 'labels' && (
            <div className="text-center w-full">
              <Tag className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
              <p className="text-sm text-sanctuary-500 mb-2">
                Export wallet labels in BIP 329 format.
              </p>
              <p className="text-xs text-sanctuary-400 mb-6">
                This exports transaction and address labels as a JSON Lines file
                compatible with Sparrow, Electrum, and other BIP 329 supporting
                wallets.
              </p>
              <Button onClick={downloadLabels} className="w-full">
                <Download className="w-4 h-4 mr-2" /> Download Labels (BIP 329)
              </Button>
            </div>
          )}

          {/* Device Tab */}
          {exportTab === 'device' && (
            <div className="w-full">
              <HardDrive className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
              <p className="text-sm text-sanctuary-500 mb-2 text-center">
                Export wallet configuration for hardware devices.
              </p>
              <p className="text-xs text-sanctuary-400 mb-6 text-center">
                Download a file that can be imported directly onto your hardware
                wallet to set up the multisig configuration.
              </p>

              {loadingFormats ? (
                <div className="text-center text-sanctuary-400 py-4">
                  Loading export formats...
                </div>
              ) : exportFormats.length === 0 ? (
                <div className="text-center text-sanctuary-400 py-4">
                  No device export formats available for this wallet type.
                </div>
              ) : (
                <div className="space-y-3">
                  {exportFormats
                    .filter((f) => f.id !== 'sparrow' && f.id !== 'descriptor')
                    .map((format) => (
                      <Button
                        key={format.id}
                        onClick={() => downloadDeviceFormat(format.id, format.name)}
                        variant="secondary"
                        className="w-full justify-between"
                      >
                        <div className="flex items-center">
                          <Download className="w-4 h-4 mr-2" />
                          <span>{format.name}</span>
                        </div>
                        <span className="text-xs text-sanctuary-400">
                          {format.extension}
                        </span>
                      </Button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <Button className="w-full" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
