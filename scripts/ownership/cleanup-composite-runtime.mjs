import { HOST_RESOURCE_CLASSES } from './cleanup-host-runtime.mjs';

const HOST_CLASSES = new Set(HOST_RESOURCE_CLASSES);

function dispatcher(dockerRuntime, hostRuntime, name) {
  if (typeof dockerRuntime?.[name] !== 'function' || typeof hostRuntime?.[name] !== 'function') {
    throw new TypeError(`both cleanup runtimes require ${name}`);
  }
  return (request) => (HOST_CLASSES.has(request?.action?.resourceClass)
    ? hostRuntime[name](request) : dockerRuntime[name](request));
}

/** Dispatch approved actions without creating a second execution or receipt path. */
export function createCleanupCompositeRuntime({ dockerRuntime, hostRuntime }) {
  return Object.freeze({
    reloadAuthority: dispatcher(dockerRuntime, hostRuntime, 'reloadAuthority'),
    mutate: dispatcher(dockerRuntime, hostRuntime, 'mutate'),
    reconcile: dispatcher(dockerRuntime, hostRuntime, 'reconcile'),
  });
}
