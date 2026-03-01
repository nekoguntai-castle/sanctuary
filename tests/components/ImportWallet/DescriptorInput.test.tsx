import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DescriptorInput,
} from '../../../components/ImportWallet/steps/DescriptorInput';
import { MAX_FILE_SIZE, MAX_INPUT_SIZE } from '../../../components/ImportWallet/importHelpers';

type DescriptorInputProps = React.ComponentProps<typeof DescriptorInput>;

function renderDescriptorInput(overrides: Partial<DescriptorInputProps> = {}) {
  const props: DescriptorInputProps = {
    format: 'descriptor',
    importData: '',
    setImportData: vi.fn(),
    validationError: null,
    setValidationError: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<DescriptorInput {...props} />),
    props,
  };
}

const originalFileReader = globalThis.FileReader;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.FileReader = originalFileReader;
});

function mockFileReader({
  result,
  fail,
}: {
  result?: string;
  fail?: boolean;
}) {
  class MockFileReader {
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsText() {
      if (fail) {
        this.onerror?.({} as ProgressEvent<FileReader>);
        return;
      }

      this.onload?.({
        target: { result: result ?? '' },
      } as unknown as ProgressEvent<FileReader>);
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
}

describe('DescriptorInput', () => {
  it('renders descriptor mode copy and placeholder', () => {
    renderDescriptorInput({ format: 'descriptor' });

    expect(screen.getByText('Enter Output Descriptor')).toBeInTheDocument();
    expect(screen.getByText(/Click to upload \.txt file/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/wpkh\(/)).toBeInTheDocument();
  });

  it('renders json mode copy and help block', () => {
    renderDescriptorInput({ format: 'json' });

    expect(screen.getByText('Enter Configuration')).toBeInTheDocument();
    expect(screen.getByText(/Click to upload \.json or \.txt file/)).toBeInTheDocument();
    expect(screen.getByText('Expected JSON format:')).toBeInTheDocument();
  });

  it('validates oversized textarea input and blocks state update', () => {
    const setImportData = vi.fn();
    const setValidationError = vi.fn();
    renderDescriptorInput({
      setImportData,
      setValidationError,
    });

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'x'.repeat(MAX_INPUT_SIZE + 1) } });

    expect(setImportData).not.toHaveBeenCalled();
    expect(setValidationError).toHaveBeenCalledWith(expect.stringContaining('Input too large'));
  });

  it('validates large pasted content and reports JSON format issues', () => {
    const setImportData = vi.fn();
    const setValidationError = vi.fn();
    renderDescriptorInput({
      format: 'json',
      setImportData,
      setValidationError,
    });

    const badLargeJson = `{${'x'.repeat(1200)}`;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: badLargeJson } });

    expect(setImportData).toHaveBeenCalledWith(badLargeJson);
    expect(setValidationError).toHaveBeenCalledWith('Invalid JSON format. Please check the file contents.');
  });

  it('rejects oversized upload files', () => {
    const setValidationError = vi.fn();
    renderDescriptorInput({ setValidationError });

    const input = screen.getByLabelText(/Click to upload/i);
    const tooLargeFile = new File(['x'.repeat(MAX_FILE_SIZE + 1)], 'wallet.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [tooLargeFile] } });

    expect(setValidationError).toHaveBeenCalledWith(expect.stringContaining('File too large'));
  });

  it('rejects invalid file extensions for descriptor format', () => {
    const setValidationError = vi.fn();
    renderDescriptorInput({ format: 'descriptor', setValidationError });

    const input = screen.getByLabelText(/Click to upload/i);
    const invalidFile = new File(['{}'], 'wallet.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [invalidFile] } });

    expect(setValidationError).toHaveBeenCalledWith('Invalid file type. Expected: .txt');
  });

  it('handles file read success and read failure paths', () => {
    const setImportData = vi.fn();
    const setValidationError = vi.fn();
    const inputContent = '{"type":"single_sig","scriptType":"native_segwit","devices":[]}';

    mockFileReader({ result: inputContent });
    renderDescriptorInput({
      format: 'json',
      setImportData,
      setValidationError,
    });

    const input = screen.getByLabelText(/Click to upload/i);
    const validFile = new File([inputContent], 'wallet.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [validFile] } });

    expect(setImportData).toHaveBeenCalledWith(inputContent);
    expect(setValidationError).toHaveBeenCalledWith(null);

    vi.clearAllMocks();
    mockFileReader({ fail: true });

    fireEvent.change(input, { target: { files: [validFile] } });
    expect(setValidationError).toHaveBeenCalledWith('Failed to read file');
  });
});
