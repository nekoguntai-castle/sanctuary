import type { ChangeEvent } from 'react';
import { AlertCircle, Upload } from 'lucide-react';
import { ImportFormat, MAX_INPUT_SIZE } from '../importHelpers';
import { fileExtensionsForFormat } from './useDescriptorInputHandlers';

export function DescriptorInputHeader({
  format,
}: {
  format: ImportFormat | null;
}) {
  return (
    <>
      <h2 className="text-xl font-medium text-center text-sanctuary-900 dark:text-sanctuary-50 mb-2">
        {format === 'descriptor' ? 'Enter Output Descriptor' : 'Enter Configuration'}
      </h2>
      <p className="text-center text-sanctuary-500 mb-6">
        {format === 'descriptor'
          ? 'Paste your Bitcoin output descriptor or upload a file.'
          : 'Paste your wallet configuration or upload a JSON/text file.'}
      </p>
    </>
  );
}

export function DescriptorFileUpload({
  format,
  onFileUpload,
}: {
  format: ImportFormat | null;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="relative">
      <input
        type="file"
        accept={fileExtensionsForFormat(format).join(',')}
        onChange={onFileUpload}
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
  );
}

export function PasteDivider() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
      <span className="text-xs text-sanctuary-400">or paste below</span>
      <div className="flex-1 h-px bg-sanctuary-200 dark:bg-sanctuary-700" />
    </div>
  );
}

export function DescriptorTextArea({
  format,
  importData,
  validationError,
  onTextChange,
}: {
  format: ImportFormat | null;
  importData: string;
  validationError: string | null;
  onTextChange: (value: string) => void;
}) {
  return (
    <textarea
      value={importData}
      onChange={(event) => onTextChange(event.target.value)}
      placeholder={descriptorPlaceholder(format)}
      rows={10}
      maxLength={MAX_INPUT_SIZE}
      className={`w-full px-4 py-3 rounded-lg border surface-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm ${descriptorTextAreaClass(validationError)}`}
    />
  );
}

export function DescriptorValidationError({
  validationError,
}: {
  validationError: string | null;
}) {
  if (!validationError) return null;

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <span className="text-sm">{validationError}</span>
    </div>
  );
}

export function JsonFormatHelp({
  format,
}: {
  format: ImportFormat | null;
}) {
  if (format !== 'json') return null;

  return (
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
  );
}

function descriptorPlaceholder(format: ImportFormat | null): string {
  if (format === 'descriptor') {
    return 'wpkh([a1b2c3d4/84h/0h/0h]xpub6E.../0/*)';
  }

  return `{
  "type": "multi_sig",
  "scriptType": "native_segwit",
  "quorum": 2,
  "devices": [...]
}`;
}

function descriptorTextAreaClass(validationError: string | null): string {
  return validationError
    ? 'border-red-500 dark:border-red-400'
    : 'border-sanctuary-300 dark:border-sanctuary-700';
}
