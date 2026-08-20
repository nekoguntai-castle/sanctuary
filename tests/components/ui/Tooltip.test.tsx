import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    // Placement is no longer a Tailwind class: the popup is portalled and
    // positioned `fixed` from the trigger's rect, so it carries the placement
    // as data and applies the offset transform inline.
    const popup = screen.getByTestId('tooltip-popup');
    expect(popup).toHaveAttribute('data-placement', 'bottom');
    expect(popup).toHaveClass('tooltip-portal');
    expect(popup.style.transform).toBe('translateX(-50%)');
  });

  it('renders the popup outside the trigger so no ancestor can clip it', () => {
    // The whole point of the portal: as a sibling of the trigger the popup was
    // clipped by WalletGridCard / the wallet-detail Card (overflow-hidden) and
    // by TableShell (overflow-x-auto, which forces overflow-y to auto).
    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <Tooltip content="why" label="Why">
          <span>Failed</span>
        </Tooltip>
      </div>
    );

    const popup = screen.getByTestId('tooltip-popup');
    expect(container.contains(popup)).toBe(false);
    expect(document.body.contains(popup)).toBe(true);
  });

  it('opens on hover, since a portalled popup is out of CSS :hover reach', () => {
    render(
      <Tooltip content="why" label="Why">
        <span>Failed</span>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Why' });
    expect(screen.getByTestId('tooltip-popup')).not.toHaveClass('tooltip-visible');

    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId('tooltip-popup')).toHaveClass('tooltip-visible');

    fireEvent.mouseLeave(trigger);
    expect(screen.getByTestId('tooltip-popup')).not.toHaveClass('tooltip-visible');
  });

  it('places a top tooltip fully above its trigger', () => {
    render(
      <Tooltip content="why" label="Why" placement="top">
        <span>Failed</span>
      </Tooltip>
    );

    const popup = screen.getByTestId('tooltip-popup');
    expect(popup).toHaveAttribute('data-placement', 'top');
    // -100% lifts it clear of the trigger rather than overlapping it.
    expect(popup.style.transform).toBe('translate(-50%, -100%)');
  });
});

describe('Tooltip viewport clamping', () => {
  const setPopupWidth = (width: number) => {
    // jsdom has no layout, so offsetWidth is 0 and the clamp never engages.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'tooltip-popup' ? width : 0;
      },
    });
  };

  const setTriggerRect = (left: number, width = 20) => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left, right: left + width, top: 100, bottom: 120,
          width, height: 20, x: left, y: 100, toJSON: () => ({}),
        } as DOMRect;
      },
    });
  };

  afterEach(() => {
    // @ts-expect-error -- restoring the jsdom prototype getters
    delete HTMLElement.prototype.offsetWidth;
    // @ts-expect-error -- restoring the jsdom prototype methods
    delete HTMLElement.prototype.getBoundingClientRect;
  });

  const open = () => {
    render(
      <Tooltip content="a long explanation" label="Why" placement="bottom">
        <span>Failed</span>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Why' }));
    return screen.getByTestId('tooltip-popup');
  };

  it('keeps a popup off the left edge when its trigger hugs it', () => {
    window.innerWidth = 1024;
    setPopupWidth(200);
    setTriggerRect(0);

    // Centre would be 10; half the popup (100) plus the 8px margin wins.
    expect(open().style.left).toBe('108px');
  });

  it('keeps a popup off the right edge when its trigger hugs it', () => {
    window.innerWidth = 1024;
    setPopupWidth(200);
    setTriggerRect(1004);

    expect(open().style.left).toBe('916px');
  });

  it('leaves the centre alone when the popup fits', () => {
    window.innerWidth = 1024;
    setPopupWidth(200);
    setTriggerRect(500);

    expect(open().style.left).toBe('510px');
  });

  it('does not clamp when the viewport is narrower than the popup', () => {
    // min would exceed max; clamping would push it further off-screen.
    window.innerWidth = 100;
    setPopupWidth(400);
    setTriggerRect(10);

    expect(open().style.left).toBe('20px');
  });

  it('repositions on scroll while open', () => {
    window.innerWidth = 1024;
    setPopupWidth(200);
    setTriggerRect(500);
    const popup = open();
    expect(popup.style.left).toBe('510px');

    setTriggerRect(300);
    fireEvent.scroll(window);

    expect(screen.getByTestId('tooltip-popup').style.left).toBe('310px');
  });
});
