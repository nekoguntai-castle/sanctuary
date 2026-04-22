import type { NextFunction, Request, Response } from 'express';

function getUrlSuffixIndex(url: string): number {
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex === -1) return hashIndex;
  if (hashIndex === -1) return queryIndex;
  return Math.min(queryIndex, hashIndex);
}

function stripTrailingSlashesBeforeSuffix(url: string): string {
  const suffixIndex = getUrlSuffixIndex(url);
  const path = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : url.slice(suffixIndex);

  let pathEnd = path.length;
  while (pathEnd > 1 && path[pathEnd - 1] === '/') {
    pathEnd--;
  }

  return `${path.slice(0, pathEnd)}${suffix}`;
}

export function normalizeTrailingSlash(req: Request, _res: Response, next: NextFunction): void {
  if (req.path !== '/' && req.path.endsWith('/')) {
    req.url = stripTrailingSlashesBeforeSuffix(req.url);
  }
  next();
}
