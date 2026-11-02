#!/usr/bin/env node
// Prints a Compose overlay that re-declares each existing project volume and
// network with the labels it was created with.
//
// Docker labels are immutable, but the ownership anchor interpolates per-run
// provenance (created-at, release, commit, run id). Without this overlay every
// run after the first declares a different config hash for resources that
// already exist: Compose asks "Recreate (data will be lost)?" for each volume,
// and tries to recreate each network, which fails with "has active endpoints"
// while other containers still use it. `!override` replaces the whole label
// map, so keys added to the anchor after a resource was created cannot
// reintroduce the mismatch.
//
// Usage: docker compose ... config --format json | compose-resource-labels.mjs PROJECT
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { docker, parseJson } from './legacy-docker-inspection.mjs';

const COMPOSE_LABEL_PREFIX = 'com.docker.compose.';
const KINDS = ['volumes', 'networks'];

function declaredNames(definitions) {
  const names = new Map();
  for (const [key, definition] of Object.entries(definitions ?? {})) {
    if (definition?.external || !definition?.name) continue;
    names.set(definition.name, key);
  }
  return names;
}

// config: resolved `docker compose config --format json`.
// existing: { volumes: [inspect...], networks: [inspect...] } for the project.
export function resourceLabelOverlay(config, existing) {
  const lines = [];
  for (const kind of KINDS) {
    const declared = declaredNames(config?.[kind]);
    const entries = (existing?.[kind] ?? [])
      .filter((resource) => declared.has(resource.Name))
      .map((resource) => ({ key: declared.get(resource.Name), labels: resource.Labels ?? {} }))
      .sort((left, right) => left.key.localeCompare(right.key));
    if (entries.length === 0) continue;
    lines.push(`${kind}:`);
    for (const { key, labels } of entries) {
      const owned = Object.entries(labels)
        .filter(([name]) => !name.startsWith(COMPOSE_LABEL_PREFIX))
        .sort(([left], [right]) => left.localeCompare(right));
      lines.push(`  ${JSON.stringify(key)}:`, `    labels: !override${owned.length === 0 ? ' {}' : ''}`);
      for (const [name, value] of owned) lines.push(`      ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function inspectProjectResources(noun, project) {
  const names = docker([noun, 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])
    .split('\n').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return [];
  try {
    return parseJson(docker([noun, 'inspect', ...names]), `${noun} inspect`);
  } catch {
    // One of them went away after the listing; a missing resource needs no pin.
    return names.flatMap((name) => {
      try { return parseJson(docker([noun, 'inspect', name]), `${noun} inspect`); } catch { return []; }
    });
  }
}

function main([project]) {
  if (!project) throw new Error('usage: compose-resource-labels.mjs PROJECT < compose-config.json');
  const config = parseJson(readFileSync(0, 'utf8'), 'docker compose config');
  process.stdout.write(resourceLabelOverlay(config, {
    volumes: inspectProjectResources('volume', project),
    networks: inspectProjectResources('network', project),
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
