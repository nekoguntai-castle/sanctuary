import React, { useRef, useState, useEffect } from 'react';

/**
 * Flashes green/red when a fee rate value changes.
 *
 * Renders the bare figure. The unit used to be baked in here, which printed
 * "sat/vB" once per tier — three times on a card whose every number carries the
 * same unit. The card states it once instead.
 */
export const AnimatedFeeRate: React.FC<{ value: string }> = ({ value }) => {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (prevRef.current !== value && prevRef.current !== '---' && value !== '---') {
      const prev = parseFloat(prevRef.current);
      const curr = parseFloat(value);
      if (!isNaN(prev) && !isNaN(curr) && prev !== curr) {
        setFlash(curr > prev ? 'up' : 'down');
        const timer = setTimeout(() => setFlash(null), 600);
        return () => clearTimeout(timer);
      }
    }
    prevRef.current = value;
  }, [value]);

  return (
    <span className={`number-transition ${flash === 'up' ? 'number-transition-up' : flash === 'down' ? 'number-transition-down' : ''}`}>
      {value}
    </span>
  );
};
