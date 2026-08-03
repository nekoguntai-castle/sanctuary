/**
 * JsonExportTab
 *
 * JSON wallet-backup download panel for {@link ExportModal}. Extracted to keep
 * the modal body's cyclomatic complexity below threshold; DOM unchanged.
 */

import React from 'react';
import { FileJson, Download } from 'lucide-react';
import { Button } from '../../../ui/Button';

interface JsonExportTabProps {
  onDownload: () => void;
}

export const JsonExportTab: React.FC<JsonExportTabProps> = ({ onDownload }) => (
  <div className="text-center w-full">
    <FileJson className="w-16 h-16 text-sanctuary-300 mx-auto mb-4" />
    <p className="text-sm text-sanctuary-500 mb-6">
      Download the full wallet backup in JSON format. Store this file securely.
    </p>
    <Button onClick={onDownload} className="w-full">
      <Download className="w-4 h-4 mr-2" /> Download Backup
    </Button>
  </div>
);
