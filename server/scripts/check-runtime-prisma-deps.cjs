#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function checkRuntimePrismaDependencies(root) {
  const forbidden = new Set(['prisma', '@prisma/config', '@prisma/dev', 'effect']);
  const visited = new Set();
  function visit(directory) {
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      // npm workspace links may intentionally be replaced during image assembly.
      if (!fs.existsSync(child) || !fs.statSync(child).isDirectory()) continue;
      const manifestPath = path.join(child, 'package.json');
      if (fs.existsSync(manifestPath)) {
        const { name } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (forbidden.has(name) || name?.startsWith('@electric-sql/')) {
          throw new Error(`Migration-only dependency in application image: ${child} (${name})`);
        }
      }
      visit(child);
    }
  }
  visit(root);
}

if (require.main === module) checkRuntimePrismaDependencies(process.argv[2] || '/app/node_modules');
module.exports = { checkRuntimePrismaDependencies };
