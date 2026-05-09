import { expect, it, vi } from "vitest";
import type { NodeClientTestContext } from "./nodeClientTestContext";

export function registerNodeClientTestConfigTests(
  context: NodeClientTestContext,
): void {
  const { mocks, testNodeConfig } = context;

  it("tests node config successfully with verbose capability info", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi.fn().mockResolvedValue(true);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: true,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("verifies configured network identity when testing node config", async () => {
    const testClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getBlockHeight: vi.fn().mockResolvedValue(133929),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    };
    mocks.electrumClientCtor.mockImplementationOnce(() => testClient);

    const result = await testNodeConfig({
      host: "electrum-testnet4.example.com",
      port: 60002,
      protocol: "ssl",
      network: "testnet4",
    });

    expect(result.success).toBe(true);
    expect(mocks.electrumClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ network: "testnet4" }),
    );
    expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledWith(
      testClient,
      "testnet4",
    );
  });

  it("disconnects test node clients that fail network identity verification", async () => {
    const testClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getBlockHeight: vi.fn().mockResolvedValue(4959040),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    };
    mocks.electrumClientCtor.mockImplementationOnce(() => testClient);
    mocks.verifyNodeClientNetwork.mockRejectedValueOnce(
      new Error("Testnet4 chain identity mismatch"),
    );

    const result = await testNodeConfig({
      host: "electrum.blockstream.example",
      port: 60002,
      protocol: "ssl",
      network: "testnet4",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Testnet4 chain identity mismatch");
    expect(testClient.disconnect).toHaveBeenCalledTimes(1);
    expect(testClient.testVerboseSupport).not.toHaveBeenCalled();
  });

  it("handles verbose capability probe failures but still succeeds", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi
      .fn()
      .mockRejectedValue(new Error("capability unavailable"));
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: undefined,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("reports verbose unsupported when capability probe returns false", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi.fn().mockResolvedValue(false);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("verbose: no");
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: false,
    });
  });

  it("returns connection failure from testNodeConfig", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("connect failed"));
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect: vi.fn(),
      getBlockHeight: vi.fn(),
      testVerboseSupport: vi.fn(),
    }));

    const result = await testNodeConfig({
      host: "down.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("connect failed");
  });

  it("returns connection failure when test client construction fails", async () => {
    mocks.electrumClientCtor.mockImplementationOnce(() => {
      throw new Error("invalid test config");
    });

    const result = await testNodeConfig({
      host: "invalid.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("invalid test config");
  });

  it("defaults protocol to ssl in testNodeConfig when protocol is omitted", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    }));

    const result = await testNodeConfig({
      host: "electrum-default.example.com",
      port: 50002,
    });

    expect(result.success).toBe(true);
    expect(mocks.electrumClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "electrum-default.example.com",
        port: 50002,
        protocol: "ssl",
      }),
    );
  });
}
