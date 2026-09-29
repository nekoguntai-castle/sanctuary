import { expect, type Locator } from '@playwright/test';

export type TextReading = {
  name: string;
  owner: string;
  ratio: number | null;
  color: string;
  background: string | null;
  unresolvedReason: string | null;
};

export async function readText(locator: Locator, name: string, owner: string): Promise<TextReading> {
  return locator.evaluate((element, input) => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA | null => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const channels = match[1].split(/[,/ ]+/).filter(Boolean).map(Number);
      if (channels.length < 3 || channels.slice(0, 3).some(channel => !Number.isFinite(channel))) return null;
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const blend = (front: RGBA, back: RGBA): RGBA => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map(index =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha,
      ).concat(alpha) as RGBA;
    };
    const linear = (value: number) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: RGBA) => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
    const layers: RGBA[] = [];
    let unknownReason: string | null = null;
    let current: Element | null = element;
    while (current) {
      const style = getComputedStyle(current);
      const background = parse(style.backgroundColor);
      if (style.backgroundImage !== 'none') unknownReason ??= `background image ${style.backgroundImage}`;
      if (!background) unknownReason ??= `unparsed background ${style.backgroundColor}`;
      else layers.push(background);
      if (current !== element && Number(style.opacity) !== 1) unknownReason ??= `ancestor opacity ${style.opacity} at ${current.tagName.toLowerCase()}.${typeof current.className === 'string' ? current.className.trim().replace(/\s+/g, '.') : ''}`;
      if (background?.[3] === 1) break;
      current = current.parentElement;
    }
    if (layers.at(-1)?.[3] !== 1) unknownReason ??= 'no opaque solid ancestor';
    const background = layers.reverse().reduce((back, front) => blend(front, back), [0, 0, 0, 1] as RGBA);
    const style = getComputedStyle(element);
    const foreground = parse(style.color);
    if (!foreground) unknownReason ??= `unparsed foreground ${style.color}`;
    if (foreground && Number(style.opacity) !== 1 && parse(style.backgroundColor)?.[3] !== 0) unknownReason ??= `target opacity with painted background ${style.opacity}`;
    if (foreground) foreground[3] *= Number(style.opacity);
    const effectiveForeground = foreground ? blend(foreground, background) : null;
    const ratio = effectiveForeground && !unknownReason
      ? (Math.max(luminance(effectiveForeground), luminance(background)) + 0.05) /
        (Math.min(luminance(effectiveForeground), luminance(background)) + 0.05)
      : null;
    return {
      name: input.name,
      owner: input.owner,
      ratio: ratio === null ? null : Number(ratio.toFixed(3)),
      color: style.color,
      background: background ? `rgba(${background.slice(0, 3).map(Math.round).join(', ')}, ${background[3]})` : null,
      unresolvedReason: unknownReason,
    };
  }, { name, owner });
}

export async function addReading(readings: TextReading[], locator: Locator, name: string, owner: string) {
  await expect(locator).toBeVisible();
  // The destination route can mount its animated content after the navigation
  // settle. Wait for finite entrance/transition animations on the target and
  // its ancestors before rejecting non-unit ancestor opacity.
  await locator.evaluate(async element => {
    const animations: Animation[] = [];
    let current: Element | null = element;
    while (current) {
      animations.push(...current.getAnimations().filter(animation => {
        const iterations = animation.effect?.getComputedTiming().iterations;
        return animation.playState !== 'finished' && iterations !== Infinity;
      }));
      current = current.parentElement;
    }
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  readings.push(await readText(locator, name, owner));
}

export function checkReadings(readings: TextReading[], semanticFailures: string[]) {
  const failures = readings.filter(reading => reading.ratio === null || reading.ratio < 4.5);
  expect({ readabilityFailures: failures, semanticFailures }).toEqual({ readabilityFailures: [], semanticFailures: [] });
}
