export function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
}

export function parseLastJsonLine(output, label = 'command') {
  const lines = output.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    if (!line.startsWith('{')) continue;
    return JSON.parse(line);
  }

  throw new Error(`${label} did not emit JSON output:\n${output}`);
}

export function formatBody(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
}

export function escapeCell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

export function summarizeDurations(values) {
  if (values.length === 0) {
    return { minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  }

  const sorted = values.slice().sort((a, b) => a - b);
  return {
    minMs: round(sorted[0]),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

export function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) {
    return 'n/a';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let scaled = bytes;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${round(scaled)} ${units[unitIndex]}`;
}

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
