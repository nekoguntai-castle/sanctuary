import { useState } from 'react';
import { X, Download, FileSpreadsheet, FileJson, Loader2, Calendar } from 'lucide-react';
import { Button } from './ui/Button';
import * as transactionsApi from '../src/api/transactions';
import { createLogger } from '../utils/logger';

const log = createLogger('TransactionExportModal');

interface TransactionExportModalProps {
  walletId: string;
  walletName: string;
  onClose: () => void;
}

export function TransactionExportModal({ walletId, walletName, onClose }: TransactionExportModalProps) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      await transactionsApi.exportTransactions(walletId, walletName, {
        format,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      onClose();
    } catch (err) {
      log.error('Export failed', { error: err });
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-2xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-light">Export Transactions</h3>
          <button
            onClick={onClose}
            className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 mb-3">
            Export Format
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setFormat('csv')}
              className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${
                format === 'csv'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              <FileSpreadsheet className={`w-8 h-8 mb-2 ${format === 'csv' ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
              <span className={`text-sm font-medium ${format === 'csv' ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                CSV
              </span>
              <span className="text-xs text-sanctuary-400 mt-1">Spreadsheets</span>
            </button>
            <button
              onClick={() => setFormat('json')}
              className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${
                format === 'json'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              <FileJson className={`w-8 h-8 mb-2 ${format === 'json' ? 'text-primary-600 dark:text-primary-400' : 'text-sanctuary-400'}`} />
              <span className={`text-sm font-medium ${format === 'json' ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-600 dark:text-sanctuary-400'}`}>
                JSON
              </span>
              <span className="text-xs text-sanctuary-400 mt-1">Developers</span>
            </button>
          </div>
        </div>

        {/* Date Range */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 mb-3">
            <Calendar className="w-4 h-4 inline mr-2" />
            Date Range (Optional)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-sanctuary-500 mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs text-sanctuary-500 mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <p className="text-xs text-sanctuary-400 mt-2">
            Leave empty to export all transactions
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
