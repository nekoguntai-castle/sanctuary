import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockClearTransporterCache, mockEncrypt, mockIsEncrypted, mockPrisma } from './adminRoutesTestHarness';
import { openApiSpec } from '../openapi.helpers';

export function registerAdminRoutesSettingsContracts(): void {
  describe('GET /api/v1/admin/settings', () => {
    it('should return system settings with defaults', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'registrationEnabled', value: 'true' },
      ]);

      const response = await adminRoutesRequest().get('/api/v1/admin/settings');

      expect(response.status).toBe(200);
      // Should have defaults merged with stored settings
      expect(response.body.registrationEnabled).toBe(true);
      expect(response.body.confirmationThreshold).toBeDefined();

      const documentedSettings = openApiSpec.components.schemas.AdminSettings.properties;
      for (const key of Object.keys(response.body)) {
        expect(documentedSettings, `AdminSettings OpenAPI schema must document runtime key ${key}`)
          .toHaveProperty(key);
      }
    });

    it('should handle database error', async () => {
      mockPrisma.systemSetting.findMany.mockRejectedValue(new Error('DB error'));

      const response = await adminRoutesRequest().get('/api/v1/admin/settings');

      expect(response.status).toBe(500);
    });

    it('should mark SMTP as not configured when host or fromAddress is missing', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.password', value: '"enc:secret"' },
      ]);

      const response = await adminRoutesRequest().get('/api/v1/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body['smtp.configured']).toBe(false);
      expect(response.body['smtp.password']).toBeUndefined();
    });

    it('should expose a typed default AI provider profile from existing endpoint settings', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://ollama:11434"' },
        { key: 'aiModel', value: '"llama3.2:3b"' },
      ]);

      const response = await adminRoutesRequest().get('/api/v1/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.aiActiveProviderProfileId).toBe('default-ollama');
      expect(response.body.aiActiveProviderProfile).toMatchObject({
        id: 'default-ollama',
        name: 'Default Ollama',
        providerType: 'ollama',
        endpoint: 'http://ollama:11434',
        model: 'llama3.2:3b',
      });
      expect(response.body.aiProviderProfiles).toHaveLength(1);
      expect(response.body.aiEndpoint).toBe('http://ollama:11434');
      expect(response.body.aiModel).toBe('llama3.2:3b');
    });

    it('should document derived AI provider profile as response-only', async () => {
      const settingsSchema = openApiSpec.components.schemas.AdminSettings.properties;
      const updateSchema = openApiSpec.components.schemas.AdminSettingsUpdateRequest.properties;

      expect(settingsSchema).toHaveProperty('aiActiveProviderProfile');
      expect(updateSchema).not.toHaveProperty('aiActiveProviderProfile');
    });
  });

  describe('PUT /api/v1/admin/settings', () => {
    it('should update settings', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ registrationEnabled: true });

      expect(response.status).toBe(200);
    });

    it('should validate confirmation thresholds', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'confirmationThreshold', value: '6' },
        { key: 'deepConfirmationThreshold', value: '100' },
      ]);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ deepConfirmationThreshold: 2, confirmationThreshold: 6 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('greater than or equal');
    });

    it('should handle database error', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);
      mockPrisma.systemSetting.upsert.mockRejectedValue(new Error('DB error'));

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ registrationEnabled: false });

      expect(response.status).toBe(500);
    });

    it('should encrypt plaintext SMTP password and clear transporter cache', async () => {
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'smtp.password', value: '"enc:new-secret"' });
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
        { key: 'smtp.password', value: '"enc:new-secret"' },
      ]);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({
          'smtp.host': 'smtp.example.com',
          'smtp.fromAddress': 'noreply@example.com',
          'smtp.password': 'new-secret',
        });

      expect(response.status).toBe(200);
      expect(mockIsEncrypted).toHaveBeenCalledWith('new-secret');
      expect(mockEncrypt).toHaveBeenCalledWith('new-secret');
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'smtp.password' },
          update: { value: JSON.stringify('enc:new-secret') },
          create: { key: 'smtp.password', value: JSON.stringify('enc:new-secret') },
        })
      );
      expect(mockClearTransporterCache).toHaveBeenCalledTimes(1);
      expect(response.body['smtp.configured']).toBe(true);
      expect(response.body['smtp.password']).toBeUndefined();
    });

    it('should use current confirmation threshold when only deep threshold is updated', async () => {
      mockPrisma.systemSetting.findMany
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '3' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ])
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '3' },
          { key: 'deepConfirmationThreshold', value: '7' },
        ]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'deepConfirmationThreshold', value: '7' });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ deepConfirmationThreshold: 7 });

      expect(response.status).toBe(200);
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'deepConfirmationThreshold' },
        })
      );
    });

    it('should use current deep confirmation threshold when only confirmation threshold is updated', async () => {
      mockPrisma.systemSetting.findMany
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '2' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ])
        .mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '4' },
          { key: 'deepConfirmationThreshold', value: '6' },
        ]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'confirmationThreshold', value: '4' });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ confirmationThreshold: 4 });

      expect(response.status).toBe(200);
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'confirmationThreshold' },
        })
      );
    });

    it('should keep already encrypted SMTP password without re-encrypting', async () => {
      mockPrisma.systemSetting.upsert.mockResolvedValue({ key: 'smtp.password', value: '"enc:already-secret"' });
      mockPrisma.systemSetting.findMany.mockResolvedValue([
        { key: 'smtp.host', value: '"smtp.example.com"' },
        { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
        { key: 'smtp.password', value: '"enc:already-secret"' },
      ]);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ 'smtp.password': 'enc:already-secret' });

      expect(response.status).toBe(200);
      expect(mockIsEncrypted).toHaveBeenCalledWith('enc:already-secret');
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'smtp.password' },
          update: { value: JSON.stringify('enc:already-secret') },
          create: { key: 'smtp.password', value: JSON.stringify('enc:already-secret') },
        })
      );
    });

    it('should mirror endpoint updates into the active typed AI provider profile', async () => {
      mockPrisma.systemSetting.findMany
        .mockResolvedValueOnce([
          { key: 'aiEndpoint', value: '"http://ollama:11434"' },
          { key: 'aiModel', value: '"llama3.2:3b"' },
        ])
        .mockResolvedValueOnce([
          { key: 'aiEndpoint', value: '"http://lan-llm:11434"' },
          { key: 'aiModel', value: '"llama3.2:3b"' },
        ]);
      mockPrisma.systemSetting.upsert.mockResolvedValue({
        key: 'aiEndpoint',
        value: '"http://lan-llm:11434"',
      });

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ aiEndpoint: 'http://lan-llm:11434' });

      expect(response.status).toBe(200);

      const providerProfilesCall = mockPrisma.systemSetting.upsert.mock.calls.find(
        ([call]) => call.where.key === 'aiProviderProfiles',
      );
      expect(providerProfilesCall).toBeDefined();
      const storedProfiles = JSON.parse(providerProfilesCall?.[0].update.value ?? '[]');
      expect(storedProfiles[0]).toMatchObject({
        id: 'default-ollama',
        endpoint: 'http://lan-llm:11434',
        model: 'llama3.2:3b',
      });
      expect(mockPrisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'aiActiveProviderProfileId' },
          update: { value: JSON.stringify('default-ollama') },
        })
      );
    });

    it('should reject invalid typed AI provider profile updates', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);

      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({ aiProviderProfiles: [] });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('AI provider profiles');
      expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('should reject duplicate typed AI provider profile IDs', async () => {
      mockPrisma.systemSetting.findMany.mockResolvedValue([]);

      const duplicatedProfile = {
        id: 'lan-ollama',
        name: 'LAN Ollama',
        providerType: 'ollama',
        endpoint: 'http://lan-llm:11434',
        model: 'llama3.2:3b',
        capabilities: { chat: true, toolCalls: false, strictJson: true },
      };
      const response = await adminRoutesRequest()
        .put('/api/v1/admin/settings')
        .send({
          aiProviderProfiles: [duplicatedProfile, { ...duplicatedProfile, name: 'Duplicate LAN Ollama' }],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('AI provider profiles');
      expect(mockPrisma.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });
}
