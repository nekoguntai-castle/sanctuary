import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollapsibleSection } from '../../../src/components/ui/CollapsibleSection';

const mockPreferences = new Map<string, unknown>();

vi.mock('../../../src/hooks/useUserPreference', async () => {
  const { useState } = await import('react');
  return {
    useUserPreference: (key: string, defaultValue: unknown) => {
      const [value, setValue] = useState(
        mockPreferences.has(key) ? mockPreferences.get(key) : defaultValue
      );
      return [
        value,
        (newValue: unknown) => {
          mockPreferences.set(key, newValue);
          setValue(newValue);
        },
      ];
    },
  };
});

const PREF_KEY = 'viewSettings.dashboard.testCollapsed';

describe('CollapsibleSection', () => {
  beforeEach(() => {
    mockPreferences.clear();
  });

  const renderSection = (props: Partial<React.ComponentProps<typeof CollapsibleSection>> = {}) =>
    render(
      <CollapsibleSection preferenceKey={PREF_KEY} title="Network Status" {...props}>
        <p>visualiser body</p>
      </CollapsibleSection>
    );

  it('renders expanded by default with accurate disclosure ARIA', () => {
    renderSection();

    const toggle = screen.getByRole('button', { name: /Network Status/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const body = screen.getByText('visualiser body').parentElement!;
    expect(body).not.toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-controls', body.id);
  });

  it('hides the body and reveals the summary when collapsed', async () => {
    const user = userEvent.setup();
    renderSection({ summary: <span>~2 sat/vB · 13 blocks queued</span> });

    expect(screen.queryByText(/13 blocks queued/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Network Status/ }));

    const toggle = screen.getByRole('button', { name: /Network Status/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('visualiser body').parentElement).toHaveAttribute('hidden');
    expect(screen.getByText(/13 blocks queued/)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('visualiser body').parentElement).not.toHaveAttribute('hidden');
    expect(screen.queryByText(/13 blocks queued/)).not.toBeInTheDocument();
  });

  it('persists the collapsed state under the supplied preference key', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Network Status/ }));
    expect(mockPreferences.get(PREF_KEY)).toBe(true);
  });

  it('honours a persisted collapsed state and defaultCollapsed on mount', () => {
    mockPreferences.set(PREF_KEY, true);
    const { unmount } = renderSection();
    expect(screen.getByRole('button', { name: /Network Status/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    unmount();

    mockPreferences.clear();
    renderSection({ defaultCollapsed: true });
    expect(screen.getByRole('button', { name: /Network Status/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('renders actions and applies class overrides', () => {
    const { container } = renderSection({
      actions: <button type="button">Refresh</button>,
      className: 'custom-card',
      headerClassName: 'custom-header',
    });

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(container.querySelector('section')).toHaveClass('custom-card');
    expect(container.querySelector('.custom-header')).toBeInTheDocument();
  });

  it('wraps the toggle in a heading so the section stays in the heading outline', () => {
    renderSection({ headingClassName: 'eyebrow' });

    const heading = screen.getByRole('heading', { level: 3, name: 'Network Status' });
    expect(heading).toHaveClass('eyebrow');
    // APG accordion shape: heading wraps the button, never the reverse.
    expect(heading.querySelector('button')).toBe(
      screen.getByRole('button', { name: 'Network Status' })
    );
  });

  it('honours a custom heading level', () => {
    renderSection({ headingLevel: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Network Status' })).toBeInTheDocument();
  });

  it('keeps titleAdornment out of the button accessible name', () => {
    renderSection({ titleAdornment: <span>TESTNET3</span> });

    expect(screen.getByRole('button', { name: 'Network Status' })).toBeInTheDocument();
    expect(screen.getByText('TESTNET3')).toBeInTheDocument();
  });
});
