/**
 * NotificationBadge Component Tests
 *
 * Tests for the notification badge and dot components.
 */

import { render,screen } from '@testing-library/react';
import { describe,expect,it } from 'vitest';
import { NotificationBadge,NotificationDot } from '../../src/components/NotificationBadge';

describe('NotificationBadge', () => {
  describe('rendering', () => {
    it('should render count', () => {
      render(<NotificationBadge count={5} />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should not render when count is 0 and showZero is false', () => {
      const { container } = render(<NotificationBadge count={0} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('should render when count is 0 and showZero is true', () => {
      render(<NotificationBadge count={0} showZero={true} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('maxCount', () => {
    it('should display maxCount+ when count exceeds maxCount', () => {
      render(<NotificationBadge count={15} maxCount={9} />);

      expect(screen.getByText('9+')).toBeInTheDocument();
    });

    it('should display exact count when equal to maxCount', () => {
      render(<NotificationBadge count={9} maxCount={9} />);

      expect(screen.getByText('9')).toBeInTheDocument();
    });

    it('should display exact count when below maxCount', () => {
      render(<NotificationBadge count={5} maxCount={9} />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should respect custom maxCount', () => {
      render(<NotificationBadge count={100} maxCount={99} />);

      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('should apply small size classes', () => {
      render(<NotificationBadge count={5} size="sm" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('h-4', 'min-w-4', 'text-[10px]');
    });

    it('should apply medium size classes', () => {
      render(<NotificationBadge count={5} size="md" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('h-5', 'min-w-5', 'text-xs');
    });

    it('should apply large size classes', () => {
      render(<NotificationBadge count={5} size="lg" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('h-6', 'min-w-6', 'text-sm');
    });

    it('should default to small size', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('h-4', 'min-w-4');
    });
  });

  describe('severity', () => {
    it('should apply info severity classes', () => {
      render(<NotificationBadge count={5} severity="info" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('bg-primary-500', 'text-white');
    });

    it('should apply warning severity classes', () => {
      render(<NotificationBadge count={5} severity="warning" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('bg-rose-400');
    });

    it('should apply critical severity classes', () => {
      render(<NotificationBadge count={5} severity="critical" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('bg-rose-600', 'text-white');
    });

    it('should default to warning severity', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('bg-rose-400');
    });
  });

  describe('pulse', () => {
    it('should apply pulse animation when pulse is true', () => {
      render(<NotificationBadge count={5} pulse={true} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('animate-pulse');
    });

    it('should not apply pulse animation when pulse is false', () => {
      render(<NotificationBadge count={5} pulse={false} />);

      const badge = screen.getByText('5');
      expect(badge).not.toHaveClass('animate-pulse');
    });

    it('should not pulse by default', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).not.toHaveClass('animate-pulse');
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      render(<NotificationBadge count={5} className="custom-class" />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('custom-class');
    });
  });

  describe('base styles', () => {
    it('should have rounded-full class', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('rounded-full');
    });

    it('should have inline-flex and alignment classes', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('inline-flex', 'items-center', 'justify-center');
    });

    it('should have font-bold class', () => {
      render(<NotificationBadge count={5} />);

      const badge = screen.getByText('5');
      expect(badge).toHaveClass('font-bold');
    });
  });
});

describe('NotificationDot', () => {
  describe('rendering', () => {
    it('should render when visible is true', () => {
      const { container } = render(<NotificationDot visible={true} />);

      expect(container.querySelector('span')).toBeInTheDocument();
    });

    it('should not render when visible is false', () => {
      const { container } = render(<NotificationDot visible={false} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('should be visible by default', () => {
      const { container } = render(<NotificationDot />);

      expect(container.querySelector('span')).toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('should apply small size classes', () => {
      const { container } = render(<NotificationDot size="sm" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('h-2', 'w-2');
    });

    it('should apply medium size classes', () => {
      const { container } = render(<NotificationDot size="md" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('h-2.5', 'w-2.5');
    });

    it('should apply large size classes', () => {
      const { container } = render(<NotificationDot size="lg" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('h-3', 'w-3');
    });

    it('should default to small size', () => {
      const { container } = render(<NotificationDot />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('h-2', 'w-2');
    });
  });

  describe('severity', () => {
    it('should apply info severity classes', () => {
      const { container } = render(<NotificationDot severity="info" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('bg-primary-500');
    });

    it('should apply warning severity classes', () => {
      const { container } = render(<NotificationDot severity="warning" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('bg-rose-400');
    });

    it('should apply critical severity classes', () => {
      const { container } = render(<NotificationDot severity="critical" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('bg-rose-600');
    });

    it('should default to warning severity', () => {
      const { container } = render(<NotificationDot />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('bg-rose-400');
    });
  });

  describe('pulse', () => {
    it('should apply pulse animation when pulse is true', () => {
      const { container } = render(<NotificationDot pulse={true} />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('animate-pulse');
    });

    it('should not apply pulse animation when pulse is false', () => {
      const { container } = render(<NotificationDot pulse={false} />);

      const dot = container.querySelector('span');
      expect(dot).not.toHaveClass('animate-pulse');
    });

    it('should pulse by default', () => {
      const { container } = render(<NotificationDot />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('animate-pulse');
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      const { container } = render(<NotificationDot className="custom-class" />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('custom-class');
    });
  });

  describe('base styles', () => {
    it('should have rounded-full class', () => {
      const { container } = render(<NotificationDot />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('rounded-full');
    });

    it('should have inline-block class', () => {
      const { container } = render(<NotificationDot />);

      const dot = container.querySelector('span');
      expect(dot).toHaveClass('inline-block');
    });
  });
});
