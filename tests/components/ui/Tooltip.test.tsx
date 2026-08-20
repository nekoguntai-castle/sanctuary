import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '../../../src/components/ui/Tooltip';

const renderTooltip = (content = 'connect ECONNREFUSED 127.0.0.1:50002') =>
  render(
    <Tooltip content={content} label="Sync failure detail">
      <span>Failed</span>
    </Tooltip>
  );

describe('Tooltip', () => {
  it('associates the popup with the trigger so screen readers announce it', () => {
    renderTooltip();

    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toEqual(expect.any(String));
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'connect ECONNREFUSED 127.0.0.1:50002'
    );
  });

  it('gives every instance its own popup id', () => {
    render(
      <>
        <Tooltip content="first" label="First">
          <span>one</span>
        </Tooltip>
        <Tooltip content="second" label="Second">
          <span>two</span>
        </Tooltip>
      </>
    );

    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    expect(first.getAttribute('aria-describedby')).not.toBe(
      second.getAttribute('aria-describedby')
    );
  });

  it('opens on focus and closes on blur', () => {
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('tooltip-popup')).toHaveClass('tooltip-visible');

    fireEvent.blur(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('tooltip-popup')).not.toHaveClass('tooltip-visible');
  });

  it('opens on the FIRST tap, in real browser event order', () => {
    // Browsers fire focus before click. Handling both naively opened on focus
    // and closed again on click, so the first tap appeared to do nothing.
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });

    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes again on a second tap', () => {
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });

    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.pointerDown(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape', () => {
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });

    fireEvent.pointerDown(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click', () => {
    renderTooltip();
    const trigger = screen.getByRole('button', { name: 'Sync failure detail' });

    fireEvent.pointerDown(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the children plainly when there is no content to explain', () => {
    render(
      <Tooltip content={null} label="Sync failure detail">
        <span>Synced</span>
      </Tooltip>
    );

    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tooltip-popup')).not.toBeInTheDocument();
  });

  it('accepts extra classes on the trigger and a placement override', () => {
    render(
      <Tooltip content="why" label="Why" className="ml-1" placement="bottom">
        <span>Failed</span>
      </Tooltip>
    );

    expect(screen.getByRole('button', { name: 'Why' })).toHaveClass('ml-1');
    expect(screen.getByTestId('tooltip-popup')).toHaveClass('top-full');
  });
});
