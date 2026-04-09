import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginBackground } from '../../../components/Login/LoginBackground';

vi.mock('../../../components/AnimatedBackground', () => ({
  default: ({ pattern }: { pattern: string }) => (
    <div data-testid="animated-bg">{pattern}</div>
  ),
}));

describe('LoginBackground', () => {
  it('renders children', () => {
    render(
      <LoginBackground darkMode={false}>
        <span>Child content</span>
      </LoginBackground>,
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders dust motes', () => {
    const { container } = render(
      <LoginBackground darkMode={false}>
        <span>Test</span>
      </LoginBackground>,
    );

    const motes = container.querySelectorAll('.dust-mote');
    expect(motes.length).toBe(10);
  });

  it('passes zen-sand-garden pattern for light mode', async () => {
    render(
      <LoginBackground darkMode={false}>
        <span>Test</span>
      </LoginBackground>,
    );

    // The lazy-loaded AnimatedBackground gets the pattern
    expect(await screen.findByText('zen-sand-garden')).toBeInTheDocument();
  });

  it('passes fireflies pattern for dark mode', async () => {
    render(
      <LoginBackground darkMode={true}>
        <span>Test</span>
      </LoginBackground>,
    );

    expect(await screen.findByText('fireflies')).toBeInTheDocument();
  });
});
