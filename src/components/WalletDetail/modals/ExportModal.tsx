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
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import * as walletsApi from '../../../api/wallets';
import { isMultisigType } from '../../../types';
import { useTabsA11y } from '../../ui/useTabsA11y';
import { createLogger } from '../../../utils/logger';
import { usePassportMultisigExportText } from './usePassportMultisigExportText';
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
  descriptor?: string;
  devices: ExportDevice[];
  onClose: () => void;
  onError: (error: unknown, title: string) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  walletId,
  walletName,
  walletType,
  descriptor,
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
      await walletsApi.exportWalletBackup(walletId, walletName);
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

  // Passport/Coldcard multisig QR encodes the server's Coldcard export (never client-built text).
  const usesServerPassportExport =
    isMultisig && exportTab === 'qr' && qrFormat === 'passport' && devices.length > 0;
  const passportExport = usePassportMultisigExportText(walletId, usesServerPassportExport);
  const qrValue = usesServerPassportExport ? (passportExport.text ?? '') : (descriptor || '');

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
              qrValue={qrValue}
              qrLoading={passportExport.loading}
              qrError={passportExport.error}
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
