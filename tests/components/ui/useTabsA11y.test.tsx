import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTabsA11y } from '../../../src/components/ui/useTabsA11y';

type DemoTab = 'alpha' | 'beta' | 'gamma';

const tabs: DemoTab[] = ['alpha', 'beta', 'gamma'];
const originalRequestAnimationFrame = window.requestAnimationFrame;

function DemoTabs({
  disabledTabs = [],
  initialTab = 'beta',
  onChange = vi.fn(),
  tabValues = tabs,
}: {
  disabledTabs?: DemoTab[];
  initialTab?: DemoTab;
  onChange?: (tab: DemoTab) => void;
  tabValues?: DemoTab[];
}) {
  const [activeTab, setActiveTab] = useState<DemoTab>(initialTab);
  const disabledSet = new Set(disabledTabs);
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: tabValues,
    activeTab,
    onTabChange: (tab) => {
      setActiveTab(tab);
      onChange(tab);
    },
    isTabDisabled: (tab) => disabledSet.has(tab),
  });

  return (
    <div {...getTabListProps('Demo tabs')}>
      {tabValues.map((tab) => (
        <button key={tab} {...getTabProps(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

describe('useTabsA11y', () => {
  afterEach(() => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
  });

  it('moves to the first enabled tab with Home and focuses without animation frames', () => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
    });
    const onChange = vi.fn();

    render(<DemoTabs initialTab="gamma" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'Home',
    });

    expect(onChange).toHaveBeenCalledWith('alpha');
    expect(screen.getByRole('tab', { name: 'alpha' })).toHaveFocus();
  });

  it('does not move when every relative tab candidate is disabled', () => {
    const onChange = vi.fn();

    render(
      <DemoTabs
        disabledTabs={['alpha', 'beta', 'gamma']}
        initialTab="alpha"
        onChange={onChange}
      />
    );
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'ArrowRight',
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'alpha' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('does not move when the tab collection is empty', () => {
    const onChange = vi.fn();

    render(<DemoTabs tabValues={[]} initialTab="alpha" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'ArrowRight',
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('moves from a missing active tab in both relative directions', () => {
    const onChange = vi.fn();
    const missingTab = 'missing' as DemoTab;

    const { unmount } = render(
      <DemoTabs initialTab={missingTab} onChange={onChange} />
    );

    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenLastCalledWith('alpha');

    unmount();
    render(<DemoTabs initialTab={missingTab} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenLastCalledWith('gamma');
  });

  it('moves to the last enabled tab with End', () => {
    const onChange = vi.fn();

    render(<DemoTabs initialTab="alpha" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'End',
    });

    expect(onChange).toHaveBeenCalledWith('gamma');
  });

  it('ignores keys that are not tab navigation shortcuts', () => {
    const onChange = vi.fn();

    render(<DemoTabs initialTab="alpha" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Demo tabs' }), {
      key: 'PageDown',
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'alpha' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
