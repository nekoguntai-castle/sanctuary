import React from 'react';
import { ImportFormat } from '../importHelpers';
import {
  DescriptorFileUpload,
  DescriptorInputHeader,
  DescriptorTextArea,
  DescriptorValidationError,
  JsonFormatHelp,
  PasteDivider,
} from './DescriptorInputSections';
import { useDescriptorInputHandlers } from './useDescriptorInputHandlers';

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
  const { handleFileUpload, handleTextChange } = useDescriptorInputHandlers({
    format,
    setImportData,
    setValidationError,
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <DescriptorInputHeader format={format} />

      <div className="space-y-4">
        <DescriptorFileUpload format={format} onFileUpload={handleFileUpload} />
        <PasteDivider />
        <DescriptorTextArea
          format={format}
          importData={importData}
          validationError={validationError}
          onTextChange={handleTextChange}
        />
        <DescriptorValidationError validationError={validationError} />
        <JsonFormatHelp format={format} />
      </div>
    </div>
  );
};
