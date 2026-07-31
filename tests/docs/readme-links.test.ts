/**
 * README Link Validation Tests
 *
 * Validates that all internal anchor links in README.md point to existing headings.
 * This prevents broken table of contents links from being committed.
 */

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

describe('README.md Links', () => {
  const readmePath = join(__dirname, '../../README.md');
  let readmeContent: string;

  beforeAll(() => {
    readmeContent = readFileSync(readmePath, 'utf-8');
  });

  /**
   * Converts a markdown heading to GitHub's anchor format.
   * GitHub's algorithm:
   * 1. Convert to lowercase
   * 2. Remove all characters except alphanumeric, spaces, and hyphens
   * 3. Replace spaces with hyphens
   * 4. Collapse multiple consecutive hyphens into one
   */
  function headingToAnchor(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Extracts all internal anchor links from markdown content.
   * Matches patterns like [Text](#anchor-link)
   */
  function extractInternalLinks(content: string): string[] {
    const linkRegex = /\]\(#([^)]+)\)/g;
    const links: string[] = [];
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }

    return links;
  }

  /**
   * Extracts all headings from markdown content.
   * Matches lines starting with one or more # characters.
   */
  function extractHeadings(content: string): string[] {
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    const headings: string[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      headings.push(match[1].trim());
    }

    return headings;
  }

  it('should have a README.md file', () => {
    expect(typeof readmeContent).toBe('string');
    expect(readmeContent.length).toBeGreaterThan(0);
  });

  it('should have all internal links pointing to existing headings', () => {
    const links = extractInternalLinks(readmeContent);
    const headings = extractHeadings(readmeContent);
    const anchors = new Set(headings.map(headingToAnchor));

    const brokenLinks: string[] = [];

    for (const link of links) {
      if (!anchors.has(link)) {
        brokenLinks.push(link);
      }
    }

    if (brokenLinks.length > 0) {
      // Provide helpful error message with suggestions
      const suggestions = brokenLinks.map((link) => {
        // Find similar anchors that might be the intended target
        const similar = Array.from(anchors).filter(
          (anchor) => anchor.includes(link.split('-')[0]) || link.includes(anchor.split('-')[0])
        );
        return `  - #${link}${similar.length > 0 ? ` (did you mean: ${similar.map((s) => `#${s}`).join(', ')}?)` : ''}`;
      });

      throw new Error(`Found ${brokenLinks.length} broken internal link(s):\n${suggestions.join('\n')}`);
    }

    expect(brokenLinks).toHaveLength(0);
  });

  it('should have no duplicate anchors', () => {
    const headings = extractHeadings(readmeContent);
    const anchors = headings.map(headingToAnchor);
    const seen = new Map<string, number>();
    const duplicates: string[] = [];

    for (const anchor of anchors) {
      const count = seen.get(anchor) || 0;
      seen.set(anchor, count + 1);
      if (count === 1) {
        // First duplicate found
        duplicates.push(anchor);
      }
    }

    if (duplicates.length > 0) {
      // Note: GitHub handles duplicates by appending -1, -2, etc.
      // This test warns but doesn't fail, as duplicates are sometimes intentional
      console.warn(`Warning: Found ${duplicates.length} duplicate heading anchor(s): ${duplicates.join(', ')}`);
    }
  });

  it('should have a table of contents', () => {
    expect(readmeContent).toContain('## Table of Contents');
  });

  it('should have essential sections', () => {
    const essentialSections = [
      'Quick Install',
      'Features',
      'Installation',
      'Configuration',
      'Usage',
      'License',
    ];

    for (const section of essentialSections) {
      expect(readmeContent).toContain(`## ${section}`);
    }
  });

  it('rejects obsolete alternate public forge generation', () => {
    const scriptPath = join(__dirname, '../../scripts/generate-readme.sh');
    const result = spawnSync('bash', [scriptPath, 'gitlab'], {
      cwd: join(__dirname, '../..'),
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GitHub is the only supported public distribution source');
  });
});
