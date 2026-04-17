import * as os from 'os';
import { expect, it, type Mock } from 'vitest';

import { app, getMockExecFilePromisified, request } from './aiTestHarness';

export function registerSystemResourcesContracts() {
  it('should return system resource information', async () => {
    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.ram).toBeDefined();
    expect(response.body.ram.total).toBeDefined();
    expect(response.body.ram.available).toBeDefined();
    expect(response.body.ram.required).toBeDefined();
    expect(response.body.ram.sufficient).toBeDefined();
    expect(response.body.disk).toBeDefined();
    expect(response.body.gpu).toBeDefined();
    expect(response.body.overall).toBeDefined();
  });

  it('should indicate when resources are sufficient', async () => {
    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    // With 8GB free RAM (mocked above), should be sufficient (>4GB required)
    expect(response.body.ram.sufficient).toBe(true);
  });

  it('should fall back when disk and gpu probes fail', async () => {
    getMockExecFilePromisified()
      .mockRejectedValueOnce(new Error('df failed'))
      .mockRejectedValueOnce(new Error('df fallback failed'))
      .mockRejectedValueOnce(new Error('nvidia-smi missing'));

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.disk.total).toBe(0);
    expect(response.body.disk.available).toBe(0);
    expect(response.body.gpu).toEqual({ available: false, name: null });
  });

  it('should use current-directory disk probe when root df fails', async () => {
    getMockExecFilePromisified()
      .mockRejectedValueOnce(new Error('root df failed'))
      .mockRejectedValueOnce(new Error('nvidia-smi missing'))
      .mockResolvedValueOnce({
        stdout: 'Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/sda1 64000 1000 32000 4% .',
        stderr: '',
      });

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.disk.total).toBe(64000);
    expect(response.body.disk.available).toBe(32000);
  });

  it('should return 500 when system resource check throws unexpectedly', async () => {
    (os.freemem as Mock).mockImplementationOnce(() => {
  throw new Error('freemem failed');
    });

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('should fall back to zero disk values when df numeric fields are invalid', async () => {
    getMockExecFilePromisified()
      .mockResolvedValueOnce({
        stdout: 'Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/sda1 xx yy zz 56% /',
        stderr: '',
  })
  .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.disk.total).toBe(0);
    expect(response.body.disk.available).toBe(0);
  });

  it('should fall back to zero disk values when df output has too few columns', async () => {
    getMockExecFilePromisified()
      .mockResolvedValueOnce({
        stdout: 'Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/sda1 100000 50000',
        stderr: '',
  })
  .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.disk.total).toBe(0);
    expect(response.body.disk.available).toBe(0);
  });

  it('should include low RAM warning when available memory is below recommendation', async () => {
    (os.freemem as Mock).mockReturnValueOnce(2 * 1024 * 1024 * 1024); // 2GB

    const response = await request(app)
  .get('/api/v1/ai/system-resources')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.ram.sufficient).toBe(false);
    expect(response.body.overall.warnings.some((w: string) => w.startsWith('Low RAM:'))).toBe(true);
  });
}
