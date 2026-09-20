#!/usr/bin/env node
// Build-only manifests: npm resolves production edges from the reviewed lock,
// without carrying development tools through optional runtime peer edges.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function resolutionIdentity(location, record) {
  const name = location.split('node_modules/').at(-1);
  return JSON.stringify([name, record.version, record.resolved, record.integrity]);
}

function assertLockedResolutions(source, projected) {
  const reviewed = new Set(Object.entries(source.packages)
    .filter(([location, record]) => location.includes('node_modules/') && !record.link)
    .map(([location, record]) => resolutionIdentity(location, record)));
  for (const [location, record] of Object.entries(projected.packages)) {
    if (!location.includes('node_modules/') || record.link) continue;
    if (!reviewed.has(resolutionIdentity(location, record))) {
      throw new Error(`Runtime dependency is not in the reviewed lockfile: ${location}`);
    }
  }
}

function projectRuntimeDependencies(sourceRoot, destination, role) {
  if (!['application', 'migration'].includes(role)) throw new Error('Expected application or migration role');
  if (fs.existsSync(destination)) throw new Error('Projection destination must not already exist');
  const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package-lock.json'), 'utf8'));
  const rootManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  // Retain every workspace manifest so npm can interpret the original lockfile.
  const manifests = ['package.json', ...rootManifest.workspaces.map(workspace => `${workspace}/package.json`)];
  for (const file of manifests) {
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'));
    if (role === 'migration' && file === 'server/package.json') {
      manifest.dependencies.prisma = manifest.devDependencies.prisma;
    }
    delete manifest.devDependencies;
    delete manifest.scripts;
    if (file === 'package.json') delete manifest.dependencies;
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  fs.copyFileSync(path.join(sourceRoot, 'package-lock.json'), path.join(destination, 'package-lock.json'));
  execFileSync('npm', ['install', '--package-lock-only', '--offline', '--ignore-scripts', '--audit=false', '--fund=false'], {
    cwd: destination, stdio: 'inherit',
  });
  const projected = JSON.parse(fs.readFileSync(path.join(destination, 'package-lock.json'), 'utf8'));
  assertLockedResolutions(source, projected);
}

if (require.main === module) {
  const [destination, role] = process.argv.slice(2);
  if (!destination || !role) throw new Error('Usage: project-runtime-dependencies.cjs DESTINATION application|migration');
  projectRuntimeDependencies(process.cwd(), path.resolve(destination), role);
}

module.exports = { assertLockedResolutions, projectRuntimeDependencies };
