import { useEffect, type ChangeEvent } from 'react';
import { useLatestRequest } from '../../../hooks/useLatestRequest';
import { ImportFormat, MAX_FILE_SIZE, MAX_INPUT_SIZE, validateInputData } from '../importHelpers';

export function useDescriptorInputHandlers({
  format,
  setImportData,
  setValidationError,
  resetValidation,
}: {
  format: ImportFormat | null;
  setImportData: (data: string) => void;
  setValidationError: (error: string | null) => void;
  resetValidation: () => void;
}) {
  const reads = useLatestRequest();
  // A late read must not write into another format or an unmounted input step.
  useEffect(() => () => reads.invalidate(), [format, reads]);

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = reads.begin();
    resetValidation();

    const fileError = validateUploadedFile(file, format);
    if (fileError) {
      setValidationError(fileError);
      event.target.value = '';
      return;
    }

    setImportData('');
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      if (!reads.isCurrent(request)) return;
      const content = readerEvent.target?.result as string;
      const contentError = validateInputData(content, format);

      if (contentError) {
        setValidationError(contentError);
        return;
      }

      setImportData(content);
      setValidationError(null);
    };
    reader.onerror = () => {
      if (reads.isCurrent(request)) setValidationError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleTextChange = (newValue: string) => {
    reads.invalidate();
    resetValidation();
    const sizeError = validateInputSize(newValue);
    if (sizeError) {
      setValidationError(sizeError);
      return;
    }

    setImportData(newValue);

    const pastedContentError = validatePastedContent(newValue, format);
    if (pastedContentError) {
      setValidationError(pastedContentError);
      return;
    }

    setValidationError(null);
  };

  return {
    handleFileUpload,
    handleTextChange,
  };
}

function validateUploadedFile(file: File, format: ImportFormat | null): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed: ${MAX_FILE_SIZE / 1024 / 1024}MB. Please check you're importing the correct file.`;
  }

  const validExtensions = fileExtensionsForFormat(format);
  const fileExt = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  if (!validExtensions.includes(fileExt)) {
    return `Invalid file type. Expected: ${validExtensions.join(' or ')}`;
  }

  return null;
}

function validateInputSize(newValue: string): string | null {
  if (newValue.length <= MAX_INPUT_SIZE) return null;
  return `Input too large (${(newValue.length / 1024).toFixed(1)}KB). Maximum allowed: ${MAX_INPUT_SIZE / 1024}KB. Please check you're importing the correct file.`;
}

function validatePastedContent(newValue: string, format: ImportFormat | null): string | null {
  if (newValue.length <= 1000) return null;
  return validateInputData(newValue, format);
}

export function fileExtensionsForFormat(format: ImportFormat | null): string[] {
  return format === 'json' ? ['.json', '.txt'] : ['.txt'];
}
