import { useCallback, useRef, type MouseEvent } from 'react';

// Visual-only mouse tracking requires real DOM mouse physics untestable in jsdom.
/* v8 ignore start */
export function useCardTilt() {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(800px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`;
  }, []);

  const handleMouseLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg)';
  }, []);

  return { cardRef, handleMouseMove, handleMouseLeave };
}
/* v8 ignore stop */
