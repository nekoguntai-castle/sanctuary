import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalWrapper } from '../../../components/ui/ModalWrapper';

describe('ModalWrapper', () => {
  it('renders title and children', () => {
    render(
      <ModalWrapper title="Test Modal" onClose={vi.fn()}>
        <p>Modal content</p>
      </ModalWrapper>
    );
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper title="Close Test" onClose={onClose}>
        <p>Content</p>
      </ModalWrapper>
    );
    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalWrapper title="Backdrop Test" onClose={onClose}>
        <p>Content</p>
      </ModalWrapper>
    );
    // Click the backdrop (outermost fixed div)
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when modal content clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalWrapper title="Propagation Test" onClose={onClose}>
        <p>Content</p>
      </ModalWrapper>
    );
    fireEvent.click(screen.getByText('Content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('applies maxWidth class', () => {
    const { container } = render(
      <ModalWrapper title="Width Test" onClose={vi.fn()} maxWidth="lg">
        <p>Content</p>
      </ModalWrapper>
    );
    const modal = container.querySelector('.max-w-lg');
    expect(modal).toBeInTheDocument();
  });

  it('applies default maxWidth of md', () => {
    const { container } = render(
      <ModalWrapper title="Default Width" onClose={vi.fn()}>
        <p>Content</p>
      </ModalWrapper>
    );
    const modal = container.querySelector('.max-w-md');
    expect(modal).toBeInTheDocument();
  });

  it('applies headerBorder when set', () => {
    const { container } = render(
      <ModalWrapper title="Border Test" onClose={vi.fn()} headerBorder>
        <p>Content</p>
      </ModalWrapper>
    );
    const header = container.querySelector('.border-b');
    expect(header).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ModalWrapper title="Class Test" onClose={vi.fn()} className="custom-class">
        <p>Content</p>
      </ModalWrapper>
    );
    const modal = container.querySelector('.custom-class');
    expect(modal).toBeInTheDocument();
  });

  it('uses default animate-modal-enter animation', () => {
    const { container } = render(
      <ModalWrapper title="Animation Test" onClose={vi.fn()}>
        <p>Content</p>
      </ModalWrapper>
    );
    const modal = container.querySelector('.animate-modal-enter');
    expect(modal).toBeInTheDocument();
  });

  it('applies custom animation class', () => {
    const { container } = render(
      <ModalWrapper title="Custom Anim" onClose={vi.fn()} animation="animate-fade-in">
        <p>Content</p>
      </ModalWrapper>
    );
    expect(container.querySelector('.animate-fade-in')).toBeInTheDocument();
    expect(container.querySelector('.animate-modal-enter')).not.toBeInTheDocument();
  });
});
