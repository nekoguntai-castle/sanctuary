/**
 * Remaining Admin API Module Tests
 *
 * Coverage-focused unit tests for low-coverage admin API modules:
 * - backup, settings, monitoring, groups, users, feature flags
 */

import { describe, expect, it } from "vitest";

import {
  mockDelete,
  mockFetchBlob,
  mockGet,
  mockPatch,
  mockPost,
  mockPut,
  setupRemainingApiModuleMocks,
} from "./remainingApiModules.testHarness";

import * as adminBackupApi from "../../src/api/admin/backup";
import * as adminFeaturesApi from "../../src/api/admin/features";
import * as adminGroupsApi from "../../src/api/admin/groups";
import * as adminMonitoringApi from "../../src/api/admin/monitoring";
import * as adminSettingsApi from "../../src/api/admin/settings";
import * as adminUsersApi from "../../src/api/admin/users";

describe("Remaining Admin API Modules", () => {
  setupRemainingApiModuleMocks();

  describe("Admin Backup API", () => {
    it("calls backup, audit, and version endpoints", async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await adminBackupApi.getEncryptionKeys("test-password");
      await adminBackupApi.createBackupJson({ includeSettings: true } as any);
      await adminBackupApi.validateBackup({ meta: {} } as any);
      await adminBackupApi.restoreBackup({ meta: {} } as any);
      await adminBackupApi.getAuditLogs({
        userId: "u1",
        username: "alice",
        action: "login",
        category: "auth",
        success: true,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        limit: 10,
        offset: 20,
      });
      await adminBackupApi.getAuditLogStats();
      await adminBackupApi.getAuditLogStats(7);
      await adminBackupApi.checkVersion();

      expect(mockPost).toHaveBeenCalledWith("/admin/encryption-keys", {
        password: "test-password",
      });
      expect(mockPost).toHaveBeenCalledWith("/admin/backup", {
        includeSettings: true,
      });
      expect(mockPost).toHaveBeenCalledWith("/admin/backup/validate", {
        backup: { meta: {} },
      });
      expect(mockPost).toHaveBeenCalledWith("/admin/restore", {
        backup: { meta: {} },
        confirmationCode: "CONFIRM_RESTORE",
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs", {
        userId: "u1",
        username: "alice",
        action: "login",
        category: "auth",
        success: true,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        limit: 10,
        offset: 20,
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs/stats", undefined);
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs/stats", { days: 7 });
      expect(mockGet).toHaveBeenCalledWith("/admin/version");
    });

    it("creates backup blob through the shared API client transfer helper", async () => {
      const blob = new Blob(["backup-data"], { type: "application/json" });
      mockFetchBlob.mockResolvedValueOnce(blob);

      const result = await adminBackupApi.createBackup({
        includeAuditLogs: true,
      } as any);
      expect(result).toEqual(blob);
      const [calledEndpoint, calledOptions] = mockFetchBlob.mock.calls[0];
      expect(calledEndpoint).toBe("/admin/backup");
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.headers["Content-Type"]).toBe("application/json");
      expect(calledOptions.body).toBe(
        JSON.stringify({ includeAuditLogs: true }),
      );

      mockFetchBlob.mockRejectedValueOnce(new Error("Backup failed"));
      await expect(adminBackupApi.createBackup()).rejects.toThrow(
        "Backup failed",
      );
    });

    it("covers backup API fallback and optional query branches", async () => {
      mockPost.mockResolvedValue({});
      mockGet.mockResolvedValue({});

      // createBackupJson defaults to empty options object
      await adminBackupApi.createBackupJson();
      expect(mockPost).toHaveBeenCalledWith("/admin/backup", {});

      // getAuditLogs with no query uses base URL
      await adminBackupApi.getAuditLogs();
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs");

      // success omitted should not append success query param
      await adminBackupApi.getAuditLogs({ userId: "u-omitted-success" });
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs", {
        userId: "u-omitted-success",
        username: undefined,
        action: undefined,
        category: undefined,
        success: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined,
      });

      // success=false should still be included; limit/offset=0 should be omitted by truthy checks
      await adminBackupApi.getAuditLogs({
        success: false,
        limit: 0,
        offset: 0,
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs", {
        userId: undefined,
        username: undefined,
        action: undefined,
        category: undefined,
        success: false,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined,
      });

      // days=0 uses fallback stats endpoint without query param
      await adminBackupApi.getAuditLogStats(0);
      expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs/stats", undefined);

      // createBackup with no options sends an empty JSON object through
      // apiClient.fetchBlob, which owns credentials, CSRF, and refresh retry.
      mockFetchBlob.mockResolvedValueOnce(new Blob(["ok"]));
      await adminBackupApi.createBackup();
      const lastCall =
        mockFetchBlob.mock.calls[mockFetchBlob.mock.calls.length - 1];
      expect(lastCall[0]).toBe("/admin/backup");
      expect(lastCall[1].method).toBe("POST");
      expect(lastCall[1].headers["Content-Type"]).toBe("application/json");
      expect(lastCall[1].body).toBe(JSON.stringify({}));
    });
  });

  describe("Admin Settings/Monitoring/Groups/Users APIs", () => {
    it("calls settings and node config endpoints", async () => {
      mockGet.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await adminSettingsApi.getSystemSettings();
      await adminSettingsApi.updateSystemSettings({
        registrationEnabled: false,
      } as any);
      await adminSettingsApi.getNodeConfig();
      await adminSettingsApi.updateNodeConfig({} as any);
      await adminSettingsApi.testNodeConfig({} as any);
      await adminSettingsApi.getElectrumServers();
      await adminSettingsApi.getElectrumServers("mainnet");
      await adminSettingsApi.addElectrumServer({
        label: "Server",
        host: "electrum.example.com",
        port: 50002,
        useSsl: true,
        network: "mainnet",
        enabled: true,
        priority: 1,
      } as any);
      await adminSettingsApi.updateElectrumServer("s1", { enabled: false });
      await adminSettingsApi.deleteElectrumServer("s1");
      await adminSettingsApi.testElectrumServer("s1");
      await adminSettingsApi.reorderElectrumServers(["s1", "s2"]);
      await adminSettingsApi.testElectrumConnection({
        host: "e",
        port: 50002,
        useSsl: true,
      });
      await adminSettingsApi.testProxy({ host: "127.0.0.1", port: 9050 });

      expect(mockGet).toHaveBeenCalledWith("/admin/settings");
      expect(mockPut).toHaveBeenCalledWith("/admin/settings", {
        registrationEnabled: false,
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/node-config");
      expect(mockPut).toHaveBeenCalledWith("/admin/node-config", {});
      expect(mockPost).toHaveBeenCalledWith("/admin/node-config/test", {});
      expect(mockGet).toHaveBeenCalledWith("/admin/electrum-servers", undefined);
      expect(mockGet).toHaveBeenCalledWith("/admin/electrum-servers", { network: "mainnet" });
      expect(mockPost).toHaveBeenCalledWith("/admin/electrum-servers", {
        label: "Server",
        host: "electrum.example.com",
        port: 50002,
        useSsl: true,
        network: "mainnet",
        enabled: true,
        priority: 1,
      });
      expect(mockPut).toHaveBeenCalledWith("/admin/electrum-servers/s1", {
        enabled: false,
      });
      expect(mockDelete).toHaveBeenCalledWith("/admin/electrum-servers/s1");
      expect(mockPost).toHaveBeenCalledWith("/admin/electrum-servers/s1/test");
      expect(mockPut).toHaveBeenCalledWith("/admin/electrum-servers/reorder", {
        serverIds: ["s1", "s2"],
      });
      expect(mockPost).toHaveBeenCalledWith(
        "/admin/electrum-servers/test-connection",
        {
          host: "e",
          port: 50002,
          useSsl: true,
        },
      );
      expect(mockPost).toHaveBeenCalledWith("/admin/proxy/test", {
        host: "127.0.0.1",
        port: 9050,
      });
    });

    it("calls monitoring, group, and user admin endpoints", async () => {
      mockGet.mockResolvedValue({});
      mockPut.mockResolvedValue({});
      mockPost.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await adminMonitoringApi.getMonitoringServices();
      await adminMonitoringApi.getMonitoringServices(true);
      await adminMonitoringApi.updateMonitoringServiceUrl(
        "svc1",
        "https://grafana.example",
      );
      await adminMonitoringApi.getGrafanaConfig();
      await adminMonitoringApi.updateGrafanaConfig({ anonymousAccess: true });
      await adminMonitoringApi.getWebSocketStats();
      await adminMonitoringApi.getTorContainerStatus();
      await adminMonitoringApi.startTorContainer();
      await adminMonitoringApi.stopTorContainer();

      await adminGroupsApi.getGroups();
      await adminGroupsApi.createGroup({ name: "Ops" });
      await adminGroupsApi.updateGroup("g1", { name: "Ops 2" });
      await adminGroupsApi.deleteGroup("g1");
      await adminGroupsApi.addGroupMember("g1", "u1", "member");
      await adminGroupsApi.removeGroupMember("g1", "u1");

      await adminUsersApi.getUsers();
      await adminUsersApi.createUser({
        username: "alice",
        password: "secret",
      } as any);
      await adminUsersApi.updateUser("u1", { isAdmin: true } as any);
      await adminUsersApi.deleteUser("u1");

      expect(mockGet).toHaveBeenCalledWith("/admin/monitoring/services", undefined);
      expect(mockGet).toHaveBeenCalledWith("/admin/monitoring/services", { checkHealth: true });
      expect(mockPut).toHaveBeenCalledWith("/admin/monitoring/services/svc1", {
        customUrl: "https://grafana.example",
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/monitoring/grafana");
      expect(mockPut).toHaveBeenCalledWith("/admin/monitoring/grafana", {
        anonymousAccess: true,
      });
      expect(mockGet).toHaveBeenCalledWith("/admin/websocket/stats");
      expect(mockGet).toHaveBeenCalledWith("/admin/tor-container/status");
      expect(mockPost).toHaveBeenCalledWith("/admin/tor-container/start", {});
      expect(mockPost).toHaveBeenCalledWith("/admin/tor-container/stop", {});

      expect(mockGet).toHaveBeenCalledWith("/admin/groups");
      expect(mockPost).toHaveBeenCalledWith("/admin/groups", { name: "Ops" });
      expect(mockPut).toHaveBeenCalledWith("/admin/groups/g1", {
        name: "Ops 2",
      });
      expect(mockDelete).toHaveBeenCalledWith("/admin/groups/g1");
      expect(mockPost).toHaveBeenCalledWith("/admin/groups/g1/members", {
        userId: "u1",
        role: "member",
      });
      expect(mockDelete).toHaveBeenCalledWith("/admin/groups/g1/members/u1");

      expect(mockGet).toHaveBeenCalledWith("/admin/users");
      expect(mockPost).toHaveBeenCalledWith("/admin/users", {
        username: "alice",
        password: "secret",
      });
      expect(mockPut).toHaveBeenCalledWith("/admin/users/u1", {
        isAdmin: true,
      });
      expect(mockDelete).toHaveBeenCalledWith("/admin/users/u1");
    });
  });

  describe("Admin Feature Flags API", () => {
    it("calls feature flag CRUD endpoints", async () => {
      mockGet.mockResolvedValue([]);
      mockPatch.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await adminFeaturesApi.getFeatureFlags();
      await adminFeaturesApi.updateFeatureFlag("aiAssistant", true, "Testing");
      await adminFeaturesApi.resetFeatureFlag("aiAssistant");
      await adminFeaturesApi.getFeatureFlagAuditLog();

      expect(mockGet).toHaveBeenCalledWith("/admin/features");
      expect(mockPatch).toHaveBeenCalledWith("/admin/features/aiAssistant", {
        enabled: true,
        reason: "Testing",
      });
      expect(mockPost).toHaveBeenCalledWith(
        "/admin/features/aiAssistant/reset",
      );
      expect(mockGet).toHaveBeenCalledWith("/admin/features/audit-log", {
        key: undefined,
        limit: undefined,
      });
    });

    it("passes optional key and limit to audit log", async () => {
      mockGet.mockResolvedValue({
        entries: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await adminFeaturesApi.getFeatureFlagAuditLog("treasuryAutopilot", 10);

      expect(mockGet).toHaveBeenCalledWith("/admin/features/audit-log", {
        key: "treasuryAutopilot",
        limit: 10,
      });
    });

    it("omits query params when not provided", async () => {
      mockGet.mockResolvedValue({
        entries: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      await adminFeaturesApi.getFeatureFlagAuditLog();

      expect(mockGet).toHaveBeenCalledWith("/admin/features/audit-log", {
        key: undefined,
        limit: undefined,
      });
    });

    it("calls updateFeatureFlag without reason", async () => {
      mockPatch.mockResolvedValue({});

      await adminFeaturesApi.updateFeatureFlag("priceAlerts", false);

      expect(mockPatch).toHaveBeenCalledWith("/admin/features/priceAlerts", {
        enabled: false,
        reason: undefined,
      });
    });
  });
});
