let runtimeModulePromise: Promise<typeof import('./runtime')> | null = null;

export const loadHardwareWalletRuntime = async () => {
  runtimeModulePromise ??= import('./runtime');
  return runtimeModulePromise;
};
