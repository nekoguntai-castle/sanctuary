import type { Plugin, UserConfig } from 'vite';
import { nodePolyfills, type PolyfillOptions } from 'vite-plugin-node-polyfills';

const withoutDeprecatedEsbuildConfig = (config: UserConfig | null | undefined): UserConfig | null | undefined => {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const nextConfig = { ...config };
  delete nextConfig.esbuild;
  return nextConfig;
};

function withoutDeprecatedEsbuild(plugin: Plugin): Plugin {
  const originalConfig = plugin.config;

  if (typeof originalConfig !== 'function') {
    return plugin;
  }

  return {
    ...plugin,
    name: `${plugin.name}:without-deprecated-esbuild`,
    config(config, env) {
      const result = originalConfig.call(this, config, env);

      if (result && typeof (result as Promise<UserConfig>).then === 'function') {
        return (result as Promise<UserConfig>).then(withoutDeprecatedEsbuildConfig);
      }

      return withoutDeprecatedEsbuildConfig(result as UserConfig | null | undefined);
    },
  };
}

export function nodePolyfillsWithoutDeprecatedEsbuild(options: PolyfillOptions): Plugin[] {
  return nodePolyfills(options).map(withoutDeprecatedEsbuild);
}
