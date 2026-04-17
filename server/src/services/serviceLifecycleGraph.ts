export interface ServiceLifecycleNode {
  name: string;
  dependsOn?: readonly string[];
}

/**
 * Order lifecycle nodes so dependencies appear before their dependents.
 *
 * Throws when service names are duplicated, dependencies reference missing
 * services, or the dependency graph contains a cycle.
 */
export function orderByDependencies<T extends ServiceLifecycleNode>(services: readonly T[]): T[] {
  validateUniqueServiceNames(services);
  validateDependencies(services);

  const result: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const serviceMap = new Map(services.map(service => [service.name, service]));

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }

    const service = serviceMap.get(name);
    /* v8 ignore next -- graph construction uses service ids from the same service map */
    if (!service) {
      throw new Error(`Service dependency graph references missing service ${name}`);
    }

    visiting.add(name);

    for (const dependencyName of service.dependsOn ?? []) {
      visit(dependencyName);
    }

    visiting.delete(name);
    visited.add(name);
    result.push(service);
  };

  for (const service of services) {
    visit(service.name);
  }

  return result;
}

/**
 * Order lifecycle nodes for shutdown so dependents stop before dependencies.
 */
export function orderForShutdown<T extends ServiceLifecycleNode>(services: readonly T[]): T[] {
  return orderByDependencies(services).slice().reverse();
}

function validateUniqueServiceNames(services: readonly ServiceLifecycleNode[]): void {
  const names = new Set<string>();

  for (const service of services) {
    if (names.has(service.name)) {
      throw new Error(`Duplicate service name registered: ${service.name}`);
    }
    names.add(service.name);
  }
}

function validateDependencies(services: readonly ServiceLifecycleNode[]): void {
  const names = new Set(services.map(service => service.name));

  for (const service of services) {
    for (const dependencyName of service.dependsOn ?? []) {
      if (!names.has(dependencyName)) {
        throw new Error(`Service ${service.name} depends on missing service ${dependencyName}`);
      }
    }
  }
}
