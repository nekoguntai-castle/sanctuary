import { fireEvent,render,screen } from '@testing-library/react';
import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { VisualSettingsPanel } from '../../../../../../components/Settings/sections/ThemeSection/panels/VisualSettingsPanel';

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof VisualSettingsPanel>> = {},
) => {
  const onToggleDarkMode = vi.fn();
  const onContrastChange = vi.fn();
  const onPatternOpacityChange = vi.fn();

  const view = render(
    <VisualSettingsPanel
      isDark={false}
      contrastLevel={0}
      patternOpacity={50}
      onToggleDarkMode={onToggleDarkMode}
      onContrastChange={onContrastChange}
      onPatternOpacityChange={onPatternOpacityChange}
      {...overrides}
    />,
  );

  return { ...view, onToggleDarkMode, onContrastChange, onPatternOpacityChange };
};

describe('VisualSettingsPanel branch coverage', () => {
  it('covers dark mode class branches and toggle callback', () => {
    const { onToggleDarkMode, rerender } = renderPanel({ isDark: false });

    const toggleButton = screen.getByRole('switch');
    expect(toggleButton.className).toContain('bg-sanctuary-300');
    expect(toggleButton.querySelector('span')?.className).toContain('translate-x-1');

    fireEvent.click(toggleButton);
    expect(onToggleDarkMode).toHaveBeenCalledTimes(1);

    rerender(
      <VisualSettingsPanel
        isDark={true}
        contrastLevel={0}
        patternOpacity={50}
        onToggleDarkMode={onToggleDarkMode}
        onContrastChange={vi.fn()}
        onPatternOpacityChange={vi.fn()}
      />,
    );

    const darkToggleButton = screen.getByRole('switch');
    expect(darkToggleButton.className).toContain('bg-primary-600');
    expect(darkToggleButton.querySelector('span')?.className).toContain('translate-x-6');
  });

  it('covers all contrast label branches and slider callback', () => {
    const { onContrastChange, rerender } = renderPanel({ contrastLevel: -2 });

    expect(screen.getByText('Much lighter')).toBeInTheDocument();

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={-1}
        patternOpacity={50}
        onToggleDarkMode={vi.fn()}
        onContrastChange={onContrastChange}
        onPatternOpacityChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Lighter')).toBeInTheDocument();

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={1}
        patternOpacity={50}
        onToggleDarkMode={vi.fn()}
        onContrastChange={onContrastChange}
        onPatternOpacityChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Darker')).toBeInTheDocument();

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={2}
        patternOpacity={50}
        onToggleDarkMode={vi.fn()}
        onContrastChange={onContrastChange}
        onPatternOpacityChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Much darker')).toBeInTheDocument();

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={9}
        patternOpacity={50}
        onToggleDarkMode={vi.fn()}
        onContrastChange={onContrastChange}
        onPatternOpacityChange={vi.fn()}
      />,
    );

    // fallback branch
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);

    const contrastSlider = screen.getAllByRole('slider')[0];
    fireEvent.change(contrastSlider, { target: { value: '-2' } });
    expect(onContrastChange).toHaveBeenCalledWith(-2);
  });

  it('covers pattern visibility label branches and slider callback', () => {
    const { onPatternOpacityChange, rerender } = renderPanel({ patternOpacity: 0 });

    expect(screen.getByText('Hidden')).toBeInTheDocument();

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={0}
        patternOpacity={50}
        onToggleDarkMode={vi.fn()}
        onContrastChange={vi.fn()}
        onPatternOpacityChange={onPatternOpacityChange}
      />,
    );

    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);

    rerender(
      <VisualSettingsPanel
        isDark={false}
        contrastLevel={0}
        patternOpacity={65}
        onToggleDarkMode={vi.fn()}
        onContrastChange={vi.fn()}
        onPatternOpacityChange={onPatternOpacityChange}
      />,
    );

    expect(screen.getByText('65%')).toBeInTheDocument();

    const patternSlider = screen.getAllByRole('slider')[1];
    fireEvent.change(patternSlider, { target: { value: '35' } });
    expect(onPatternOpacityChange).toHaveBeenCalledWith(35);
  });
});
