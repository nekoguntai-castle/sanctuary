const PROJECT = /^[A-Za-z0-9_.-]{1,128}$/;

export function resolveProjectIdentity(environment = process.env, fallback = '') {
  const composeProject = environment.COMPOSE_PROJECT_NAME ?? '';
  const sanctuaryProject = environment.SANCTUARY_PROJECT ?? '';
  if (composeProject && sanctuaryProject && composeProject !== sanctuaryProject) {
    throw new Error('SANCTUARY_PROJECT and COMPOSE_PROJECT_NAME must match');
  }
  const project = composeProject || sanctuaryProject || fallback;
  if (!project) throw new Error('project identity is required');
  if (!PROJECT.test(project) || ['.', '..'].includes(project)) {
    throw new Error('project identity has an invalid format');
  }
  return project;
}
