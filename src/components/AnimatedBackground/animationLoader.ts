import type React from 'react';

export type AnimationHook = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) => void;

export type AnimationModuleMap = Record<string, () => Promise<unknown>>;

export const toPascalCase = (pattern: string): string => {
  return pattern
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
};

export const toCamelCase = (pattern: string): string => {
  const pascal = toPascalCase(pattern);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

export const getAnimationModulePath = (pattern: string): string => {
  return `./animations/${toCamelCase(pattern)}.ts`;
};

export const getAnimationHookExport = (pattern: string): string => {
  return `use${toPascalCase(pattern)}`;
};

export function getAnimationHook(module: unknown, hookName: string) {
  const hookCandidate = (module as Record<string, unknown>)[hookName];
  return typeof hookCandidate === 'function' ? hookCandidate as AnimationHook : null;
}

export async function loadAnimationHook(
  pattern: string,
  animationModules: AnimationModuleMap
) {
  const modulePath = getAnimationModulePath(pattern);
  const importer = animationModules[modulePath];

  if (!importer) return null;

  const module = await importer();
  return getAnimationHook(module, getAnimationHookExport(pattern));
}
