import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../scripts/architecture/extract-call-graphs.mjs';

describe('extract-call-graphs config validation', () => {
  it('accepts the supported call graph config shape', () => {
    const config = {
      $schema: './calls.config.schema.json',
      _comment: 'tracked subsystems only',
      subsystems: [
        {
          name: 'notifications',
          title: 'Notifications',
          description: 'Notification delivery paths.',
          include: ['server/src/services/notifications/**/*.ts'],
        },
      ],
    };

    expect(validateConfig(config)).toBe(config);
  });

  it('rejects malformed subsystem metadata and unsafe include paths', () => {
    expect(() => validateConfig({
      extra: true,
      subsystems: [
        {
          name: 'Bad Name',
          title: '',
          description: 'Invalid subsystem.',
          include: ['../outside.ts'],
          unsupported: true,
        },
        {
          name: 'Bad Name',
          title: 'Duplicate',
          description: 'Duplicate subsystem.',
          include: [],
        },
      ],
    })).toThrow(/extra is not supported/);
  });

  it('requires at least one subsystem', () => {
    expect(() => validateConfig({ subsystems: [] })).toThrow('subsystems must contain at least one subsystem');
  });
});
