import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { downloadBinary,downloadBlob,downloadText } from '../../src/utils/download';

describe('download utility', () => {
  beforeEach(() => {
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', writable: true });
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a blob and cleans up the object URL', () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const blob = new Blob(['abc'], { type: 'text/plain' });
    downloadBlob(blob, 'sample.txt');

    expect(createObjectUrlSpy).toHaveBeenCalledWith(blob);
    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('sample.txt');
    expect(anchor.href).toContain('blob:mock-url');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(anchor);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('downloads text content with default mime type', () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:text');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadText('hello world', 'note.txt');

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('downloads text content with custom mime type', () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:json');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadText('{"ok":true}', 'payload.json', 'application/json');

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json');
  });

  it('downloads binary content from Uint8Array', () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bin');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadBinary(new Uint8Array([0x01, 0x02, 0x03]), 'data.bin');

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
    expect(blob.size).toBe(3);
  });

  it('downloads binary content from ArrayBuffer with custom mime type', () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:psbt');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const buffer = new Uint8Array([0x70, 0x73, 0x62, 0x74]).buffer;
    downloadBinary(buffer, 'tx.psbt', 'application/psbt');

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/psbt');
  });
});
