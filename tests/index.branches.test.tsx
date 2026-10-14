import { beforeEach,describe,expect,it,vi } from 'vitest';

describe('index bootstrap branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('initializes themes and mounts app when root element exists', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    const initializeThemes = vi.fn();
    const render = vi.fn();
    const createRoot = vi.fn(() => ({ render }));

    vi.doMock('../src/themes', () => ({
      initializeThemes,
    }));
    vi.doMock('../src/App', () => ({
      default: () => <div>Mock App</div>,
    }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot },
      createRoot,
    }));

    await import('../src/main');

    expect(initializeThemes).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('rewrites a legacy path-based verification link to the hash route before mounting', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, '', '/verify-email?token=abc%20123');

    vi.doMock('../src/themes', () => ({ initializeThemes: vi.fn() }));
    vi.doMock('../src/App', () => ({ default: () => <div>Mock App</div> }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot: () => ({ render: vi.fn() }) },
      createRoot: () => ({ render: vi.fn() }),
    }));

    try {
      await import('../src/main');

      expect(window.location.pathname).toBe('/');
      expect(window.location.hash).toBe('#/verify-email?token=abc%20123');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('leaves other paths untouched', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, '', '/somewhere?x=1');

    vi.doMock('../src/themes', () => ({ initializeThemes: vi.fn() }));
    vi.doMock('../src/App', () => ({ default: () => <div>Mock App</div> }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot: () => ({ render: vi.fn() }) },
      createRoot: () => ({ render: vi.fn() }),
    }));

    try {
      await import('../src/main');

      expect(window.location.pathname).toBe('/somewhere');
      expect(window.location.hash).toBe('');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('throws clear error when root element is missing', async () => {
    const initializeThemes = vi.fn();
    const createRoot = vi.fn();

    vi.doMock('../src/themes', () => ({
      initializeThemes,
    }));
    vi.doMock('../src/App', () => ({
      default: () => <div>Mock App</div>,
    }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot },
      createRoot,
    }));

    let thrown: unknown;
    try {
      await import('../src/main');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not find root element to mount to');

    expect(initializeThemes).toHaveBeenCalledTimes(1);
    expect(createRoot).not.toHaveBeenCalled();
  });
});
