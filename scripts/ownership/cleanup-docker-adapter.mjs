import { observeDockerResources } from './docker-observation.mjs';

export function inventoryDockerResources(options = {}) {
  return observeDockerResources(options);
}

export function createDockerCleanupAdapter(defaults = {}) {
  return Object.freeze({
    id: 'docker-compose-oci-buildkit-read-only',
    resourceClasses: Object.freeze(['compose_container', 'compose_network', 'compose_volume', 'oci_image', 'buildkit_cache']),
    inventory(options = {}) {
      return inventoryDockerResources({ ...defaults, ...options });
    },
  });
}
