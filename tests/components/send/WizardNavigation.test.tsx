/**
 * Tests for WizardNavigation component
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WizardNavigation } from '../../../components/send/WizardNavigation';
import * as SendContext from '../../../contexts/send';

// Mock the context
vi.mock('../../../contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

// Mock Button component
vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, isLoading, variant, className }: any) => (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      data-variant={variant}
      data-loading={isLoading}
      className={className}
    >
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

describe('WizardNavigation', () => {
  const mockNextStep = vi.fn();
  const mockPrevStep = vi.fn();
  const mockGoToStep = vi.fn();
  const mockCanJumpTo = vi.fn();
  const mockIsStepComplete = vi.fn();

  const defaultContext = {
    currentStep: 'type' as const,
    canGoNext: true,
    canGoBack: false,
    canJumpTo: mockCanJumpTo,
    goToStep: mockGoToStep,
    nextStep: mockNextStep,
    prevStep: mockPrevStep,
    isStepComplete: mockIsStepComplete,
    state: {
      completedSteps: new Set(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanJumpTo.mockReturnValue(false);
    mockIsStepComplete.mockReturnValue(false);
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(defaultContext as any);
  });

  describe('Step indicators', () => {
    it('renders all wizard steps', () => {
      render(<WizardNavigation />);

      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Compose')).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeInTheDocument();
    });

    it('renders step numbers', () => {
      render(<WizardNavigation />);

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('highlights current step', () => {
      render(<WizardNavigation />);

      // Current step (Type) should have primary styling
      const typeStep = screen.getByText('1').closest('button');
      expect(typeStep?.querySelector('.bg-primary-500')).toBeInTheDocument();
    });

    it('shows checkmark for completed steps', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        state: { completedSteps: new Set(['type']) },
      } as any);

      render(<WizardNavigation />);

      // Should show check icon instead of number for completed step
      const typeStepArea = screen.getByText('Type').closest('button');
      const checkIcon = typeStepArea?.querySelector('svg');
      expect(checkIcon).toBeInTheDocument();
    });
  });

  describe('Navigation buttons', () => {
    it('renders Back and Continue buttons', () => {
      render(<WizardNavigation />);

      expect(screen.getByText('Back')).toBeInTheDocument();
      expect(screen.getByText('Continue')).toBeInTheDocument();
    });

    it('hides Back button on first step', () => {
      render(<WizardNavigation />);

      const backButton = screen.getByText('Back').closest('button');
      expect(backButton).toHaveClass('invisible');
    });

    it('shows Back button on later steps', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        canGoBack: true,
      } as any);

      render(<WizardNavigation />);

      const backButton = screen.getByText('Back').closest('button');
      expect(backButton).not.toHaveClass('invisible');
    });

    it('calls prevStep when clicking Back', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        canGoBack: true,
      } as any);

      render(<WizardNavigation />);

      await user.click(screen.getByText('Back'));

      expect(mockPrevStep).toHaveBeenCalled();
    });

    it('calls nextStep when clicking Continue', async () => {
      const user = userEvent.setup();
      render(<WizardNavigation />);

      await user.click(screen.getByText('Continue'));

      expect(mockNextStep).toHaveBeenCalled();
    });

    it('disables Continue when canGoNext is false', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        canGoNext: false,
      } as any);

      render(<WizardNavigation />);

      const continueButton = screen.getByText('Continue').closest('button');
      expect(continueButton).toBeDisabled();
    });

    it('hides Continue button on last step', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'review',
        canGoBack: true,
      } as any);

      render(<WizardNavigation />);

      expect(screen.queryByText('Continue')).not.toBeInTheDocument();
    });
  });

  describe('Custom button behavior', () => {
    it('uses custom nextButtonText', () => {
      render(<WizardNavigation nextButtonText="Sign & Broadcast" />);

      expect(screen.getByText('Sign & Broadcast')).toBeInTheDocument();
    });

    it('calls onNextClick instead of nextStep when provided', async () => {
      const user = userEvent.setup();
      const onNextClick = vi.fn();
      render(<WizardNavigation onNextClick={onNextClick} />);

      await user.click(screen.getByText('Continue'));

      expect(onNextClick).toHaveBeenCalled();
      expect(mockNextStep).not.toHaveBeenCalled();
    });

    it('shows loading state when nextLoading is true', () => {
      render(<WizardNavigation nextLoading={true} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('disables next when nextDisabled is true', () => {
      render(<WizardNavigation nextDisabled={true} />);

      const continueButton = screen.getByText('Continue').closest('button');
      expect(continueButton).toBeDisabled();
    });
  });

  describe('Hide buttons option', () => {
    it('hides navigation buttons when hideButtons is true', () => {
      render(<WizardNavigation hideButtons={true} />);

      expect(screen.queryByText('Back')).not.toBeInTheDocument();
      expect(screen.queryByText('Continue')).not.toBeInTheDocument();
    });

    it('still shows step indicators when hideButtons is true', () => {
      render(<WizardNavigation hideButtons={true} />);

      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Compose')).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeInTheDocument();
    });
  });

  describe('Step jumping', () => {
    it('calls goToStep when clicking completed step', async () => {
      const user = userEvent.setup();
      mockCanJumpTo.mockReturnValue(true);
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        canJumpTo: mockCanJumpTo,
        state: { completedSteps: new Set(['type']) },
      } as any);

      render(<WizardNavigation />);

      // Click on Type step
      await user.click(screen.getByText('Type').closest('button')!);

      expect(mockGoToStep).toHaveBeenCalledWith('type');
    });

    it('does not call goToStep when clicking non-jumpable step', async () => {
      const user = userEvent.setup();
      mockCanJumpTo.mockReturnValue(false);

      render(<WizardNavigation />);

      // Click on Review step (not yet reachable)
      await user.click(screen.getByText('Review').closest('button')!);

      expect(mockGoToStep).not.toHaveBeenCalled();
    });
  });

  describe('Connector lines', () => {
    it('renders connector lines between steps', () => {
      const { container } = render(<WizardNavigation />);

      // Should have 2 connector lines (between 3 steps)
      const connectors = container.querySelectorAll('.h-0\\.5');
      expect(connectors.length).toBe(2);
    });

    it('highlights completed connectors', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        state: { completedSteps: new Set(['type']) },
      } as any);

      const { container } = render(<WizardNavigation />);

      const primaryConnectors = container.querySelectorAll('.bg-primary-500');
      expect(primaryConnectors.length).toBeGreaterThan(0);
    });
  });

  describe('Touch and keyboard accessibility (#50)', () => {
    it('marks the current step with aria-current and gives non-clickable steps no edit label', () => {
      render(<WizardNavigation />);

      const currentStep = screen.getByText('Type').closest('button')!;
      expect(currentStep).toHaveAttribute('aria-current', 'step');
      expect(currentStep).not.toHaveAttribute('aria-label');

      const upcomingStep = screen.getByText('Compose').closest('button')!;
      expect(upcomingStep).not.toHaveAttribute('aria-current');
      expect(upcomingStep).not.toHaveAttribute('aria-label');
    });

    it('labels clickable steps for editing, reveals the hint on focus/touch, and hides the decorative check', () => {
      mockCanJumpTo.mockReturnValue(true);
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        currentStep: 'outputs',
        canJumpTo: mockCanJumpTo,
        state: { completedSteps: new Set(['type']) },
      } as any);

      render(<WizardNavigation />);

      // Completed + clickable step gets an "Edit step" accessible name; its
      // check icon is decorative (the step is already identified by the name).
      const typeStep = screen.getByRole('button', { name: 'Edit step 1: Type' });
      expect(typeStep).not.toHaveAttribute('aria-current');
      expect(typeStep.querySelector('[aria-hidden="true"]')).not.toBeNull();

      // Upcoming-but-clickable step also gets an edit label.
      expect(
        screen.getByRole('button', { name: 'Edit step 3: Review' })
      ).toBeInTheDocument();

      // The current step stays current and is NOT given an edit label even
      // though it is jumpable.
      const currentStep = screen.getByText('Compose').closest('button')!;
      expect(currentStep).toHaveAttribute('aria-current', 'step');
      expect(currentStep).not.toHaveAttribute('aria-label');

      // The "Click to edit" hint reveals on keyboard focus and on touch.
      const hint = screen.getAllByText('Click to edit')[0].closest('div')!;
      expect(hint).toHaveClass('group-focus-within:opacity-100');
      expect(hint).toHaveClass('[@media(hover:none)]:opacity-100');
    });
  });
});
