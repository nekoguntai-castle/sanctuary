/**
 * Schema and parsing for the IOC indicator manifest (ioc-indicators.json).
 *
 * Kept separate from the sweep so that adding a new indicator category is a
 * change to the data contract only, and so the sweep stays focused on scanning.
 */

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function parseIndicatorList(raw, key, fields, validate) {
  const list = raw[key];
  if (!Array.isArray(list)) throw new Error(`${key} must be an array`);
  return list.map((item, index) => {
    const label = `${key}[${index}]`;
    if (!isPlainObject(item)) throw new Error(`${label} must be an object`);
    fields.forEach((field) => requireString(item[field], `${label}.${field}`));
    validate?.(item, label);
    return item;
  });
}

function validatePackageEntry(item, label) {
  if (!Array.isArray(item.versions) || item.versions.length === 0) {
    throw new Error(`${label}.versions must be a non-empty array`);
  }
  item.versions.forEach((version, index) => requireString(version, `${label}.versions[${index}]`));
}

function validateScriptPattern(item, label) {
  try {
    new RegExp(item.pattern, 'i');
  } catch (error) {
    throw new Error(`${label}.pattern is not a valid regular expression: ${error.message}`);
  }
}

export function parseManifest(source) {
  const raw = typeof source === 'string' ? JSON.parse(source) : source;
  if (!isPlainObject(raw)) throw new Error('manifest must be an object');
  if (raw.schemaVersion !== 1) throw new Error('unsupported manifest schemaVersion');

  return {
    packages: parseIndicatorList(raw, 'packages', ['name', 'incident'], validatePackageEntry),
    scriptPatterns: parseIndicatorList(raw, 'scriptPatterns', ['id', 'pattern', 'description'], validateScriptPattern),
    networkIndicators: parseIndicatorList(raw, 'networkIndicators', ['id', 'value', 'description']),
    fileIndicators: parseIndicatorList(raw, 'fileIndicators', ['id', 'path', 'description']),
    hookIndicators: parseIndicatorList(raw, 'hookIndicators', ['id', 'path', 'description']),
  };
}

/** Builds a `name@version` -> package-indicator lookup. */
export function buildPackageIndex(packages) {
  const index = new Map();
  packages.forEach((entry) => {
    entry.versions.forEach((version) => index.set(`${entry.name}@${version}`, entry));
  });
  return index;
}
