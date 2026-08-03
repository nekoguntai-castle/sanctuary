import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '../../../src/components/ui/Card';

describe('Card', () => {
  it('renders a div with the medium padding shell by default', () => {
    const { container } = render(<Card>body</Card>);

    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveClass('surface-elevated', 'rounded-xl', 'shadow-sm', 'p-5');
    expect(el).not.toHaveClass('card-interactive');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('applies each padding step', () => {
    const steps: Array<[React.ComponentProps<typeof Card>['padding'], string | null]> = [
      ['none', null],
      ['sm', 'p-4'],
      ['md', 'p-5'],
      ['lg', 'p-6'],
      ['xl', 'p-12'],
    ];

    for (const [padding, expected] of steps) {
      const { container, unmount } = render(<Card padding={padding}>x</Card>);
      const el = container.firstElementChild as HTMLElement;
      if (expected) {
        expect(el).toHaveClass(expected);
      } else {
        expect(el.className).not.toMatch(/\bp-\d/);
      }
      unmount();
    }
  });

  it('adds the interactive treatment and merges extra classes', () => {
    const { container } = render(
      <Card interactive className="animate-fade-in">
        x
      </Card>
    );

    expect(container.firstElementChild).toHaveClass('card-interactive', 'animate-fade-in');
  });

  it('renders as another element and forwards DOM props', () => {
    const { container } = render(
      <Card as="section" id="panel" data-testid="card-section">
        x
      </Card>
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('SECTION');
    expect(el).toHaveAttribute('id', 'panel');
    expect(screen.getByTestId('card-section')).toBeInTheDocument();
  });

});
