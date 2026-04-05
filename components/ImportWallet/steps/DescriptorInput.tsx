import React from 'react';
import {
  AlertCircle,
  Upload,
} from 'lucide-react';
import { ImportFormat, MAX_INPUT_SIZE, MAX_FILE_SIZE, validateInputData } from '../importHelpers';

interface DescriptorInputProps {
  format: ImportFormat | null;
  importData: string;
  setImportData: (data: string) => void;
  validationError: string | null;
  setValidationError: (error: string | null) => void;
}

export const DescriptorInput: React.FC<DescriptorInputProps> = ({
  format,
  importData,
  setImportData,
  validationError,
  setValidationError,
}) => {
  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setValidationError(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed: ${MAX_FILE_SIZE / 1024 / 1024}MB. Please check you're importing the correct file.`);
      event.target.value = ''; // Reset file input
      return;
    }

    // Validate file extension
    const validExtensions = format === 'json' ? ['.json', '.txt'] : ['.txt'];
    const fileExt = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExt)) {
      setValidationError(`Invalid file type. Expected: ${validExtensions.join(' or ')}`);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;

      // Validate content size
      const error = validateInputData(content, format);
      if (error) {
        setValidationError(error);
        return;
      }

      setImportData(content);
      setValidationError(null);
    };
    reader.onerror = () => {
      setValidationError('Failed to read file');
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        {format === 'descriptor' ? 'Enter Output Descriptor' : 'Enter Configuration'}
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        {format === 'descriptor'
          ? 'Paste your Bitcoin output descriptor or upload a file.'
          : 'Paste your wallet configuration or upload a JSON/text file.'}
      </p>

      <div className="space-y-4">
        {/* File Upload Area */}
        <div className="relative">
          <input
            type="file"
            accept={format === 'json' ? '.json,.txt' : '.txt'}
            onChange={handleFileUpload}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="flex items-center justify-center gap-2 w-full px-4 py-3 border border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-lg cursor-pointer hover:border-primary-500 dark:hover:border-primary-500 bg-transparent hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
          >
            <Upload className="w-5 h-5 text-sanctuary-400" />
            <span className="text-sm text-sanctuary-500">
              Click to upload {format === 'json' ? '.json or .txt' : '.txt'} file
            </span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
          <span className="text-xs text-sanctuary-400">or paste below</span>
          <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
        </div>

        <textarea
          value={importData}
          onChange={(e) => {
            const newValue = e.target.value;

            // Reject input that exceeds max size
            if (newValue.length > MAX_INPUT_SIZE) {
              setValidationError(`Input too large (${(newValue.length / 1024).toFixed(1)}KB). Maximum allowed: ${MAX_INPUT_SIZE / 1024}KB. Please check you're importing the correct file.`);
              return; // Don't update state with oversized data
            }

            setImportData(newValue);

            // Validate on paste (detect large pastes)
            if (newValue.length > 1000) {
              const error = validateInputData(newValue, format);
              if (error) {
                setValidationError(error);
                return;
              }
            }

            setValidationError(null);
          }}
          placeholder={format === 'descriptor'
            ? 'wpkh([a1b2c3d4/84h/0h/0h]xpub6E.../0/*)'
            : '{\n  "type": "multi_sig",\n  "scriptType": "native_segwit",\n  "quorum": 2,\n  "devices": [...]\n}'}
          rows={10}
          maxLength={MAX_INPUT_SIZE}
          className={`w-full px-4 py-3 rounded-lg border surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm ${
            validationError
              ? 'border-red-500 dark:border-red-400'
              : 'border-sanctuary-300 dark:border-sanctuary-700'
          }`}
        />

        {validationError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{validationError}</span>
          </div>
        )}

        {format === 'json' && (
          <div className="text-xs text-sanctuary-500 surface-secondary p-4 rounded-lg">
            <p className="font-medium mb-2">Expected JSON format:</p>
            <pre className="overflow-x-auto">{`{
  "type": "single_sig" | "multi_sig",
  "scriptType": "native_segwit" | "nested_segwit" | "taproot" | "legacy",
  "quorum": 2,  // For multi_sig only
  "devices": [
    {
      "type": "coldcard",
      "label": "My ColdCard",
      "fingerprint": "a1b2c3d4",
      "derivationPath": "m/48'/0'/0'/2'",
      "xpub": "xpub6E..."
    }
  ]
}`}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
