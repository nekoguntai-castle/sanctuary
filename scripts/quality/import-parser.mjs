function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractNamedSymbols(statement) {
  const symbols = new Set();
  const named = statement.match(/\{([^}]+)\}/);
  if (named) {
    for (const part of named[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
      if (name) symbols.add(name);
    }
  }

  const namespace = statement.match(/\*\s+as\s+(\w+)/);
  if (namespace) symbols.add(namespace[1]);

  const defaultImport = statement.match(/^import\s+(?:type\s+)?(\w+)\s*(?:,|from)/);
  if (defaultImport) symbols.add(defaultImport[1]);

  return symbols;
}

function collectStaticImportStatements(executableSource) {
  const imports = [];
  const pattern = /(^|\n)\s*(import|export)\s+[\s\S]*?;/g;

  for (const match of executableSource.matchAll(pattern)) {
    const statement = match[0].trim();
    const sideEffect = statement.match(/^import\s+['"]([^'"]+)['"]/);
    const from = statement.match(/\sfrom\s+['"]([^'"]+)['"]/);
    const specifier = from?.[1] ?? sideEffect?.[1];

    if (!specifier) {
      continue;
    }

    imports.push({
      specifier,
      typeOnly: /^(?:import|export)\s+type\b/.test(statement),
      dynamic: false,
      symbols: extractNamedSymbols(statement),
    });
  }

  return imports;
}

function collectDynamicImportStatements(executableSource) {
  const imports = [];
  const pattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of executableSource.matchAll(pattern)) {
    imports.push({
      specifier: match[1],
      typeOnly: false,
      dynamic: true,
      symbols: new Set(),
    });
  }

  return imports;
}

export function collectImportStatements(source) {
  const executableSource = stripComments(source);
  return [
    ...collectStaticImportStatements(executableSource),
    ...collectDynamicImportStatements(executableSource),
  ];
}
