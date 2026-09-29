import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../../../src/api/admin';
import { useLayoutChromeState } from '../../../src/components/Layout/useLayoutChromeState';

vi.mock('../../../src/hooks/useAppShortcuts', () => ({ useAppShortcuts: vi.fn() }));
vi.mock('../../../src/api/admin', () => ({ checkVersion: vi.fn() }));
vi.mock('../../../src/utils/errorHandler', () => ({ logError: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

afterEach(() => vi.clearAllMocks());

describe('useLayoutChromeState modal handoff', () => {
  it('returns version modal focus to the mobile trigger and closes the drawer', async () => {
    vi.mocked(adminApi.checkVersion).mockResolvedValue({ currentVersion: '1.0.0' } as any);
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { result } = renderHook(() => useLayoutChromeState({ capabilities: {}, user: { id: 'user' } }));
    result.current.mobileMenuTriggerRef.current = trigger;
    act(() => result.current.setIsMobileMenuOpen(true));

    const menuButton = document.createElement('button');
    const panel = document.createElement('div');
    panel.dataset.testid = 'mobile-sidebar-panel';
    panel.append(menuButton);
    const event = { currentTarget: menuButton } as React.MouseEvent<HTMLButtonElement>;
    await act(async () => { await result.current.handleVersionClick(event); });

    expect(result.current.showVersionModal).toBe(true);
    expect(result.current.isMobileMenuOpen).toBe(false);
    expect(result.current.modalReturnFocusRef.current).toBe(trigger);
    expect(adminApi.checkVersion).toHaveBeenCalledOnce();
    trigger.remove();
  });

  it('uses the explicit desktop opener and supports cached version info', async () => {
    vi.mocked(adminApi.checkVersion).mockResolvedValue({ currentVersion: '1.0.0' } as any);
    const { result } = renderHook(() => useLayoutChromeState({ capabilities: {}, user: { id: 'user' } }));
    const opener = document.createElement('button');
    document.body.append(opener);
    await act(async () => { await result.current.handleVersionClick({ currentTarget: opener } as React.MouseEvent<HTMLButtonElement>); });
    expect(result.current.modalReturnFocusRef.current).toBe(opener);
    expect(adminApi.checkVersion).toHaveBeenCalledOnce();

    await act(async () => { await result.current.handleVersionClick({ currentTarget: opener } as React.MouseEvent<HTMLButtonElement>); });
    expect(adminApi.checkVersion).toHaveBeenCalledOnce();
    opener.remove();
  });

  it('falls back to the active element when version info opens without an event target', async () => {
    vi.mocked(adminApi.checkVersion).mockResolvedValue({ currentVersion: '1.0.0' } as any);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useLayoutChromeState({ capabilities: {}, user: { id: 'user' } }));
    await act(async () => { await result.current.handleVersionClick(); });

    expect(result.current.modalReturnFocusRef.current).toBe(opener);
    opener.remove();
  });

  it('leaves modal return focus empty when the active element is not an HTML element', async () => {
    vi.mocked(adminApi.checkVersion).mockResolvedValue({ currentVersion: '1.0.0' } as any);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const activeElement = vi.spyOn(document, 'activeElement', 'get')
      .mockReturnValue(svg as unknown as HTMLElement);
    const { result } = renderHook(() => useLayoutChromeState({ capabilities: {}, user: { id: 'user' } }));
    await act(async () => { await result.current.handleVersionClick(); });

    expect(result.current.modalReturnFocusRef.current).toBeNull();
    activeElement.mockRestore();
  });

  it('returns shortcut focus to the mobile trigger when opened from a menu without an event', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const { result } = renderHook(() => useLayoutChromeState({ capabilities: {}, user: { id: 'user' } }));
    result.current.mobileMenuTriggerRef.current = trigger;
    act(() => result.current.setIsMobileMenuOpen(true));
    act(() => result.current.openKeyboardShortcuts());

    expect(result.current.showKeyboardShortcutsModal).toBe(true);
    expect(result.current.isMobileMenuOpen).toBe(false);
    expect(result.current.modalReturnFocusRef.current).toBe(trigger);
    trigger.remove();
  });

});
