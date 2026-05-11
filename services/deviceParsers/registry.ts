/**
 * Device Parser Registry
 *
 * Central registry for device import format parsers.
 * Parsers are checked in priority order (highest first) to detect formats.
 */

import { PrioritizedRegistry } from '@sanctuary/shared/utils/priorityRegistry';
import { extractErrorMessage } from '@sanctuary/shared/utils/errors';
import { createLogger } from '../../utils/logger';
import type {
  DeviceParser,
  DeviceParserRegistryConfig,
  DeviceParseResult,
  FormatDetectionResult,
} from './types';

const log = createLogger('DEVICE:PARSER');

/**
 * Device Parser Registry
 *
 * Manages registration and detection of device import format parsers.
 */
class DeviceParserRegistry {
  private parsers = new PrioritizedRegistry<DeviceParser>('Device parser');
  private config: DeviceParserRegistryConfig;

  constructor(config: DeviceParserRegistryConfig = {}) {
    this.config = config;
  }

  /**
   * Register a new format parser
   * Parsers are sorted by priority (highest first)
   */
  register(parser: DeviceParser): void {
    this.parsers.register(parser);

    if (this.config.debug) {
      log.debug('Registered device parser', {
        id: parser.id,
        name: parser.name,
        priority: parser.priority,
      });
    }
  }

  /**
   * Unregister a parser by ID
   */
  unregister(id: string): boolean {
    return this.parsers.unregister(id);
  }

  /**
   * Get a parser by ID
   */
  get(id: string): DeviceParser | undefined {
    return this.parsers.get(id);
  }

  /**
   * Get all registered parsers
   */
  getAll(): DeviceParser[] {
    return this.parsers.getAll();
  }

  /**
   * Detect which parser can process the input
   * Returns the first parser that reports canParse with detected: true
   */
  detect(data: unknown): DeviceParser | null {
    return this.parsers.detectFirst(
      (parser) => parser.canParse(data),
      {
        onDetected: (parser, result) => {
          if (this.config.debug) {
            log.debug('Format detected', {
              parser: parser.id,
              confidence: result.confidence,
            });
          }
        },
        onError: (parser, error) => {
          // canParse should not throw, but handle gracefully
          log.warn('Parser canParse threw error', {
            parser: parser.id,
            error: extractErrorMessage(error, String(error)),
          });
        }
      }
    );
  }

  /**
   * Detect format and return detection results from all parsers
   * Useful for debugging or showing format options to user
   */
  detectAll(data: unknown): Array<{ parser: DeviceParser; result: FormatDetectionResult }> {
    return this.parsers.detectAll(
      (parser) => parser.canParse(data),
      () => ({ detected: false, confidence: 0 })
    ).map(({ entry, result }) => ({ parser: entry, result }));
  }

  /**
   * Parse input using the appropriate parser
   * Auto-detects format if no parser ID is specified
   * @param data JSON object or raw string to parse
   * @param parserId Optional specific parser to use
   * @returns Parsed result with format ID, or null if no parser could handle it
   */
  parse(data: unknown, parserId?: string): (DeviceParseResult & { format: string }) | null {
    let parser: DeviceParser | null | undefined;

    if (parserId) {
      parser = this.get(parserId);
      if (!parser) {
        log.warn('Unknown device parser requested', { parserId });
        return null;
      }
    } else {
      parser = this.detect(data);
      if (!parser) {
        if (this.config.debug) {
          log.debug('No parser detected for input');
        }
        return null;
      }
    }

    try {
      const result = parser.parse(data);

      return {
        ...result,
        format: parser.id,
      };
    } catch (error) {
      log.warn('Parser threw error during parse', {
        parser: parser.id,
        error: extractErrorMessage(error, String(error)),
      });
      return null;
    }
  }

  /**
   * Parse JSON string, handling JSON.parse internally
   * Convenience method for raw string input
   */
  parseJson(jsonString: string): (DeviceParseResult & { format: string }) | null {
    try {
      const data = JSON.parse(jsonString);
      return this.parse(data);
    } catch {
      // Not valid JSON, try parsing as raw string
      return this.parse(jsonString);
    }
  }

  /**
   * Get parser count
   */
  get count(): number {
    return this.parsers.count;
  }

  /**
   * Get registry statistics for debugging/testing
   */
  getStats(): { parserCount: number; parsers: Array<{ id: string; name: string; priority: number }> } {
    return {
      parserCount: this.parsers.count,
      parsers: this.parsers.getAll().map((p) => ({
        id: p.id,
        name: p.name,
        priority: p.priority,
      })),
    };
  }
}

// Singleton instance
export const deviceParserRegistry = new DeviceParserRegistry({ debug: false });

// Also export class for testing
export { DeviceParserRegistry };
