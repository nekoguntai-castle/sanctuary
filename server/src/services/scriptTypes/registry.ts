/**
 * Script Type Registry
 *
 * Central registry for Bitcoin script type handlers.
 * Allows registration of new script types for descriptor building.
 */

import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { createLogger } from '../../utils/logger';
import type {
  ScriptTypeHandler,
  ScriptTypeRegistryConfig,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from './types';

const log = createLogger('SCRIPT_TYPE:SVC_REGISTRY');

/**
 * Script Type Registry
 *
 * Manages registration and lookup of script type handlers.
 */
class ScriptTypeRegistry {
  private handlers: Map<string, ScriptTypeHandler> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private config: ScriptTypeRegistryConfig;

  constructor(config: ScriptTypeRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Register a new script type handler
   */
  register(handler: ScriptTypeHandler): void {
    // Check for duplicate IDs
    if (this.handlers.has(handler.id)) {
      throw new Error(`Script type handler '${handler.id}' is already registered`);
    }

    this.handlers.set(handler.id, handler);

    // Register aliases
    if (handler.aliases) {
      for (const alias of handler.aliases) {
        this.aliasMap.set(alias.toLowerCase(), handler.id);
      }
    }

    // Also register the ID itself as an alias
    this.aliasMap.set(handler.id.toLowerCase(), handler.id);

    if (this.config.debug) {
      log.debug('Registered script type handler', {
        id: handler.id,
        name: handler.name,
        aliases: handler.aliases,
      });
    }
  }

  /**
   * Unregister a script type handler by ID
   */
  unregister(id: string): boolean {
    const handler = this.handlers.get(id);
    if (!handler) return false;

    this.handlers.delete(id);

    // Remove aliases
    if (handler.aliases) {
      for (const alias of handler.aliases) {
        this.aliasMap.delete(alias.toLowerCase());
      }
    }
    this.aliasMap.delete(id.toLowerCase());

    return true;
  }

  /**
   * Get a handler by ID or alias
   */
  get(idOrAlias: string): ScriptTypeHandler | undefined {
    // Try direct lookup first
    const direct = this.handlers.get(idOrAlias);
    if (direct) return direct;

    // Try alias lookup
    const resolvedId = this.aliasMap.get(idOrAlias.toLowerCase());
    if (resolvedId) {
      return this.handlers.get(resolvedId);
    }

    return undefined;
  }

  /**
   * Get all registered handlers
   */
  getAll(): ScriptTypeHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get all script type IDs
   */
  getIds(): WalletScriptType[] {
    return Array.from(this.handlers.keys()) as WalletScriptType[];
  }

  /**
   * Check if a script type is registered
   */
  has(idOrAlias: string): boolean {
    return this.get(idOrAlias) !== undefined;
  }

  /**
   * Resolve an alias to the canonical ID
   */
  resolveAlias(alias: string): string | undefined {
    return this.aliasMap.get(alias.toLowerCase());
  }

  /**
   * Get derivation path for single-sig
   */
  getDerivationPath(
    scriptTypeId: string,
    network: Network = 'mainnet',
    account: number = 0
  ): string {
    const handler = this.get(scriptTypeId);
    if (!handler) {
      throw new Error(`Unknown script type: ${scriptTypeId}`);
    }
    return handler.getDerivationPath(network, account);
  }

  /**
   * Get derivation path for multi-sig
   */
  getMultisigDerivationPath(
    scriptTypeId: string,
    network: Network = 'mainnet',
    account: number = 0
  ): string {
    const handler = this.get(scriptTypeId);
    if (!handler) {
      throw new Error(`Unknown script type: ${scriptTypeId}`);
    }
    if (!handler.supportsMultisig) {
      throw new Error(`Script type '${scriptTypeId}' does not support multisig`);
    }
    return handler.getMultisigDerivationPath(network, account);
  }

  /**
   * Build a single-sig descriptor
   */
  buildSingleSigDescriptor(
    scriptTypeId: string,
    device: DeviceKeyInfo,
    options: DescriptorBuildOptions
  ): string {
    const handler = this.get(scriptTypeId);
    if (!handler) {
      throw new Error(`Unknown script type: ${scriptTypeId}`);
    }
    return handler.buildSingleSigDescriptor(device, options);
  }

  /**
   * Build a multi-sig descriptor
   */
  buildMultiSigDescriptor(
    scriptTypeId: string,
    devices: DeviceKeyInfo[],
    options: MultiSigBuildOptions
  ): string {
    const handler = this.get(scriptTypeId);
    if (!handler) {
      throw new Error(`Unknown script type: ${scriptTypeId}`);
    }
    if (!handler.supportsMultisig || !handler.buildMultiSigDescriptor) {
      throw new Error(`Script type '${scriptTypeId}' does not support multisig`);
    }
    return handler.buildMultiSigDescriptor(devices, options);
  }

  /**
   * Get script types that support multisig
   */
  getMultisigCapable(): ScriptTypeHandler[] {
    return this.getAll().filter((h) => h.supportsMultisig);
  }

  /**
   * Get handler count
   */
  get count(): number {
    return this.handlers.size;
  }
}

// Singleton instance
export const scriptTypeRegistry = new ScriptTypeRegistry({ debug: false });

// Also export class for testing
export { ScriptTypeRegistry };
