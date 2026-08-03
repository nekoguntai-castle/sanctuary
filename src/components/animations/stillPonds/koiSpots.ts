import type { KoiFish, Spot } from './pondTypes';

const getBodyHalfWidthAtX = (x: number, size: number): number => {
  const xNorm = x / size;

  if (xNorm > 0.4) return size * 0.08;
  if (xNorm > 0.25) {
    const t = (xNorm - 0.25) / 0.15;
    return size * (0.16 - t * 0.06);
  }
  if (xNorm > 0.0) {
    const t = xNorm / 0.25;
    return size * (0.14 + t * 0.02);
  }
  if (xNorm > -0.2) {
    const t = (xNorm - (-0.2)) / 0.2;
    return size * (0.11 + t * 0.03);
  }
  if (xNorm > -0.35) {
    const t = (xNorm - (-0.35)) / 0.15;
    return size * (0.06 + t * 0.05);
  }
  return size * 0.04;
};

export const generateKoiSpots = (
  size: number,
  pattern: KoiFish['pattern'],
): Spot[] => {
  if (pattern === 'solid') return [];

  const spots: Spot[] = [];
  const count = pattern === 'calico' ? 5 : 3;

  for (let i = 0; i < count; i++) {
    const spotX = size * 0.2 - Math.random() * size * 0.5;
    const spotSize = size * 0.05 + Math.random() * size * 0.04;
    const bodyHalfWidth = getBodyHalfWidthAtX(spotX, size);
    const maxYOffset = Math.max(0, bodyHalfWidth - spotSize - size * 0.01);

    spots.push({
      x: spotX,
      y: (Math.random() - 0.5) * 2 * maxYOffset,
      size: spotSize,
    });
  }

  return spots;
};
