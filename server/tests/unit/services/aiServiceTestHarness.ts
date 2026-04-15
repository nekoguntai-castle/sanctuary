import { vi } from 'vitest';

export function setting(key: string, value: unknown) {
  return { key, value: JSON.stringify(value) };
}

export function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

export function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}
