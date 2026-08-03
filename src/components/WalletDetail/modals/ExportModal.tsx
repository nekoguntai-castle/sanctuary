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
import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import * as walletsApi from '../../../api/wallets';
import { isMultisigType, getQuorumM, getQuorumN, type Quorum } from '../../../types';
import { useTabsA11y } from '../../ui/useTabsA11y';
import { createLogger } from '../../../utils/logger';
import { ExportTabBar } from './exportTabs/ExportTabBar';
import { QrExportTab } from './exportTabs/QrExportTab';
import { JsonExportTab } from './exportTabs/JsonExportTab';
import { TextExportTab } from './exportTabs/TextExportTab';
import { LabelsExportTab } from './exportTabs/LabelsExportTab';
import { DeviceExportTab } from './exportTabs/DeviceExportTab';
import type { ExportTab, QrFormat, ExportDevice, ExportFormat } from './exportTabs/types';

const log = createLogger('ExportModal');

const BASE_EXPORT_TABS: readonly ExportTab[] = ['qr', 'json', 'text', 'labels'];
const MULTISIG_EXPORT_TABS: readonly ExportTab[] = [...BASE_EXPORT_TABS, 'device'];
const QR_FORMAT_TABS: readonly QrFormat[] = ['passport', 'descriptor'];

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
  const visibleExportTabs = isMultisig ? MULTISIG_EXPORT_TABS : BASE_EXPORT_TABS;
  const {
    getTabListProps: getExportTabListProps,
    getTabProps: getExportTabProps,
  } = useTabsA11y({
    tabs: visibleExportTabs,
    activeTab: exportTab,
    onTabChange: setExportTab,
  });
  const {
    getTabListProps: getQrFormatTabListProps,
    getTabProps: getQrFormatTabProps,
  } = useTabsA11y({
    tabs: QR_FORMAT_TABS,
    activeTab: qrFormat,
    onTabChange: setQrFormat,
  });

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
        scriptType || WalletScriptType.NATIVE_SEGWIT,
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
        <ExportTabBar
          exportTab={exportTab}
          isMultisig={isMultisig}
          getTabListProps={getExportTabListProps}
          getTabProps={getExportTabProps}
        />

        <div className="flex flex-col items-center space-y-6">
          {exportTab === 'qr' && (
            <QrExportTab
              isMultisig={isMultisig}
              devices={devices}
              qrFormat={qrFormat}
              qrSize={qrSize}
              qrValue={getQrValue()}
              onQrSizeChange={setQrSize}
              getQrFormatTabListProps={getQrFormatTabListProps}
              getQrFormatTabProps={getQrFormatTabProps}
            />
          )}

          {exportTab === 'json' && <JsonExportTab onDownload={downloadJson} />}

          {exportTab === 'text' && (
            <TextExportTab
              descriptor={descriptor || ''}
              isCopied={isCopied}
              onCopy={copy}
            />
          )}

          {exportTab === 'labels' && (
            <LabelsExportTab onDownload={downloadLabels} />
          )}

          {exportTab === 'device' && (
            <DeviceExportTab
              loadingFormats={loadingFormats}
              exportFormats={exportFormats}
              onDownloadFormat={downloadDeviceFormat}
            />
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
