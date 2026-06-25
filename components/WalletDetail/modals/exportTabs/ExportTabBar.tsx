/**
 * ExportTabBar
 *
 * Tab navigation for {@link ExportModal}. Extracted to keep the modal's
 * component body below the cyclomatic-complexity threshold. Renders the QR /
 * JSON / Descriptor / Labels buttons, plus the Device button for multisig
 * wallets. The button order and the `HardDrive` icon inside the Device button
 * are load-bearing: the Device-tab tests locate the tab as the last button in
 * this row containing the device icon.
 */

import React from 'react';
import { QrCode, FileJson, FileText, Tag, HardDrive } from 'lucide-react';
import type { ExportTab } from './types';

interface ExportTabBarProps {
  exportTab: ExportTab;
  isMultisig: boolean;
  getTabListProps: (label: string) => React.ComponentPropsWithoutRef<'div'>;
  getTabProps: (tab: ExportTab) => React.ComponentPropsWithoutRef<'button'>;
}

function tabClassName(isActive: boolean): string {
  return `flex-1 py-2 text-sm font-medium border-b-2 ${
    isActive
      ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
      : 'border-transparent text-sanctuary-400'
  }`;
}

export const ExportTabBar: React.FC<ExportTabBarProps> = ({
  exportTab,
  isMultisig,
  getTabListProps,
  getTabProps,
}) => (
  <div
    {...getTabListProps('Wallet export sections')}
    className="flex border-b border-sanctuary-200 dark:border-sanctuary-800 mb-6"
  >
    <button {...getTabProps('qr')} className={tabClassName(exportTab === 'qr')}>
      <QrCode className="w-4 h-4 mx-auto mb-1" />
      QR Code
    </button>
    <button {...getTabProps('json')} className={tabClassName(exportTab === 'json')}>
      <FileJson className="w-4 h-4 mx-auto mb-1" />
      JSON File
    </button>
    <button {...getTabProps('text')} className={tabClassName(exportTab === 'text')}>
      <FileText className="w-4 h-4 mx-auto mb-1" />
      Descriptor
    </button>
    <button {...getTabProps('labels')} className={tabClassName(exportTab === 'labels')}>
      <Tag className="w-4 h-4 mx-auto mb-1" />
      Labels
    </button>
    {isMultisig && (
      <button {...getTabProps('device')} className={tabClassName(exportTab === 'device')}>
        <HardDrive className="w-4 h-4 mx-auto mb-1" />
        Device
      </button>
    )}
  </div>
);
