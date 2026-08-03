/**
 * AnimatedQRCode Component
 *
 * Displays an animated sequence of QR codes for large PSBTs
 * using UR (Uniform Resources) fountain codes.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { encodePsbtToUrFrames } from '../../utils/urPsbt';
import { createLogger } from '../../utils/logger';

const log = createLogger('AnimatedQRCode');

interface AnimatedQRCodeProps {
  /** Base64-encoded PSBT data */
  psbtBase64: string;
  /** QR code size in pixels (default: 280) */
  size?: number;
  /** Frame interval in milliseconds (default: 250) */
  frameInterval?: number;
  /** Maximum fragment length for UR encoding (default: 100) */
  maxFragmentLength?: number;
  /** Show frame counter (default: true) */
  showCounter?: boolean;
}

export const AnimatedQRCode: React.FC<AnimatedQRCodeProps> = ({
  psbtBase64,
  size = 280,
  frameInterval = 250,
  maxFragmentLength = 100,
  showCounter = true,
}) => {
  const [currentFrame, setCurrentFrame] = useState(0);

  // Generate UR frames from PSBT
  const frames = useMemo(() => {
    try {
      return encodePsbtToUrFrames(psbtBase64, maxFragmentLength);
    } catch (error) {
      log.error('Failed to encode PSBT', { error });
      return [];
    }
  }, [psbtBase64, maxFragmentLength]);

  // Animate through frames
  useEffect(() => {
    if (frames.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % frames.length);
    }, frameInterval);

    return () => clearInterval(interval);
  }, [frames.length, frameInterval]);

  // Reset frame when PSBT changes
  useEffect(() => {
    setCurrentFrame(0);
  }, [psbtBase64]);

  if (frames.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg"
        style={{ width: size, height: size }}
      >
        <span className="text-sanctuary-500 text-sm">Failed to encode PSBT</span>
      </div>
    );
  }

  const currentData = frames[currentFrame];

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-3 rounded-lg shadow-inner">
        <QRCodeSVG
          value={currentData}
          size={size}
          level="L"
          marginSize={2}
        />
      </div>
      {showCounter && frames.length > 1 && (
        <div className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
          Frame {currentFrame + 1} / {frames.length}
        </div>
      )}
    </div>
  );
};

export default AnimatedQRCode;
