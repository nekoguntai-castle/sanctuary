import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedOptionsPanel } from '../../../components/send/steps/OutputsStep/AdvancedOptionsPanel';

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  Settings2: () => <span data-testid="settings-icon" />,
}));

vi.mock('../../../components/send/AdvancedOptions', () => ({
  AdvancedOptions: (props: {
    setShowAdvanced: (show: boolean) => void;
    enableRBF: boolean;
    subtractFeesFromAmount: boolean;
    enableDecoyOutputs: boolean;
    decoyCount: number;
    hideHeader: boolean;
  }) => (
    <div
      data-testid="advanced-options"
      data-rbf={String(props.enableRBF)}
      data-subtract={String(props.subtractFeesFromAmount)}
      data-decoys={String(props.enableDecoyOutputs)}
      data-count={String(props.decoyCount)}
      data-hide-header={String(props.hideHeader)}
    >
      <button
        type="button"
        data-testid="invoke-set-show-advanced"
        onClick={() => props.setShowAdvanced(false)}
      >
        invoke setShowAdvanced
      </button>
    </div>
  ),
}));

const defaultProps = {
  expanded: false,
  rbfEnabled: false,
  useDecoys: false,
  subtractFees: false,
  decoyCount: 2,
  onToggle: vi.fn(),
  onRbfChange: vi.fn(),
  onSubtractFeesChange: vi.fn(),
  onDecoysChange: vi.fn(),
  onDecoyCountChange: vi.fn(),
};

describe('AdvancedOptionsPanel', () => {
  it('renders collapsed state without badge when no advanced options are enabled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<AdvancedOptionsPanel {...defaultProps} onToggle={onToggle} />);

    expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.queryByTestId('advanced-options')).not.toBeInTheDocument();
    expect(screen.queryByText(/RBF|Decoys|Subtract/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /advanced options/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows combined badge labels when advanced option flags are enabled', () => {
    render(
      <AdvancedOptionsPanel
        {...defaultProps}
        rbfEnabled={true}
        useDecoys={true}
        subtractFees={true}
      />
    );

    expect(screen.getByText('RBF, Decoys, Subtract')).toBeInTheDocument();
  });

  it('renders expanded content and forwards advanced options props', async () => {
    const user = userEvent.setup();

    render(
      <AdvancedOptionsPanel
        {...defaultProps}
        expanded={true}
        rbfEnabled={true}
        useDecoys={true}
        subtractFees={true}
        decoyCount={4}
      />
    );

    expect(screen.getByTestId('chevron-up')).toBeInTheDocument();
    const advanced = screen.getByTestId('advanced-options');
    expect(advanced).toHaveAttribute('data-rbf', 'true');
    expect(advanced).toHaveAttribute('data-subtract', 'true');
    expect(advanced).toHaveAttribute('data-decoys', 'true');
    expect(advanced).toHaveAttribute('data-count', '4');
    expect(advanced).toHaveAttribute('data-hide-header', 'true');

    await user.click(screen.getByTestId('invoke-set-show-advanced'));
  });
});
