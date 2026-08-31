export function assertLegacyCleanupProjectNotCurrent(store, project) {
  if (!/^[A-Za-z0-9_.-]+$/.test(project ?? '')) throw new Error('legacy cleanup project has an invalid format');
  const inspection = store.inspect();
  if (inspection.registered && ![inspection.active, inspection.pending, inspection.prepared].some(Boolean)) {
    throw new Error(`legacy cleanup found unresolved manifest state for project ${project}`);
  }
  for (const pointer of [inspection.active, inspection.pending, inspection.prepared]) {
    if (!pointer) continue;
    const revision = store.readManifest(pointer.value.generation, { verifySnapshots: true });
    if (revision.manifest.composeProjectName === project) {
      throw new Error(`legacy cleanup would target current manifest project ${project}`);
    }
  }
  return project;
}
