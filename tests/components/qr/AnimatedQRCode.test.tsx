/**
 * Tests for src/components/qr/AnimatedQRCode.tsx
 *
 * Tests the animated QR code component for displaying PSBT data
 * using UR fountain codes.
 */

import { act,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { AnimatedQRCode } from '../../../src/components/qr/AnimatedQRCode';
import * as urPsbt from '../../../src/utils/urPsbt';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the urPsbt module
vi.mock('../../../src/utils/urPsbt', () => ({
  encodePsbtToUrFrames: vi.fn(),
}));

// Mock QRCodeSVG
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size}>
      <title>QR Code</title>
    </svg>
  ),
}));

describe('AnimatedQRCode', () => {
  const mockPsbtBase64 = 'cHNidP8BAHUCAAAAAZw...'; // Truncated for brevity
  const mockFrames = [
    'ur:crypto-psbt/1-3/lpadaxcfax',
    'ur:crypto-psbt/2-3/lpadaxcfax',
    'ur:crypto-psbt/3-3/lpadaxcfax',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue(mockFrames);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders QR code with first frame', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toBeInTheDocument();
      expect(qrCode).toHaveAttribute('data-value', mockFrames[0]);
    });

    it('renders with default size of 280', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('width', '280');
      expect(qrCode).toHaveAttribute('height', '280');
    });

    it('renders with custom size', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} size={400} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('width', '400');
    });

    it('shows frame counter by default', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      expect(screen.getByText('Frame 1 / 3')).toBeInTheDocument();
    });

    it('hides frame counter when showCounter is false', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} showCounter={false} />);

      expect(screen.queryByText(/Frame/)).not.toBeInTheDocument();
    });

    it('does not show frame counter for single-frame QR', () => {
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue(['ur:crypto-psbt/single']);
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      expect(screen.queryByText(/Frame/)).not.toBeInTheDocument();
    });
  });

  describe('encoding', () => {
    it('calls encodePsbtToUrFrames with correct parameters', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} maxFragmentLength={150} />);

      expect(urPsbt.encodePsbtToUrFrames).toHaveBeenCalledWith(mockPsbtBase64, 150);
    });

    it('uses default maxFragmentLength of 100', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      expect(urPsbt.encodePsbtToUrFrames).toHaveBeenCalledWith(mockPsbtBase64, 100);
    });
  });

  describe('animation', () => {
    it('cycles through frames at specified interval', () => {
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} frameInterval={250} />);

      // Initial frame
      expect(screen.getByText('Frame 1 / 3')).toBeInTheDocument();
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', mockFrames[0]);

      // After first interval
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Frame 2 / 3')).toBeInTheDocument();
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', mockFrames[1]);

      // After second interval
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Frame 3 / 3')).toBeInTheDocument();
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', mockFrames[2]);

      // Wraps back to first frame
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Frame 1 / 3')).toBeInTheDocument();
    });

    it('does not animate for single-frame QR', () => {
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue(['ur:crypto-psbt/single']);
      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      const qrCode = screen.getByTestId('qr-code');
      expect(qrCode).toHaveAttribute('data-value', 'ur:crypto-psbt/single');

      // Advance time - should still be the same
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(qrCode).toHaveAttribute('data-value', 'ur:crypto-psbt/single');
    });

    it('resets to first frame when PSBT changes', () => {
      const { rerender } = render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      // Advance to frame 2
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Frame 2 / 3')).toBeInTheDocument();

      // Change PSBT
      const newFrames = ['new-1', 'new-2'];
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue(newFrames);
      rerender(<AnimatedQRCode psbtBase64="newPsbtBase64" />);

      // Should reset to frame 1
      expect(screen.getByText('Frame 1 / 2')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error message when encoding fails', () => {
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockImplementation(() => {
        throw new Error('Encoding failed');
      });

      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      expect(screen.getByText('Failed to encode PSBT')).toBeInTheDocument();
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    });

    it('shows error message when frames array is empty', () => {
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue([]);

      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      expect(screen.getByText('Failed to encode PSBT')).toBeInTheDocument();
    });

    it('applies size to error container', () => {
      vi.mocked(urPsbt.encodePsbtToUrFrames).mockReturnValue([]);

      render(<AnimatedQRCode psbtBase64={mockPsbtBase64} size={320} />);

      const errorContainer = screen.getByText('Failed to encode PSBT').closest('div');
      expect(errorContainer).toHaveStyle({ width: '320px', height: '320px' });
    });
  });

  describe('cleanup', () => {
    it('clears interval on unmount', () => {
      const { unmount } = render(<AnimatedQRCode psbtBase64={mockPsbtBase64} />);

      // Verify animation is running
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByText('Frame 2 / 3')).toBeInTheDocument();

      unmount();

      // Should not throw or cause issues after unmount
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    });
  });
});
