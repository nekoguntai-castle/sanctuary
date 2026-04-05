import React from 'react';
import {
  FileJson,
  FileText,
  Usb,
  QrCode,
} from 'lucide-react';
import { ImportFormat } from '../importHelpers';

interface FormatSelectionProps {
  format: ImportFormat | null;
  setFormat: (format: ImportFormat) => void;
}

export const FormatSelection: React.FC<FormatSelectionProps> = ({ format, setFormat }) => (
  <div className="space-y-6 animate-fade-in">
    <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-8">
      Select Import Format
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <button
        onClick={() => setFormat('descriptor')}
        className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
          format === 'descriptor'
            ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
            : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
        }`}
      >
        <div className={`p-4 rounded-full ${
          format === 'descriptor'
            ? 'bg-primary-100 text-primary-600'
            : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'
        }`}>
          <FileText className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-medium">Output Descriptor</h3>
          <p className="text-sm text-sanctuary-500 mt-2">
            Import using a Bitcoin output descriptor string. Standard format used by Bitcoin Core.
          </p>
        </div>
      </button>

      <button
        onClick={() => setFormat('json')}
        className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
          format === 'json'
            ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
            : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
        }`}
      >
        <div className={`p-4 rounded-full ${
          format === 'json'
            ? 'bg-primary-100 text-primary-600'
            : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'
        }`}>
          <FileJson className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-medium">JSON/Text File</h3>
          <p className="text-sm text-sanctuary-500 mt-2">
            Import using a JSON or text file with wallet details. Supports Sparrow exports.
          </p>
        </div>
      </button>

      <button
        onClick={() => setFormat('hardware')}
        className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
          format === 'hardware'
            ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
            : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
        }`}
      >
        <div className={`p-4 rounded-full ${
          format === 'hardware'
            ? 'bg-primary-100 text-primary-600'
            : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'
        }`}>
          <Usb className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-medium">Hardware Device</h3>
          <p className="text-sm text-sanctuary-500 mt-2">
            Connect a Ledger or Trezor device to import wallet directly from xpub.
          </p>
        </div>
      </button>

      <button
        onClick={() => setFormat('qr_code')}
        className={`p-6 rounded-xl border-2 transition-all flex flex-col items-center text-center space-y-4 ${
          format === 'qr_code'
            ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
            : 'border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400'
        }`}
      >
        <div className={`p-4 rounded-full ${
          format === 'qr_code'
            ? 'bg-primary-100 text-primary-600'
            : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'
        }`}>
          <QrCode className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-medium">QR Code</h3>
          <p className="text-sm text-sanctuary-500 mt-2">
            Scan QR codes from air-gapped devices like Passport, Coldcard, or Keystone.
          </p>
        </div>
      </button>
    </div>
  </div>
);
