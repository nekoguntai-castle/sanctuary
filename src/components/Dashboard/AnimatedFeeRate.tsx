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
    // Advance the comparison point before anything can return. The flash branch
    // used to `return` its cleanup first, so the moment a rate moved once, this
    // ref stopped tracking and every later direction was measured against the
    // rate the card first mounted with — a fall after a rise flashed green.
    const previous = prevRef.current;
    prevRef.current = value;

    const previousRate = Number.parseFloat(previous);
    const nextRate = Number.parseFloat(value);
    const isMove = Number.isFinite(previousRate) && Number.isFinite(nextRate) && previousRate !== nextRate;

    if (!isMove) {
      // Not a move, so nothing schedules a clear — and React has already run
      // the previous cleanup, cancelling any clear still in flight. Without
      // this an interrupted flash (a rate going back to `---` mid-fade) would
      // keep its colour indefinitely.
      setFlash(null);
      return;
    }

    setFlash(nextRate > previousRate ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={`number-transition ${flash === 'up' ? 'number-transition-up' : flash === 'down' ? 'number-transition-down' : ''}`}>
      {value}
    </span>
  );
};
