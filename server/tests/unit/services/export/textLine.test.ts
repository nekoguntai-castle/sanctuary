import { describe, expect, it } from 'vitest';
import { singleLine } from '../../../../src/services/export/handlers/textLine';

describe('singleLine', () => {
  it.each([
    ['a\nb', 'a b'],
    ['a\r\nb', 'a b'],
    ['a\rb', 'a b'],
    ['a\u2028b', 'a b'],
    ['a\u2029b', 'a b'],
    ['a\vb', 'a b'],
    ['a\fb', 'a b'],
    ['a\u0085b', 'a b'],
    ['a\n\nb', 'a  b'],
  ])('replaces line breaks in %j', (input, expected) => {
    expect(singleLine(input)).toBe(expected);
  });

  it('leaves single-line text and empty strings unchanged', () => {
    expect(singleLine('Plain wallet (2)')).toBe('Plain wallet (2)');
    expect(singleLine('')).toBe('');
  });

  it('renders an absent optional field as an empty string', () => {
    expect(singleLine(undefined)).toBe('');
  });
});
