/**
 * File Download Utility
 *
 * Provides a consistent way to trigger file downloads in the browser.
 * Handles creating object URLs, triggering the download, and cleanup.
 */

/**
 * Download a Blob as a file
 *
 * @param blob - The Blob or File to download
 * @param filename - The name for the downloaded file
 *
 * @example
 * // Download JSON data
 * const data = JSON.stringify({ key: 'value' });
 * const blob = new Blob([data], { type: 'application/json' });
 * downloadBlob(blob, 'data.json');
 *
 * @example
 * // Download binary data
 * const bytes = new Uint8Array([...]);
 * const blob = new Blob([bytes], { type: 'application/octet-stream' });
 * downloadBlob(blob, 'file.bin');
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download text content as a file
 *
 * @param content - The text content to download
 * @param filename - The name for the downloaded file
 * @param mimeType - The MIME type (default: 'text/plain')
 *
 * @example
 * downloadText('Hello, world!', 'message.txt');
 * downloadText('{"key": "value"}', 'data.json', 'application/json');
 */
export function downloadText(
  content: string,
  filename: string,
  mimeType: string = 'text/plain'
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

/**
 * Download binary data as a file
 *
 * @param data - The binary data (Uint8Array or ArrayBuffer)
 * @param filename - The name for the downloaded file
 * @param mimeType - The MIME type (default: 'application/octet-stream')
 *
 * @example
 * const bytes = new Uint8Array([0x70, 0x73, 0x62, 0x74]);
 * downloadBinary(bytes, 'transaction.psbt');
 */
export function downloadBinary(
  data: Uint8Array<ArrayBuffer> | ArrayBuffer,
  filename: string,
  mimeType: string = 'application/octet-stream'
): void {
  const blob = new Blob([data], { type: mimeType });
  downloadBlob(blob, filename);
}
