/**
 * LabelsExportTab
 *
 * BIP 329 label-export download panel for {@link ExportModal}. Extracted to
 * keep the modal body's cyclomatic complexity below threshold; DOM unchanged.
 */

import React from 'react';
import { Tag, Download } from 'lucide-react';
import { Button } from '../../../ui/Button';

interface LabelsExportTabProps {
  onDownload: () => void;
}

export const LabelsExportTab: React.FC<LabelsExportTabProps> = ({ onDownload }) => (
  <div className="text-center w-full">
    <Tag className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
    <p className="text-sm text-sanctuary-500 mb-2">
      Export wallet labels in BIP 329 format.
    </p>
    <p className="text-xs text-sanctuary-400 mb-6">
      This exports transaction and address labels as a JSON Lines file compatible
      with Sparrow, Electrum, and other BIP 329 supporting wallets.
    </p>
    <Button onClick={onDownload} className="w-full">
      <Download className="w-4 h-4 mr-2" /> Download Labels (BIP 329)
    </Button>
  </div>
);
